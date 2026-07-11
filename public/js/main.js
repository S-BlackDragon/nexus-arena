// NEXUS ARENA — Controlador de aplicación: pantallas, lobby, ajustes, guardado
import { loadAssets } from './assets.js';
import { Game } from './game.js';
import { Net } from './net.js';
import {
  settings, profile, saveSettings, saveProfile, recordGame,
  SKIN_COLORS, WEAPON_UNLOCKS, unlockedWeapons,
} from './settings.js';
import { initAudio, resumeAudio, applyVolumes, sfx } from './audio.js';

const $ = id => document.getElementById(id);
const screens = ['loading', 'menu', 'multi', 'lobby', 'settings', 'help', 'pause', 'gameover'];

let net = null;
let game = null;
let currentRoom = null;
let inGame = false;
let settingsReturnTo = 'menu';

function show(name) {
  for (const s of screens) $('screen-' + s).classList.remove('active');
  if (name) $('screen-' + name).classList.add('active');
}

// ═══════════ PERFIL / GUARDADO ═══════════
function refreshProfileUI() {
  $('inp-name').value = profile.name;
  $('st-bestwave').textContent = profile.bestWave;
  $('st-kills').textContent = profile.totalKills;
  $('st-score').textContent = profile.bestScore;
  $('st-games').textContent = profile.gamesPlayed;

  const picker = $('skin-picker');
  picker.innerHTML = '';
  SKIN_COLORS.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'skin-swatch' + (i === profile.skin ? ' sel' : '');
    sw.style.background = '#' + c.toString(16).padStart(6, '0');
    sw.onclick = () => { profile.skin = i; saveProfile(); refreshProfileUI(); sfx.click(); };
    picker.appendChild(sw);
  });

  const unlocked = unlockedWeapons();
  $('unlock-list').innerHTML = WEAPON_UNLOCKS.map(w => {
    const ok = unlocked.includes(w.id);
    return `<div class="unlock-item ${ok ? '' : 'locked'}">
      <span>${ok ? '🔓' : '🔒'} ${w.name}</span>
      <small>${ok ? 'DESBLOQUEADA' : `${w.kills} bajas`}</small></div>`;
  }).join('');
}

$('inp-name').addEventListener('change', () => {
  profile.name = $('inp-name').value.trim() || 'Operador';
  saveProfile();
});

// ═══════════ AJUSTES ═══════════
function bindSetting(id, key, outId, fmt = v => v) {
  const el = $(id);
  el.value = settings[key];
  if (outId) $(outId).textContent = fmt(settings[key]);
  el.addEventListener('input', () => {
    settings[key] = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? +el.value : el.value);
    if (outId) $(outId).textContent = fmt(settings[key]);
    saveSettings();
    applyVolumes();
  });
  if (el.type === 'checkbox') el.checked = settings[key];
}

function initSettingsUI() {
  bindSetting('set-sens', 'sens', 'out-sens', v => (+v).toFixed(1));
  bindSetting('set-fov', 'fov', 'out-fov', v => v + '°');
  bindSetting('set-master', 'master', 'out-master', v => Math.round(v * 100) + '%');
  bindSetting('set-music', 'music', 'out-music', v => Math.round(v * 100) + '%');
  bindSetting('set-sfx', 'sfx', 'out-sfx', v => Math.round(v * 100) + '%');
  bindSetting('set-quality', 'quality');
  bindSetting('set-inverty', 'invertY');
  bindSetting('set-fps', 'showFps');
}

// ═══════════ LOBBY ═══════════
function renderLobby(info) {
  currentRoom = info;
  $('lobby-code').textContent = info.code;
  const meId = net.id;
  const me = info.players.find(p => p.id === meId);
  $('lobby-players').innerHTML = info.players.map(p => `
    <li>
      <span class="dot" style="background:#${SKIN_COLORS[p.skin % SKIN_COLORS.length].toString(16).padStart(6, '0')}"></span>
      <span>${p.name}${p.id === meId ? ' (tú)' : ''}</span>
      <span class="tag ${p.host ? 'host' : p.ready ? 'ready' : ''}">${p.host ? '★ HOST' : p.ready ? 'LISTO ✓' : 'ESPERANDO'}</span>
    </li>`).join('');

  const isHost = !!me?.host;
  const others = info.players.filter(p => !p.host);
  const allReady = others.every(p => p.ready);
  $('btn-start').style.display = isHost ? '' : 'none';
  $('btn-start').disabled = !(isHost && (others.length === 0 || allReady));
  $('btn-ready').style.display = isHost ? 'none' : '';
  $('btn-ready').textContent = me?.ready ? 'No listo ✗' : 'Listo ✓';
  $('lobby-hint').textContent = isHost
    ? (others.length === 0 ? 'Puedes empezar solo o esperar a más jugadores.'
       : allReady ? '¡Todos listos! Puedes iniciar.' : 'Esperando a que todos estén listos…')
    : 'Esperando a que el host inicie la partida…';
}

// ═══════════ PARTIDA ═══════════
function startGameSession(playersInfo) {
  inGame = true;
  show(null); // sin pantallas: juego + HUD
  game = new Game($('game-canvas'), net);
  window.NEXUS = { game, net };
  game.onPauseRequest = () => {
    if (!inGame || game.gameEnded) return;
    game.setPaused(true);
    show('pause');
  };
  game.onGameOver = (data, myStats) => {
    recordGame({ wave: data.wave, score: myStats.score, kills: myStats.kills });
    refreshProfileUI();
    $('go-subtitle').textContent = `Habéis resistido hasta la oleada ${data.wave} · ${data.kills} bajas de equipo`;
    $('go-body').innerHTML = data.scores.map(s =>
      `<tr><td>${s.name}${s.id === net.id ? ' (tú)' : ''}</td><td>${s.score}</td><td>${s.kills}</td></tr>`).join('');
    setTimeout(() => {
      endGameSession();
      show('gameover');
    }, 2500);
  };
  game.start(playersInfo, profile.skin);
}

function endGameSession() {
  inGame = false;
  if (game) { game.stop(); game = null; }
}

function quitToMenu() {
  endGameSession();
  net.emit('leaveRoom');
  currentRoom = null;
  show('menu');
  refreshProfileUI();
}

// ═══════════ EVENTOS DE RED (lobby) ═══════════
function bindNetLobby() {
  net.on('roomUpdate', info => {
    if (!inGame) renderLobby(info);
    else currentRoom = info;
  });
  net.on('gameStart', ({ players }) => {
    startGameSession(players);
  });
  net.on('disconnect', () => {
    if (inGame) { endGameSession(); }
    show('menu');
    $('multi-error').textContent = 'Conexión perdida con el servidor.';
  });
}

// ═══════════ BOTONES ═══════════
function bindButtons() {
  // Menú principal
  $('btn-solo').onclick = async () => {
    resumeAudio(); sfx.click();
    const res = await net.createRoom(profile.name, profile.skin, false);
    if (res?.ok) net.emit('startGame');
  };
  $('btn-multi').onclick = () => { resumeAudio(); sfx.click(); $('multi-error').textContent = ''; show('multi'); };
  $('btn-settings').onclick = () => { sfx.click(); settingsReturnTo = 'menu'; show('settings'); };
  $('btn-help').onclick = () => { sfx.click(); show('help'); };

  // Multijugador
  $('btn-quick').onclick = async () => {
    sfx.click();
    const res = await net.quickMatch(profile.name, profile.skin);
    if (res?.ok) { renderLobby(res.room); show('lobby'); }
    else $('multi-error').textContent = res?.error || 'Error de conexión.';
  };
  $('btn-create-public').onclick = async () => {
    sfx.click();
    const res = await net.createRoom(profile.name, profile.skin, true);
    if (res?.ok) { renderLobby(res.room); show('lobby'); }
  };
  $('btn-create-private').onclick = async () => {
    sfx.click();
    const res = await net.createRoom(profile.name, profile.skin, false);
    if (res?.ok) { renderLobby(res.room); show('lobby'); }
  };
  $('btn-join').onclick = async () => {
    sfx.click();
    const code = $('inp-code').value.trim().toUpperCase();
    if (code.length !== 4) { $('multi-error').textContent = 'El código tiene 4 caracteres.'; return; }
    const res = await net.joinRoom(code, profile.name, profile.skin);
    if (res?.ok) { renderLobby(res.room); show('lobby'); }
    else $('multi-error').textContent = res?.error || 'No se pudo unir.';
  };
  $('inp-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
  $('btn-multi-back').onclick = () => { sfx.click(); show('menu'); };

  // Lobby
  $('btn-ready').onclick = () => {
    sfx.click();
    const me = currentRoom?.players.find(p => p.id === net.id);
    net.emit('setReady', !me?.ready);
  };
  $('btn-start').onclick = () => { sfx.click(); net.emit('startGame'); };
  $('btn-lobby-leave').onclick = () => {
    sfx.click();
    net.emit('leaveRoom');
    currentRoom = null;
    show('multi');
  };

  // Ajustes
  $('btn-settings-back').onclick = () => {
    sfx.click();
    if (settingsReturnTo === 'pause') show('pause');
    else show('menu');
  };
  $('btn-help-back').onclick = () => { sfx.click(); show('menu'); };

  // Pausa
  $('btn-resume').onclick = () => {
    sfx.click();
    show(null);
    game?.setPaused(false);
  };
  $('btn-pause-settings').onclick = () => { sfx.click(); settingsReturnTo = 'pause'; show('settings'); };
  $('btn-quit').onclick = () => { sfx.click(); quitToMenu(); };

  // Fin de partida
  $('btn-go-lobby').onclick = () => {
    sfx.click();
    if (currentRoom) { renderLobby(currentRoom); show('lobby'); }
    else show('menu');
  };
  $('btn-go-menu').onclick = () => { sfx.click(); quitToMenu(); };

  // Primer gesto → activar audio
  document.addEventListener('pointerdown', () => { initAudio(); resumeAudio(); }, { once: true });
}

// ═══════════ ARRANQUE ═══════════
async function boot() {
  initSettingsUI();
  refreshProfileUI();
  bindButtons();

  try {
    await loadAssets((frac, label) => {
      $('load-fill').style.width = Math.round(frac * 100) + '%';
      $('load-text').textContent = `Cargando: ${label}… ${Math.round(frac * 100)}%`;
    });
  } catch (err) {
    $('load-text').textContent = 'Error cargando recursos: ' + err.message;
    console.error(err);
    return;
  }

  $('load-text').textContent = 'Conectando con el servidor…';
  net = new Net();
  bindNetLobby();

  const goMenu = () => { show('menu'); };
  if (net.connected) goMenu();
  else net.on('connect', goMenu);

  initAudio();
}

boot();
