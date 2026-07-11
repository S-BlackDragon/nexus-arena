// Mapa compartido entre cliente y servidor (ESM).
// Arena industrial 96x96 con muros perimetrales, contenedores, cajas y pilares.

export const ARENA_SIZE = 96;          // lado total
export const HALF = ARENA_SIZE / 2;
export const WALL_HEIGHT = 6;
export const WALL_THICK = 1.2;

// Obstáculos: cajas AABB { x, z, w, d, h, mat }  (w=ancho X, d=profundidad Z, h=alto)
// mat: 'metal' | 'concrete'
export const OBSTACLES = [
  // Contenedores grandes (estilo shipping container 2.4x6)
  { x: -18, z: -14, w: 6.1, d: 2.5, h: 2.6, mat: 'metal' },
  { x: -18, z: -11.3, w: 6.1, d: 2.5, h: 2.6, mat: 'metal' },
  { x: 18, z: 14, w: 6.1, d: 2.5, h: 2.6, mat: 'metal' },
  { x: 18, z: 11.3, w: 6.1, d: 2.5, h: 2.6, mat: 'metal' },
  { x: 14, z: -20, w: 2.5, d: 6.1, h: 2.6, mat: 'metal' },
  { x: -14, z: 20, w: 2.5, d: 6.1, h: 2.6, mat: 'metal' },
  { x: 30, z: -6, w: 2.5, d: 6.1, h: 2.6, mat: 'metal' },
  { x: -30, z: 6, w: 2.5, d: 6.1, h: 2.6, mat: 'metal' },

  // Bloques de hormigón medianos
  { x: 0, z: -26, w: 5, d: 2.2, h: 1.8, mat: 'concrete' },
  { x: 0, z: 26, w: 5, d: 2.2, h: 1.8, mat: 'concrete' },
  { x: -26, z: 0, w: 2.2, d: 5, h: 1.8, mat: 'concrete' },
  { x: 26, z: 0, w: 2.2, d: 5, h: 1.8, mat: 'concrete' },

  // Cajas pequeñas de cobertura (saltables encima)
  { x: -8, z: -6, w: 1.6, d: 1.6, h: 1.1, mat: 'metal' },
  { x: -6.2, z: -6, w: 1.6, d: 1.6, h: 1.1, mat: 'metal' },
  { x: -7.1, z: -6, w: 1.6, d: 1.6, h: 2.2, mat: 'metal' },
  { x: 8, z: 6, w: 1.6, d: 1.6, h: 1.1, mat: 'metal' },
  { x: 6.2, z: 6, w: 1.6, d: 1.6, h: 1.1, mat: 'metal' },
  { x: 7.1, z: 6, w: 1.6, d: 1.6, h: 2.2, mat: 'metal' },
  { x: 10, z: -12, w: 1.6, d: 1.6, h: 1.1, mat: 'metal' },
  { x: -10, z: 12, w: 1.6, d: 1.6, h: 1.1, mat: 'metal' },
  { x: 22, z: 22, w: 1.8, d: 1.8, h: 1.2, mat: 'metal' },
  { x: -22, z: -22, w: 1.8, d: 1.8, h: 1.2, mat: 'metal' },
  { x: 34, z: 30, w: 1.8, d: 1.8, h: 1.2, mat: 'metal' },
  { x: -34, z: -30, w: 1.8, d: 1.8, h: 1.2, mat: 'metal' },

  // Pilares de hormigón
  { x: -14, z: 34, w: 1.4, d: 1.4, h: 5.5, mat: 'concrete' },
  { x: 14, z: -34, w: 1.4, d: 1.4, h: 5.5, mat: 'concrete' },
  { x: 34, z: 14, w: 1.4, d: 1.4, h: 5.5, mat: 'concrete' },
  { x: -34, z: -14, w: 1.4, d: 1.4, h: 5.5, mat: 'concrete' },
  { x: -36, z: 36, w: 1.4, d: 1.4, h: 5.5, mat: 'concrete' },
  { x: 36, z: -36, w: 1.4, d: 1.4, h: 5.5, mat: 'concrete' },

  // Plataforma central elevada
  { x: 0, z: 0, w: 8, d: 8, h: 0.7, mat: 'concrete' },
];

// Puertas de aparición de enemigos (bordes de la arena)
export const ENEMY_GATES = [
  { x: 0, z: -HALF + 2 }, { x: 0, z: HALF - 2 },
  { x: -HALF + 2, z: 0 }, { x: HALF - 2, z: 0 },
  { x: -HALF + 2, z: -HALF + 2 }, { x: HALF - 2, z: HALF - 2 },
  { x: -HALF + 2, z: HALF - 2 }, { x: HALF - 2, z: -HALF + 2 },
];

// Puntos de aparición de jugadores (alrededor del centro)
export const PLAYER_SPAWNS = [
  { x: 0, z: 6 }, { x: 3, z: 5 }, { x: -3, z: 5 },
  { x: 0, z: 8 }, { x: 5, z: 7 }, { x: -5, z: 7 },
];

// Resuelve colisión círculo (jugador/enemigo) vs AABB de obstáculos y muros.
// pos = {x, z}; devuelve pos corregida in-place. y = altura de los pies del actor.
export function collideCircle(pos, radius, y = 0) {
  const lim = HALF - WALL_THICK - radius;
  if (pos.x > lim) pos.x = lim;
  if (pos.x < -lim) pos.x = -lim;
  if (pos.z > lim) pos.z = lim;
  if (pos.z < -lim) pos.z = -lim;
  for (const o of OBSTACLES) {
    if (y >= o.h - 0.25) continue; // por encima del obstáculo
    const hw = o.w / 2 + radius, hd = o.d / 2 + radius;
    const dx = pos.x - o.x, dz = pos.z - o.z;
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      const px = hw - Math.abs(dx), pz = hd - Math.abs(dz);
      if (px < pz) pos.x = o.x + Math.sign(dx || 1) * hw;
      else pos.z = o.z + Math.sign(dz || 1) * hd;
    }
  }
  return pos;
}

// Altura del suelo bajo un punto (para poder subirse a cajas bajas)
export function groundHeight(x, z, radius = 0.35) {
  let h = 0;
  for (const o of OBSTACLES) {
    const hw = o.w / 2 + radius * 0.5, hd = o.d / 2 + radius * 0.5;
    if (Math.abs(x - o.x) < hw && Math.abs(z - o.z) < hd) h = Math.max(h, o.h);
  }
  return h;
}
