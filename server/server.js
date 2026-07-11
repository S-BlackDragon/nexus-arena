// NEXUS ARENA — Servidor autoritativo (Express + Socket.IO)
// Salas de 1-6 jugadores, oleadas de enemigos, validación de daño y pickups.
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { OBSTACLES, ENEMY_GATES, PLAYER_SPAWNS, collideCircle, HALF } from '../public/js/shared/map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '../public')));
app.use('/vendor/three', express.static(path.join(__dirname, '../node_modules/three')));
app.get('/health', (_q, res) => res.json({ ok: true, rooms: rooms.size }));

const PORT = process.env.PORT || 3000;
const TICK = 100;                 // ms — 10 Hz para IA de enemigos
const MAX_PLAYERS = 6;
const MAX_ALIVE_ENEMIES = 26;
const HIT_MAX_DIST = 130;
const WEAPON_DMG_CAP = { pistol: 45, rifle: 30, smg: 22, shotgun: 20 }; // por impacto/perdigón

const ENEMY_TYPES = {
  grunt:  { hp: 60,  speed: 3.0, dmg: 10, points: 100, reach: 1.9, atkCd: 1.1, scale: 1.0 },
  runner: { hp: 35,  speed: 5.4, dmg: 8,  points: 150, reach: 1.7, atkCd: 0.9, scale: 0.85 },
  tank:   { hp: 240, speed: 1.9, dmg: 24, points: 400, reach: 2.3, atkCd: 1.6, scale: 1.45 },
};

const rooms = new Map(); // code -> Room
let enemySeq = 1, pickupSeq = 1;

function code4() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  do { c = Array.from({ length: 4 }, () => abc[(Math.random() * abc.length) | 0]).join(''); }
  while (rooms.has(c));
  return c;
}

function makeRoom(isPublic) {
  const room = {
    code: code4(),
    isPublic,
    started: false,
    players: new Map(),   // socketId -> player
    enemies: new Map(),   // id -> enemy
    pickups: new Map(),   // id -> pickup
    wave: 0,
    pool: 0,              // enemigos pendientes de aparecer esta oleada
    intermission: 0,      // ticks hasta la siguiente oleada
    spawnCd: 0,
    over: false,
    kills: 0,
    timer: null,
  };
  rooms.set(room.code, room);
  return room;
}

function roomInfo(room) {
  return {
    code: room.code,
    isPublic: room.isPublic,
    started: room.started,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, ready: p.ready, host: p.host, skin: p.skin,
      hp: p.hp, alive: p.alive, score: p.score, kills: p.kills,
    })),
  };
}

function broadcastRoom(room) { io.to(room.code).emit('roomUpdate', roomInfo(room)); }

function spawnPointFor(room, idx) {
  const s = PLAYER_SPAWNS[idx % PLAYER_SPAWNS.length];
  return { x: s.x, z: s.z };
}

function startGame(room) {
  room.started = true;
  room.over = false;
  room.wave = 0;
  room.kills = 0;
  room.enemies.clear();
  room.pickups.clear();
  let i = 0;
  for (const p of room.players.values()) {
    const s = spawnPointFor(room, i++);
    Object.assign(p, { x: s.x, y: 0, z: s.z, ry: 0, hp: 100, alive: true, score: 0, kills: 0, anim: 'Idle', lastHit: 0, shots: [] });
  }
  room.intermission = 30; // 3 s hasta la oleada 1
  io.to(room.code).emit('gameStart', {
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, skin: p.skin, x: p.x, z: p.z })),
  });
  broadcastRoom(room);
  if (!room.timer) room.timer = setInterval(() => tick(room), TICK);
}

function waveComposition(wave, nPlayers) {
  const mult = 1 + 0.4 * (nPlayers - 1);
  const total = Math.round((6 + wave * 4) * mult);
  const runners = wave >= 2 ? Math.round(total * Math.min(0.35, 0.08 * wave)) : 0;
  const tanks = wave >= 3 ? Math.max(0, Math.round((wave - 2) * 0.8 * mult)) : 0;
  const grunts = Math.max(1, total - runners - tanks);
  return { grunts, runners, tanks, total: grunts + runners + tanks };
}

function startWave(room) {
  room.wave++;
  const comp = waveComposition(room.wave, Math.max(1, room.players.size));
  room.queue = [
    ...Array(comp.grunts).fill('grunt'),
    ...Array(comp.runners).fill('runner'),
    ...Array(comp.tanks).fill('tank'),
  ].sort(() => Math.random() - 0.5);
  room.pool = room.queue.length;
  room.spawnCd = 0;
  // Reaparecen los jugadores muertos al empezar la oleada
  let i = 0;
  for (const p of room.players.values()) {
    if (!p.alive) {
      const s = spawnPointFor(room, i);
      Object.assign(p, { alive: true, hp: 100, x: s.x, z: s.z });
      io.to(room.code).emit('playerRespawn', { id: p.id, x: p.x, z: p.z, hp: p.hp });
    }
    i++;
  }
  io.to(room.code).emit('waveStart', { wave: room.wave, total: comp.total });
  broadcastRoom(room);
}

function spawnEnemy(room) {
  const type = room.queue.pop();
  if (!type) return;
  const t = ENEMY_TYPES[type];
  const gate = ENEMY_GATES[(Math.random() * ENEMY_GATES.length) | 0];
  const e = {
    id: enemySeq++,
    type,
    x: gate.x + (Math.random() * 4 - 2),
    z: gate.z + (Math.random() * 4 - 2),
    ry: 0,
    hp: t.hp * (1 + room.wave * 0.06),
    maxHp: t.hp * (1 + room.wave * 0.06),
    atkTimer: 0,
    target: null,
  };
  room.enemies.set(e.id, e);
  io.to(room.code).emit('enemySpawn', { id: e.id, type, x: e.x, z: e.z, hp: e.hp, maxHp: e.maxHp });
}

function dropPickup(room, x, z) {
  const r = Math.random();
  if (r > 0.40) return;
  const kind = r < 0.18 ? 'health' : 'ammo';
  const pk = { id: pickupSeq++, kind, x, z };
  room.pickups.set(pk.id, pk);
  io.to(room.code).emit('pickupSpawn', pk);
  // caduca a los 25 s
  setTimeout(() => {
    if (room.pickups.delete(pk.id)) io.to(room.code).emit('pickupGone', { id: pk.id });
  }, 25000);
}

function tick(room) {
  if (!room.started || room.over) return;
  const dt = TICK / 1000;
  const now = Date.now();
  const alive = [...room.players.values()].filter(p => p.alive);

  // Intermedio entre oleadas
  if (room.intermission > 0) {
    room.intermission--;
    if (room.intermission === 0) startWave(room);
  } else if (room.pool > 0 || room.enemies.size > 0) {
    // Aparición progresiva
    room.spawnCd -= dt;
    if (room.queue.length > 0 && room.enemies.size < MAX_ALIVE_ENEMIES && room.spawnCd <= 0) {
      spawnEnemy(room);
      room.spawnCd = Math.max(0.25, 1.4 - room.wave * 0.08);
    }
    // Oleada completada
    if (room.queue.length === 0 && room.enemies.size === 0) {
      const bonus = 250 * room.wave;
      for (const p of room.players.values()) if (p.alive) p.score += bonus;
      io.to(room.code).emit('waveClear', { wave: room.wave, bonus });
      room.intermission = 60; // 6 s
      broadcastRoom(room);
    }
  }

  // IA de enemigos
  const snapshot = [];
  for (const e of room.enemies.values()) {
    const t = ENEMY_TYPES[e.type];
    let target = null, best = Infinity;
    for (const p of alive) {
      const d = (p.x - e.x) ** 2 + (p.z - e.z) ** 2;
      if (d < best) { best = d; target = p; }
    }
    e.atkTimer -= dt;
    if (target) {
      const dist = Math.sqrt(best);
      const dx = (target.x - e.x) / (dist || 1), dz = (target.z - e.z) / (dist || 1);
      e.ry = Math.atan2(dx, dz);
      if (dist > t.reach) {
        e.x += dx * t.speed * dt;
        e.z += dz * t.speed * dt;
        collideCircle(e, 0.45);
        e.anim = 'run';
      } else {
        e.anim = 'attack';
        if (e.atkTimer <= 0) {
          e.atkTimer = t.atkCd;
          target.hp -= t.dmg;
          target.lastHit = now;
          if (target.hp <= 0) {
            target.hp = 0;
            target.alive = false;
            io.to(room.code).emit('playerDead', { id: target.id, by: e.type });
          } else {
            io.to(room.code).emit('playerDamage', { id: target.id, hp: target.hp, from: e.type, ex: e.x, ez: e.z });
          }
        }
      }
    } else {
      e.anim = 'idle';
    }
    snapshot.push([e.id, +e.x.toFixed(2), +e.z.toFixed(2), +e.ry.toFixed(2), e.anim === 'run' ? 1 : e.anim === 'attack' ? 2 : 0]);
  }
  if (snapshot.length) io.to(room.code).emit('enemies', snapshot);

  // Regeneración pasiva (tras 6 s sin recibir daño)
  for (const p of alive) {
    if (p.hp < 100 && now - p.lastHit > 6000) {
      p.hp = Math.min(100, p.hp + 4 * dt);
      p.hpDirty = true;
    }
    if (p.hpDirty && (room.hpSync = (room.hpSync || 0) + 1) % 10 === 0) {
      io.to(room.code).emit('playerHeal', { id: p.id, hp: Math.round(p.hp) });
      p.hpDirty = false;
    }
  }

  // Pickups: recogida por proximidad
  for (const pk of room.pickups.values()) {
    for (const p of alive) {
      if ((p.x - pk.x) ** 2 + (p.z - pk.z) ** 2 < 1.4) {
        room.pickups.delete(pk.id);
        if (pk.kind === 'health') { p.hp = Math.min(100, p.hp + 40); }
        io.to(room.code).emit('pickupTaken', { id: pk.id, by: p.id, kind: pk.kind, hp: Math.round(p.hp) });
        break;
      }
    }
  }

  // Game over: todos muertos
  if (room.wave > 0 && alive.length === 0 && room.players.size > 0) {
    room.over = true;
    const best = [...room.players.values()].sort((a, b) => b.score - a.score);
    io.to(room.code).emit('gameOver', {
      wave: room.wave,
      kills: room.kills,
      scores: best.map(p => ({ id: p.id, name: p.name, score: p.score, kills: p.kills })),
    });
    // La sala vuelve al lobby
    room.started = false;
    room.enemies.clear();
    room.pickups.clear();
    for (const p of room.players.values()) p.ready = false;
    clearInterval(room.timer);
    room.timer = null;
    broadcastRoom(room);
  }
}

function leaveRoom(socket) {
  const room = socket.data.room;
  if (!room) return;
  room.players.delete(socket.id);
  socket.leave(room.code);
  socket.data.room = null;
  if (room.players.size === 0) {
    clearInterval(room.timer);
    rooms.delete(room.code);
  } else {
    // Reasignar host
    if (![...room.players.values()].some(p => p.host)) {
      const first = room.players.values().next().value;
      first.host = true;
    }
    io.to(room.code).emit('playerLeft', { id: socket.id });
    broadcastRoom(room);
  }
}

io.on('connection', (socket) => {
  socket.data.room = null;

  function joinAs(room, name, skin) {
    const player = {
      id: socket.id,
      name: String(name || 'Jugador').slice(0, 16),
      skin: (skin | 0) % 6,
      ready: false,
      host: room.players.size === 0,
      x: 0, y: 0, z: 0, ry: 0, pitch: 0, anim: 'Idle',
      hp: 100, alive: true, score: 0, kills: 0, lastHit: 0,
      lastShot: 0, shotWindow: [],
    };
    room.players.set(socket.id, player);
    socket.join(room.code);
    socket.data.room = room;
    broadcastRoom(room);
    return player;
  }

  socket.on('createRoom', ({ name, skin, isPublic }, cb) => {
    if (socket.data.room) leaveRoom(socket);
    const room = makeRoom(!!isPublic);
    joinAs(room, name, skin);
    cb?.({ ok: true, code: room.code, room: roomInfo(room) });
  });

  socket.on('joinRoom', ({ code, name, skin }, cb) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return cb?.({ ok: false, error: 'La sala no existe.' });
    if (room.players.size >= MAX_PLAYERS) return cb?.({ ok: false, error: 'La sala está llena (máx. 6).' });
    if (room.started) return cb?.({ ok: false, error: 'La partida ya ha comenzado.' });
    if (socket.data.room) leaveRoom(socket);
    joinAs(room, name, skin);
    cb?.({ ok: true, code: room.code, room: roomInfo(room) });
  });

  socket.on('quickMatch', ({ name, skin }, cb) => {
    if (socket.data.room) leaveRoom(socket);
    let room = [...rooms.values()].find(r => r.isPublic && !r.started && r.players.size < MAX_PLAYERS);
    if (!room) room = makeRoom(true);
    joinAs(room, name, skin);
    cb?.({ ok: true, code: room.code, room: roomInfo(room) });
  });

  socket.on('leaveRoom', () => leaveRoom(socket));

  socket.on('setReady', (ready) => {
    const room = socket.data.room;
    const p = room?.players.get(socket.id);
    if (!p) return;
    p.ready = !!ready;
    broadcastRoom(room);
  });

  socket.on('startGame', () => {
    const room = socket.data.room;
    const p = room?.players.get(socket.id);
    if (!room || !p?.host || room.started) return;
    const others = [...room.players.values()].filter(q => !q.host);
    if (others.length && !others.every(q => q.ready)) return;
    startGame(room);
  });

  // Estado del jugador ~15 Hz
  socket.on('state', (s) => {
    const room = socket.data.room;
    const p = room?.players.get(socket.id);
    if (!p || !room.started || !p.alive) return;
    p.x = +s.x || 0; p.y = +s.y || 0; p.z = +s.z || 0;
    p.ry = +s.ry || 0; p.pitch = +s.p || 0; p.anim = s.a;
    collideCircle(p, 0.35, p.y);
    socket.to(room.code).volatile.emit('playerState', { id: socket.id, x: p.x, y: p.y, z: p.z, ry: p.ry, p: p.pitch, a: p.anim });
  });

  // Relay de disparo (tracer + sonido para el resto)
  socket.on('shoot', (s) => {
    const room = socket.data.room;
    const p = room?.players.get(socket.id);
    if (!p || !room.started || !p.alive) return;
    const now = Date.now();
    p.shotWindow = p.shotWindow.filter(t => now - t < 1000);
    if (p.shotWindow.length > 25) return; // rate limit
    p.shotWindow.push(now);
    socket.to(room.code).volatile.emit('shot', { id: socket.id, w: s.w, o: s.o, d: s.d });
  });

  // Impacto sobre enemigo (validado)
  socket.on('hitEnemy', ({ id, dmg, weapon, head }) => {
    const room = socket.data.room;
    const p = room?.players.get(socket.id);
    if (!p || !room.started || !p.alive) return;
    const e = room.enemies.get(id);
    if (!e) return;
    const dist = Math.hypot(e.x - p.x, e.z - p.z);
    if (dist > HIT_MAX_DIST) return;
    const cap = WEAPON_DMG_CAP[weapon] ?? 30;
    let d = Math.min(+dmg || 0, cap);
    if (head) d *= 1.6;
    e.hp -= d;
    if (e.hp <= 0) {
      room.enemies.delete(id);
      room.kills++;
      p.kills++;
      const pts = Math.round(ENEMY_TYPES[e.type].points * (head ? 1.5 : 1));
      p.score += pts;
      io.to(room.code).emit('enemyDead', { id, by: socket.id, byName: p.name, type: e.type, points: pts, x: e.x, z: e.z, head: !!head });
      dropPickup(room, e.x, e.z);
    } else {
      io.to(room.code).emit('enemyHit', { id, hp: e.hp, maxHp: e.maxHp });
    }
  });

  // Revivir a un compañero (el cliente valida proximidad + 3 s de canal; el servidor re-verifica proximidad)
  socket.on('revive', ({ id }) => {
    const room = socket.data.room;
    const p = room?.players.get(socket.id);
    const q = room?.players.get(id);
    if (!p || !q || !room.started || !p.alive || q.alive) return;
    if (Math.hypot(p.x - q.x, p.z - q.z) > 3.5) return;
    q.alive = true;
    q.hp = 50;
    q.lastHit = Date.now();
    io.to(room.code).emit('playerRespawn', { id: q.id, x: q.x, z: q.z, hp: q.hp, revived: true, by: p.name });
    broadcastRoom(room);
  });

  socket.on('chat', (msg) => {
    const room = socket.data.room;
    const p = room?.players.get(socket.id);
    if (!p) return;
    io.to(room.code).emit('chat', { name: p.name, msg: String(msg).slice(0, 120) });
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

server.listen(PORT, () => console.log(`NEXUS ARENA escuchando en http://localhost:${PORT}`));
