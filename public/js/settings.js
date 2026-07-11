// Ajustes, perfil y progreso guardado (localStorage)

const SETTINGS_KEY = 'nexus.settings.v1';
const PROFILE_KEY = 'nexus.profile.v1';

export const DEFAULT_SETTINGS = {
  sens: 1.0,
  fov: 78,
  master: 0.8,
  music: 0.5,
  sfx: 0.9,
  quality: 'high',
  invertY: false,
  showFps: false,
};

export const DEFAULT_PROFILE = {
  name: 'Operador',
  skin: 0,
  bestWave: 0,
  bestScore: 0,
  totalKills: 0,
  gamesPlayed: 0,
};

export const SKIN_COLORS = [0x3a86ff, 0xff3b3b, 0x38d977, 0xffd23b, 0xb14cf0, 0xff8c1a];

// Armas desbloqueables por bajas totales acumuladas
export const WEAPON_UNLOCKS = [
  { id: 'pistol',  name: 'Pistola M9',       kills: 0 },
  { id: 'rifle',   name: 'Rifle de asalto',  kills: 0 },
  { id: 'shotgun', name: 'Escopeta táctica', kills: 50 },
  { id: 'smg',     name: 'Subfusil Vector',  kills: 150 },
];

function load(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch { return { ...defaults }; }
}

export const settings = load(SETTINGS_KEY, DEFAULT_SETTINGS);
export const profile = load(PROFILE_KEY, DEFAULT_PROFILE);

export function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
export function saveProfile() { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }

export function unlockedWeapons() {
  return WEAPON_UNLOCKS.filter(w => profile.totalKills >= w.kills).map(w => w.id);
}

// Registra el resultado de una partida en el progreso persistente
export function recordGame({ wave, score, kills }) {
  profile.gamesPlayed++;
  profile.totalKills += kills;
  if (wave > profile.bestWave) profile.bestWave = wave;
  if (score > profile.bestScore) profile.bestScore = score;
  saveProfile();
}

export const QUALITY_PRESETS = {
  low:    { pixelRatio: 0.66, shadows: false, shadowSize: 512,  anisotropy: 1, envIntensity: 0.9 },
  medium: { pixelRatio: 0.85, shadows: true,  shadowSize: 1024, anisotropy: 2, envIntensity: 1.0 },
  high:   { pixelRatio: 1.0,  shadows: true,  shadowSize: 2048, anisotropy: 4, envIntensity: 1.0 },
  ultra:  { pixelRatio: Math.min(devicePixelRatio, 2), shadows: true, shadowSize: 4096, anisotropy: 8, envIntensity: 1.1 },
};
