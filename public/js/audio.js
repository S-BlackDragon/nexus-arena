// Audio 100% procedural con WebAudio: sin ficheros, cero latencia de carga.
import { settings } from './settings.js';

let ctx = null;
let masterGain, musicGain, sfxGain;
let musicPlaying = false;
let musicNodes = [];

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  musicGain = ctx.createGain();
  sfxGain = ctx.createGain();
  musicGain.connect(masterGain);
  sfxGain.connect(masterGain);
  masterGain.connect(ctx.destination);
  applyVolumes();
}

export function applyVolumes() {
  if (!ctx) return;
  masterGain.gain.value = settings.master;
  musicGain.gain.value = settings.music * 0.5;
  sfxGain.gain.value = settings.sfx;
}

export function resumeAudio() { if (ctx?.state === 'suspended') ctx.resume(); }

function noiseBuffer(dur = 1) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
let _noise;
function getNoise() { return (_noise ||= noiseBuffer(2)); }

function env(node, t0, a, peak, dec, end = 0.0001) {
  node.gain.setValueAtTime(0.0001, t0);
  node.gain.linearRampToValueAtTime(peak, t0 + a);
  node.gain.exponentialRampToValueAtTime(end, t0 + a + dec);
}

// ─── SFX ───
export const sfx = {
  shot(weapon = 'rifle') {
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.connect(sfxGain);
    const n = ctx.createBufferSource();
    n.buffer = getNoise();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    const p = { pistol: [1800, 0.09, 0.5], rifle: [2400, 0.08, 0.45], smg: [3000, 0.06, 0.35], shotgun: [900, 0.22, 0.75] }[weapon] || [2000, 0.1, 0.5];
    f.frequency.setValueAtTime(p[0], t);
    f.frequency.exponentialRampToValueAtTime(200, t + p[1]);
    n.connect(f); f.connect(g);
    env(g, t, 0.001, p[2], p[1]);
    n.start(t); n.stop(t + p[1] + 0.05);
    // golpe grave
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(weapon === 'shotgun' ? 90 : 140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    o.connect(og); og.connect(sfxGain);
    env(og, t, 0.001, 0.5, 0.1);
    o.start(t); o.stop(t + 0.15);
  },
  reload() {
    if (!ctx) return;
    [0, 0.18, 0.42].forEach((dt, i) => {
      const t = ctx.currentTime + dt;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = i === 2 ? 1400 : 800 + i * 200;
      o.connect(g); g.connect(sfxGain);
      env(g, t, 0.001, 0.12, 0.05);
      o.start(t); o.stop(t + 0.08);
    });
  },
  dryFire() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 500;
    o.connect(g); g.connect(sfxGain);
    env(g, t, 0.001, 0.1, 0.04);
    o.start(t); o.stop(t + 0.06);
  },
  hit(head = false) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(head ? 1300 : 900, t);
    o.frequency.exponentialRampToValueAtTime(head ? 700 : 500, t + 0.07);
    o.connect(g); g.connect(sfxGain);
    env(g, t, 0.001, 0.35, 0.07);
    o.start(t); o.stop(t + 0.1);
  },
  enemyDie() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    o.connect(g); g.connect(sfxGain);
    env(g, t, 0.005, 0.3, 0.4);
    o.start(t); o.stop(t + 0.5);
    const n = ctx.createBufferSource(); n.buffer = getNoise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500;
    const ng = ctx.createGain();
    n.connect(f); f.connect(ng); ng.connect(sfxGain);
    env(ng, t, 0.005, 0.2, 0.3);
    n.start(t); n.stop(t + 0.4);
  },
  hurt() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
    o.connect(g); g.connect(sfxGain);
    env(g, t, 0.002, 0.4, 0.2);
    o.start(t); o.stop(t + 0.25);
  },
  pickup(kind = 'ammo') {
    if (!ctx) return;
    const t = ctx.currentTime;
    const freqs = kind === 'health' ? [520, 780] : [420, 630];
    freqs.forEach((fq, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = fq;
      o.connect(g); g.connect(sfxGain);
      env(g, t + i * 0.09, 0.005, 0.25, 0.12);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.16);
    });
  },
  waveHorn() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [110, 165, 220].forEach(fq => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = fq;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800;
      o.connect(f); f.connect(g); g.connect(sfxGain);
      env(g, t, 0.08, 0.16, 1.1);
      o.start(t); o.stop(t + 1.3);
    });
  },
  waveClear() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((fq, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = fq;
      o.connect(g); g.connect(sfxGain);
      env(g, t + i * 0.12, 0.01, 0.22, 0.3);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.35);
    });
  },
  revive() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, t);
    o.frequency.linearRampToValueAtTime(900, t + 0.4);
    o.connect(g); g.connect(sfxGain);
    env(g, t, 0.02, 0.3, 0.45);
    o.start(t); o.stop(t + 0.5);
  },
  click() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 1100;
    o.connect(g); g.connect(sfxGain);
    env(g, t, 0.001, 0.12, 0.04);
    o.start(t); o.stop(t + 0.06);
  },
};

// ─── Música ambiental (pad oscuro en loop) ───
export function startMusic() {
  if (!ctx || musicPlaying) return;
  musicPlaying = true;
  const chords = [[55, 82.4, 110], [49, 73.4, 98], [58.3, 87.3, 116.5], [43.7, 65.4, 87.3]];
  let idx = 0;
  function playChord() {
    if (!musicPlaying) return;
    const t = ctx.currentTime;
    const dur = 7;
    chords[idx % chords.length].forEach(fq => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = fq;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 260; f.Q.value = 1.2;
      o.connect(f); f.connect(g); g.connect(musicGain);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 2.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.1);
      musicNodes.push(o);
    });
    idx++;
    musicTimer = setTimeout(playChord, (dur - 2.2) * 1000);
  }
  let musicTimer;
  playChord();
  musicNodes.stopTimer = () => clearTimeout(musicTimer);
}

export function stopMusic() {
  musicPlaying = false;
  musicNodes.stopTimer?.();
  musicNodes = [];
}
