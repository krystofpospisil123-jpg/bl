// Player-adjustable settings, remembered in the browser (falls back to defaults).
export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  /** Show real shop names from OpenStreetMap (true) or generic Czech names (false). */
  realNames: boolean;
  quality: Quality;
}

const KEY = 'blansko-settings-v1';

function load(): Settings {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const defaults: Settings = { realNames: true, quality: coarse ? 'low' : 'high' };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

export const settings: Settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
