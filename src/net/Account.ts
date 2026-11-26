// The player's save and garage, kept in this browser (localStorage): money, weapons, health,
// position, the car you drive and up to 5 cars in your own garage. No login. The same browser
// also keeps the multiplayer identity (a random id and the nickname you pick in the menu).
// The Supabase client here is only used for multiplayer (Realtime), not for accounts.
import { createClient } from '@supabase/supabase-js';
import type { CarType } from '../assets/models.ts';
import type { Tuning } from '../vehicle/Tuning.ts';

const SUPABASE_URL = 'https://pnxzcvyytonqdbqxbgye.supabase.co';
/** Publishable key: safe in the browser. */
const SUPABASE_KEY = 'sb_publishable_DPnegBMGED4tte0-G5fF8w_lcS_3O73';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/** Garage spaces per player. */
export const GARAGE_SPACES = 5;

const SAVE_KEY = 'blansko-save-v1';
const ID_KEY = 'blansko-guest-id';
const NICK_KEY = 'blansko-guest-nick';

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

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode or full: the game goes on without saving */
  }
};

export class Account {
  /** Multiplayer identity (kept in this browser). */
  readonly guestId: string;
  guestNick: string;
  /** The saved game; always present (a fresh one on the first visit). */
  profile: Profile;
  cars: GarageCar[] = [];
  /** True when this browser had a save before this visit. */
  readonly returning: boolean;

  constructor() {
    this.guestId = read(ID_KEY) ?? crypto.randomUUID();
    write(ID_KEY, this.guestId);
    this.guestNick = read(NICK_KEY) ?? `Hráč ${1000 + Math.floor(Math.random() * 9000)}`;
    write(NICK_KEY, this.guestNick);
    let stored: { profile?: Profile; cars?: GarageCar[] } | null = null;
    try {
      stored = JSON.parse(read(SAVE_KEY) ?? 'null');
    } catch {
      stored = null;
    }
    this.returning = !!stored?.profile;
    this.profile = {
      id: this.guestId, nickname: this.guestNick, money: 500, weapons: ['pistol'], ammo: { pistol: 48, smg: 0, shotgun: 0 },
      health: 100, pos: null, active_car: null, ...stored?.profile,
    };
    this.cars = Array.isArray(stored?.cars) ? stored!.cars : [];
  }

  setNick(nick: string) {
    this.guestNick = this.profile.nickname = nick;
    write(NICK_KEY, nick);
    this.persist();
  }

  get netId() {
    return this.guestId;
  }

  get netNick() {
    return this.guestNick;
  }

  private persist() {
    write(SAVE_KEY, JSON.stringify({ profile: this.profile, cars: this.cars }));
  }

  async save(state: Partial<Omit<Profile, 'id'>>) {
    Object.assign(this.profile, state);
    this.persist();
  }

  async addCar(car: Omit<GarageCar, 'id'>): Promise<GarageCar | string> {
    if (this.cars.length >= GARAGE_SPACES) return `Garáž je plná (${GARAGE_SPACES} míst).`;
    const c = { ...car, id: crypto.randomUUID() };
    this.cars.push(c);
    this.persist();
    return c;
  }

  async updateCar(id: string, patch: Partial<Omit<GarageCar, 'id'>>) {
    const car = this.cars.find((c) => c.id === id);
    if (!car) return;
    Object.assign(car, patch);
    this.persist();
  }

  async removeCar(id: string) {
    this.cars = this.cars.filter((c) => c.id !== id);
    if (this.profile.active_car === id) this.profile.active_car = null;
    this.persist();
  }
}
