// Player account (Supabase): magic-link login, the saved game (profiles table) and the cars in
// the player's own garage (cars table). Row level security lets each player read and change
// only their own rows. Without logging in the game runs offline and nothing is saved.
import { createClient, type Session } from '@supabase/supabase-js';
import type { CarType } from '../assets/models.ts';
import type { Tuning } from '../vehicle/Tuning.ts';

const SUPABASE_URL = 'https://pnxzcvyytonqdbqxbgye.supabase.co';
/** Publishable key: safe in the browser, the database rules decide what it can do. */
const SUPABASE_KEY = 'sb_publishable_DPnegBMGED4tte0-G5fF8w_lcS_3O73';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Garage spaces per player (also enforced by a database trigger). */
export const GARAGE_SPACES = 5;

export interface SavedPos { x: number; y: number; z: number; yaw: number; inCar: boolean }

export interface Profile {
  id: string;
  nickname: string;
  money: number;
  weapons: string[];
  ammo: Record<string, number>;
  health: number;
  pos: SavedPos | null;
  active_car: string | null;
}

export interface GarageCar {
  id: string;
  name: string;
  type: CarType;
  color: number;
  tuning: Tuning;
}

export class Account {
  session: Session | null = null;
  profile: Profile | null = null;
  cars: GarageCar[] = [];
  /** True once the stored session (if any) and the profile have been loaded. */
  ready = false;
  /** Logged in, profile loaded or missing (then the player must pick a nickname). */
  onChange?: () => void;

  /** Multiplayer identity for players who are not logged in (kept in this browser). */
  readonly guestId: string;
  guestNick: string;

  constructor() {
    const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
    const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
    this.guestId = read('blansko-guest-id') ?? crypto.randomUUID();
    write('blansko-guest-id', this.guestId);
    this.guestNick = read('blansko-guest-nick') ?? `Host ${1000 + Math.floor(Math.random() * 9000)}`;
    write('blansko-guest-nick', this.guestNick);
    void this.init();
  }

  setGuestNick(nick: string) {
    this.guestNick = nick;
    try { localStorage.setItem('blansko-guest-nick', nick); } catch { /* private mode */ }
  }

  /** Who we are in multiplayer: the profile when logged in, otherwise the guest. */
  get netId() {
    return this.profile?.id ?? this.guestId;
  }

  get netNick() {
    return this.profile?.nickname ?? this.guestNick;
  }

  private async init() {
    try {
      const { data } = await supabase.auth.getSession();
      this.session = data.session;
      if (this.session) await this.load();
    } catch (err) {
      console.warn('Přihlášení se nenačetlo', err);
    }
    this.ready = true;
    this.onChange?.();
    supabase.auth.onAuthStateChange((event, session) => {
      const before = this.session?.user.id;
      this.session = session;
      if (!session) {
        this.profile = null;
        this.cars = [];
        this.onChange?.();
      } else if (session.user.id !== before) {
        // Do not await inside the callback (supabase-js may deadlock); load right after.
        setTimeout(() => void this.load().then(() => this.onChange?.()), 0);
      }
    });
  }

  get loggedIn() {
    return !!this.session;
  }

  get userId(): string | null {
    return this.session?.user.id ?? null;
  }

  get email(): string {
    return this.session?.user.email ?? '';
  }

  /** Sends the magic link; returns an error message or null. */
  async sendLink(email: string): Promise<string | null> {
    const redirect = location.origin + location.pathname;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
    if (!error) return null;
    if (error.status === 429) return 'Moc pokusů, zkus to za chvíli znovu.';
    return error.message;
  }

  async signOut() {
    await supabase.auth.signOut();
  }

  async load() {
    const id = this.userId;
    if (!id) return;
    const [p, c] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
      supabase.from('cars').select('id, name, type, color, tuning').order('created_at'),
    ]);
    if (p.error) console.warn('Profil se nenačetl', p.error);
    if (c.error) console.warn('Garáž se nenačetla', c.error);
    this.profile = (p.data as Profile | null) ?? null;
    this.cars = (c.data as GarageCar[] | null) ?? [];
  }

  /** First login: creates the profile with the given nickname and the current game state. */
  async createProfile(nickname: string, state: Omit<Profile, 'id' | 'nickname' | 'active_car'>): Promise<string | null> {
    const id = this.userId;
    if (!id) return 'Nejsi přihlášený.';
    const { data, error } = await supabase.from('profiles').insert({ id, nickname, ...state }).select().single();
    if (error) return error.message;
    this.profile = data as Profile;
    return null;
  }

  async save(state: Partial<Omit<Profile, 'id'>>) {
    if (!this.profile) return;
    Object.assign(this.profile, state);
    const { error } = await supabase.from('profiles').update({ ...state, updated_at: new Date().toISOString() }).eq('id', this.profile.id);
    if (error) console.warn('Uložení se nepovedlo', error);
  }

  async addCar(car: Omit<GarageCar, 'id'>): Promise<GarageCar | string> {
    if (this.cars.length >= GARAGE_SPACES) return `Garáž je plná (${GARAGE_SPACES} míst).`;
    const { data, error } = await supabase.from('cars').insert(car).select('id, name, type, color, tuning').single();
    if (error) return error.message.includes('plná') ? `Garáž je plná (${GARAGE_SPACES} míst).` : error.message;
    this.cars.push(data as GarageCar);
    return data as GarageCar;
  }

  async updateCar(id: string, patch: Partial<Omit<GarageCar, 'id'>>) {
    const car = this.cars.find((c) => c.id === id);
    if (!car) return;
    Object.assign(car, patch);
    const { error } = await supabase.from('cars').update(patch).eq('id', id);
    if (error) console.warn('Auto se neuložilo', error);
  }

  async removeCar(id: string) {
    this.cars = this.cars.filter((c) => c.id !== id);
    if (this.profile?.active_car === id) this.profile.active_car = null;
    const { error } = await supabase.from('cars').delete().eq('id', id);
    if (error) console.warn('Auto se nesmazalo', error);
  }
}
