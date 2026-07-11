// Definición de armas
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'PISTOLA M9', dmg: 34, rpm: 320, mag: 12,
    reserveMax: Infinity, auto: false, pellets: 1, spread: 0.010, range: 100,
    reloadTime: 1.1, recoil: 0.018, kick: 0.05,
  },
  rifle: {
    id: 'rifle', name: 'RIFLE DE ASALTO', dmg: 22, rpm: 620, mag: 30,
    reserveMax: 240, auto: true, pellets: 1, spread: 0.014, range: 130,
    reloadTime: 1.7, recoil: 0.012, kick: 0.04,
  },
  shotgun: {
    id: 'shotgun', name: 'ESCOPETA TÁCTICA', dmg: 12, rpm: 78, mag: 6,
    reserveMax: 48, auto: false, pellets: 8, spread: 0.05, range: 42,
    reloadTime: 2.2, recoil: 0.045, kick: 0.12,
  },
  smg: {
    id: 'smg', name: 'SUBFUSIL VECTOR', dmg: 15, rpm: 900, mag: 35,
    reserveMax: 280, auto: true, pellets: 1, spread: 0.020, range: 85,
    reloadTime: 1.5, recoil: 0.009, kick: 0.03,
  },
};

export const WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'smg'];

export function initialReserve(id) {
  return { pistol: Infinity, rifle: 120, shotgun: 24, smg: 140 }[id] ?? 90;
}
