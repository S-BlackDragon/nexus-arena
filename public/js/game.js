// NEXUS ARENA — Motor del juego (cliente)
import * as THREE from 'three';
import { assets, makeSoldier, makeRobot, makeGunMesh } from './assets.js';
import { buildWorld } from './world.js';
import { WEAPONS, WEAPON_ORDER, initialReserve } from './weapons.js';
import { Effects } from './effects.js';
import { collideCircle, groundHeight } from './shared/map.js';
import { settings, unlockedWeapons, QUALITY_PRESETS, SKIN_COLORS } from './settings.js';
import { sfx, startMusic, stopMusic } from './audio.js';

const GRAVITY = -26;
const EYE = 1.62;

const $ = id => document.getElementById(id);

export class Game {
  constructor(canvas, net) {
    this.canvas = canvas;
    this.net = net;
    this.running = false;
    this.onGameOver = null;   // callback(data)
    this.onPauseRequest = null;
    this._netHandlers = [];
    this._domHandlers = [];
  }

  // ═══════════ ARRANQUE ═══════════
  start(playersInfo, mySkin) {
    this.running = true;
    this.paused = false;
    this.quality = QUALITY_PRESETS[settings.quality] || QUALITY_PRESETS.high;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: settings.quality !== 'low' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.08, 400);

    const { raycastables } = buildWorld(this.scene, this.quality);
    this.worldMeshes = raycastables;
    this.effects = new Effects(this.scene);

    // ─── Estado local ───
    const meInfo = playersInfo.find(p => p.id === this.net.id) || { x: 0, z: 6 };
    this.me = {
      pos: new THREE.Vector3(meInfo.x, 0, meInfo.z),
      vel: new THREE.Vector3(),
      yaw: Math.PI, pitch: 0,
      onGround: true,
      hp: 100, alive: true,
      score: 0, kills: 0,
    };
    this.view = 'fp'; // 'fp' | 'tp'
    this.keys = {};
    this.mouseDown = false;
    this.lastShot = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.reviveTarget = null;
    this.reviveTime = 0;
    this.recoilPitch = 0;

    // Armas
    this.unlocked = unlockedWeapons();
    this.ammo = {};
    for (const id of WEAPON_ORDER) {
      this.ammo[id] = { mag: WEAPONS[id].mag, reserve: initialReserve(id) };
    }
    this.currentWeapon = this.unlocked.includes('rifle') ? 'rifle' : 'pistol';

    // Modelo propio (visible en 3ª persona)
    const myColor = SKIN_COLORS[(mySkin | 0) % SKIN_COLORS.length];
    this.myModel = makeSoldier(myColor);
    this.myModel.group.visible = false;
    this.scene.add(this.myModel.group);
    this._playSoldierAnim(this.myModel, 'Idle');
    this._attachHandGun(this.myModel);

    // Viewmodel (1ª persona)
    this.viewmodel = new THREE.Group();
    this.camera.add(this.viewmodel);
    this.scene.add(this.camera);
    this._buildViewmodel();

    // ─── Jugadores remotos / enemigos / pickups ───
    this.remotes = new Map();   // id -> {model, target:{pos,ry,pitch}, anim, alive, name, label}
    this.enemies = new Map();   // id -> {model, type, target, hp, maxHp, dead, bar}
    this.pickups = new Map();   // id -> {group, kind}
    this.scores = new Map();    // id -> {name, score, kills, alive}
    for (const p of playersInfo) {
      this.scores.set(p.id, { name: p.name, score: 0, kills: 0, alive: true });
      if (p.id !== this.net.id) this._addRemote(p);
    }

    // HUD
    this.waveTotal = 0; this.waveDead = 0; this.wave = 0;
    this._hud('wave-num', '—'); this._hud('enemies-num', '0'); this._hud('score-num', '0');
    this._updateHpHud(); this._updateAmmoHud(); this._updateWeaponHud();
    $('hud').classList.remove('hidden');
    $('spectate-banner').classList.add('hidden');
    $('killfeed').innerHTML = '';
    $('chat-log').innerHTML = '';

    this._bindInput();
    this._bindNet();

    // Pre-calentado de shaders: compila los programas de robots, pickups y efectos
    // ahora, para que la primera aparición/muerte no cause un tirón de FPS.
    this._prewarmShaders();

    this.clock = new THREE.Clock();
    this.netTimer = 0;
    this.fpsTime = 0; this.fpsFrames = 0;
    startMusic();
    this.renderer.setAnimationLoop(() => this._frame());
    this.requestPointerLock();
  }

  requestPointerLock() {
    if (this.running && !document.pointerLockElement) {
      try {
        const p = this.canvas.requestPointerLock();
        p?.catch?.(() => {});
      } catch { /* algunos navegadores lanzan si no hay gesto de usuario */ }
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.renderer?.setAnimationLoop(null);
    stopMusic();
    document.exitPointerLock?.();
    for (const [ev, fn] of this._netHandlers) this.net.off(ev, fn);
    this._netHandlers = [];
    for (const [tgt, ev, fn] of this._domHandlers) tgt.removeEventListener(ev, fn);
    this._domHandlers = [];
    this.effects?.dispose();
    this.scene?.traverse(o => {
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose?.());
    });
    this.renderer?.dispose();
    this.renderer = null;
    $('hud').classList.add('hidden');
  }

  setPaused(v) { this.paused = v; if (!v) this.requestPointerLock(); }

  // ═══════════ INPUT ═══════════
  _on(tgt, ev, fn, opts) { tgt.addEventListener(ev, fn, opts); this._domHandlers.push([tgt, ev, fn]); }

  _bindInput() {
    this._on(document, 'keydown', e => {
      if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); this._renderScoreboard(); return; }
      if (this.chatOpen) {
        if (e.code === 'Enter') this._sendChat();
        if (e.code === 'Escape') this._closeChat(false);
        return;
      }
      this.keys[e.code] = true;
      if (e.code === 'KeyV') this._toggleView();
      if (e.code === 'KeyR') this._startReload();
      if (e.code === 'KeyT') { e.preventDefault(); this._openChat(); }
      const wIdx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (wIdx >= 0) this._switchWeapon(WEAPON_ORDER[wIdx]);
    });
    this._on(document, 'keyup', e => { this.keys[e.code] = false; });
    this._on(document, 'mousedown', e => {
      if (!document.pointerLockElement || this.paused) return;
      if (e.button === 0) { this.mouseDown = true; this._tryFire(); }
    });
    this._on(document, 'mouseup', e => { if (e.button === 0) this.mouseDown = false; });
    this._on(document, 'mousemove', e => {
      if (!document.pointerLockElement || this.paused) return;
      const s = settings.sens * 0.0021;
      this.me.yaw -= e.movementX * s;
      const dy = e.movementY * s * (settings.invertY ? -1 : 1);
      this.me.pitch = Math.max(-1.45, Math.min(1.45, this.me.pitch - dy));
    });
    this._on(document, 'wheel', e => {
      if (!document.pointerLockElement || this.paused) return;
      const avail = WEAPON_ORDER.filter(w => this.unlocked.includes(w));
      let i = avail.indexOf(this.currentWeapon);
      i = (i + (e.deltaY > 0 ? 1 : -1) + avail.length) % avail.length;
      this._switchWeapon(avail[i]);
    });
    this._on(document, 'keyup', e => {
      if (e.code === 'Tab') $('scoreboard').classList.add('hidden');
    });
    this._on(window, 'resize', () => {
      if (!this.renderer) return;
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    // Esc = salir de pointer lock → pausa
    this._on(document, 'pointerlockchange', () => {
      if (!document.pointerLockElement && this.running && !this.chatOpen && !this.gameEnded) {
        this.onPauseRequest?.();
      }
    });
  }

  _openChat() {
    this.chatOpen = true;
    document.exitPointerLock?.();
    const inp = $('chat-input');
    inp.classList.remove('hidden');
    setTimeout(() => inp.focus(), 50);
  }
  _closeChat(send) {
    const inp = $('chat-input');
    if (send && inp.value.trim()) this.net.emit('chat', inp.value.trim());
    inp.value = '';
    inp.classList.add('hidden');
    this.chatOpen = false;
    inp.blur();
    this.requestPointerLock();
  }
  _sendChat() { this._closeChat(true); }

  // ═══════════ RED ═══════════
  _net(ev, fn) { this.net.on(ev, fn); this._netHandlers.push([ev, fn]); }

  _bindNet() {
    this._net('playerState', s => {
      const r = this.remotes.get(s.id);
      if (!r) return;
      r.target.pos.set(s.x, s.y, s.z);
      r.target.ry = s.ry;
      r.anim = s.a || 'Idle';
    });

    this._net('shot', s => {
      const from = new THREE.Vector3(...s.o);
      const dir = new THREE.Vector3(...s.d).normalize();
      const end = this._raycastWorldEnd(from, dir, WEAPONS[s.w]?.range || 100);
      this.effects.tracer(from, end);
      this.effects.muzzleFlash(from);
      sfx.shot(s.w);
    });

    this._net('enemySpawn', e => this._spawnEnemy(e));

    this._net('enemies', snap => {
      for (const [id, x, z, ry, anim] of snap) {
        const e = this.enemies.get(id);
        if (!e || e.dead) continue;
        e.target.pos.set(x, 0, z);
        e.target.ry = ry;
        e.serverAnim = anim;
      }
    });

    this._net('enemyHit', ({ id, hp }) => {
      const e = this.enemies.get(id);
      if (!e) return;
      e.hp = hp;
      this._updateEnemyBar(e);
    });

    this._net('enemyDead', d => {
      const e = this.enemies.get(d.id);
      if (e) this._killEnemy(e, d);
      this.waveDead++;
      this._hud('enemies-num', Math.max(0, this.waveTotal - this.waveDead));
      const sc = this.scores.get(d.by);
      if (sc) { sc.score += d.points; sc.kills++; }
      if (d.by === this.net.id) {
        this.me.score += d.points; this.me.kills++;
        this._hud('score-num', this.me.score);
        this._killfeed(`<b>${d.byName}</b> eliminó ${this._enemyName(d.type)} ${d.head ? '💀 HEADSHOT' : ''} +${d.points}`);
      } else {
        this._killfeed(`<b>${d.byName}</b> eliminó ${this._enemyName(d.type)}`);
      }
      sfx.enemyDie();
    });

    this._net('playerDamage', d => {
      const sc = this.scores.get(d.id);
      if (d.id === this.net.id) {
        this.me.hp = d.hp;
        this._updateHpHud();
        this._damageFlash();
        sfx.hurt();
      }
    });

    this._net('playerHeal', d => {
      if (d.id === this.net.id) { this.me.hp = d.hp; this._updateHpHud(); }
    });

    this._net('playerDead', d => {
      const sc = this.scores.get(d.id);
      if (sc) sc.alive = false;
      if (d.id === this.net.id) {
        this.me.alive = false;
        this.me.hp = 0;
        this._updateHpHud();
        $('spectate-banner').classList.remove('hidden');
        this.view = 'tp';
        this._applyViewMode();
      } else {
        const r = this.remotes.get(d.id);
        if (r) { r.alive = false; r.deathT = 0; }
        this._killfeed(`<b>${sc?.name || '?'}</b> ha caído ☠`);
      }
    });

    this._net('playerRespawn', d => {
      const sc = this.scores.get(d.id);
      if (sc) sc.alive = true;
      if (d.id === this.net.id) {
        this.me.alive = true;
        this.me.hp = d.hp;
        this.me.pos.set(d.x, 0, d.z);
        this.me.vel.set(0, 0, 0);
        this._updateHpHud();
        $('spectate-banner').classList.add('hidden');
        this.view = 'fp';
        this._applyViewMode();
        if (d.revived) { sfx.revive(); this._killfeed(`<b>${d.by}</b> te ha revivido ✚`); }
      } else {
        const r = this.remotes.get(d.id);
        if (r) {
          r.alive = true;
          r.model.group.rotation.x = 0;
          r.target.pos.set(d.x, 0, d.z);
          r.model.group.position.set(d.x, 0, d.z);
          if (d.revived) sfx.revive();
        }
      }
    });

    this._net('pickupSpawn', pk => this._spawnPickup(pk));
    this._net('pickupGone', ({ id }) => this._removePickup(id));
    this._net('pickupTaken', ({ id, by, kind, hp }) => {
      this._removePickup(id);
      if (by === this.net.id) {
        sfx.pickup(kind);
        if (kind === 'ammo') {
          for (const wid of WEAPON_ORDER) {
            if (wid === 'pistol') continue;
            const w = WEAPONS[wid];
            this.ammo[wid].reserve = Math.min(w.reserveMax, this.ammo[wid].reserve + w.mag);
          }
          this._updateAmmoHud();
          this._killfeed('Munición recogida <b>+recarga</b>');
        } else {
          this.me.hp = hp;
          this._updateHpHud();
          this._killfeed('Botiquín <b>+40 PS</b>');
        }
      }
    });

    this._net('waveStart', ({ wave, total }) => {
      this.wave = wave; this.waveTotal = total; this.waveDead = 0;
      this._hud('wave-num', wave);
      this._hud('enemies-num', total);
      this._announce(`OLEADA ${wave}`, `${total} HOSTILES ENTRANTES`);
      sfx.waveHorn();
    });

    this._net('waveClear', ({ wave, bonus }) => {
      this._announce('OLEADA SUPERADA', `+${bonus} PUNTOS · siguiente oleada en 6 s`);
      sfx.waveClear();
      if (this.scores.get(this.net.id)?.alive !== false && this.me.alive) {
        this.me.score += bonus;
        this._hud('score-num', this.me.score);
      }
      for (const sc of this.scores.values()) if (sc.alive) sc.score += bonus;
    });

    this._net('gameOver', data => {
      this.gameEnded = true;
      this.onGameOver?.(data, { wave: this.wave, score: this.me.score, kills: this.me.kills });
    });

    this._net('playerLeft', ({ id }) => {
      const r = this.remotes.get(id);
      if (r) { this.scene.remove(r.model.group); this.remotes.delete(id); }
      this.scores.delete(id);
    });

    this._net('roomUpdate', info => {
      for (const p of info.players) {
        const sc = this.scores.get(p.id);
        if (sc) { sc.name = p.name; }
      }
    });

    this._net('chat', ({ name, msg }) => this._chatLine(name, msg));
  }

  // ═══════════ JUGADORES REMOTOS ═══════════
  _addRemote(p) {
    const color = SKIN_COLORS[(p.skin | 0) % SKIN_COLORS.length];
    const model = makeSoldier(color);
    model.group.position.set(p.x || 0, 0, p.z || 0);
    this.scene.add(model.group);
    this._attachHandGun(model);
    this._playSoldierAnim(model, 'Idle');
    const label = this._makeNameLabel(p.name, color);
    label.position.y = 2.05;
    model.group.add(label);
    this.remotes.set(p.id, {
      model,
      target: { pos: new THREE.Vector3(p.x || 0, 0, p.z || 0), ry: 0 },
      anim: 'Idle', current: 'Idle',
      alive: true, name: p.name, deathT: -1,
    });
  }

  _makeNameLabel(name, color) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const c = cv.getContext('2d');
    c.font = 'bold 34px Segoe UI, sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(0,0,0,0.55)';
    const w = Math.min(240, c.measureText(name).width + 24);
    c.fillRect(128 - w / 2, 8, w, 46);
    c.fillStyle = '#' + new THREE.Color(color).getHexString();
    c.fillText(name, 128, 42);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(1.6, 0.4, 1);
    return sp;
  }

  _playSoldierAnim(model, name, fade = 0.22) {
    const map = { Idle: 'Idle', Walk: 'Walk', Run: 'Run' };
    const clip = map[name] || 'Idle';
    if (model._current === clip) return;
    const next = model.actions[clip];
    if (!next) return;
    const prev = model.actions[model._current];
    next.reset().setEffectiveWeight(1).play();
    if (prev && prev !== next) { next.crossFadeFrom(prev, fade, true); }
    model._current = clip;
  }

  _attachHandGun(model) {
    let hand = null;
    model.root.traverse(o => { if (!hand && /RightHand$/i.test(o.name)) hand = o; });
    const gun = makeGunMesh('rifle');
    gun.scale.setScalar(0.85);
    if (hand) {
      gun.rotation.set(Math.PI / 2 + 0.2, 0, Math.PI / 2);
      gun.position.set(0.05, 0.12, 0.03);
      hand.add(gun);
    }
    model.handGun = gun;
  }

  _prewarmShaders() {
    const temps = [];
    for (const type of ['grunt', 'runner', 'tank']) {
      const m = makeRobot(type, 1);
      m.group.position.set(0, -60, 0);
      this.scene.add(m.group);
      temps.push(m.group);
    }
    const pickupTemp = { id: -1, kind: 'health', x: 0, z: 0 };
    this._spawnPickup(pickupTemp);
    const pk = this.pickups.get(-1);
    pk.group.position.y = -60;
    this.effects.prewarm(this.renderer, this.camera);
    this.renderer.compile(this.scene, this.camera);
    for (const g of temps) this.scene.remove(g);
    this._removePickup(-1);
  }

  // ═══════════ ENEMIGOS ═══════════
  _enemyName(t) { return { grunt: 'un CENTINELA', runner: 'un ACECHADOR', tank: 'un DEVASTADOR' }[t] || 'un robot'; }

  _spawnEnemy(e) {
    const scale = { grunt: 1, runner: 0.85, tank: 1.45 }[e.type] || 1;
    const model = makeRobot(e.type, scale);
    model.group.position.set(e.x, 0, e.z);
    this.scene.add(model.group);
    // barra de vida
    const bar = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x38d977, depthTest: false }));
    bar.scale.set(0.9 * scale, 0.07, 1);
    bar.position.y = 2.15 * scale;
    model.group.add(bar);
    const ent = {
      id: e.id, model, type: e.type, scale,
      target: { pos: new THREE.Vector3(e.x, 0, e.z), ry: 0 },
      hp: e.hp, maxHp: e.maxHp, dead: false, deathT: 0,
      serverAnim: 0, currentClip: null, bar,
    };
    for (const hb of model.hitboxes) hb.userData.enemyId = e.id;
    this.enemies.set(e.id, ent);
    this._playRobotAnim(ent, 'Idle');
    this.effects.explosion(model.group.position.clone());
  }

  _playRobotAnim(ent, clip, once = false) {
    if (ent.currentClip === clip) return;
    const next = ent.model.actions[clip];
    if (!next) return;
    const prev = ent.model.actions[ent.currentClip];
    next.reset();
    if (once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }
    next.play();
    if (prev && prev !== next) next.crossFadeFrom(prev, 0.18, true);
    ent.currentClip = clip;
  }

  _updateEnemyBar(e) {
    const f = Math.max(0, e.hp / e.maxHp);
    e.bar.scale.x = 0.9 * e.scale * f + 0.001;
    e.bar.material.color.setHSL(f * 0.33, 0.9, 0.5);
  }

  _killEnemy(e, d) {
    e.dead = true;
    e.deathT = 0;
    e.bar.visible = false;
    this._playRobotAnim(e, 'Death', true);
    this.effects.explosion(e.model.group.position.clone());
  }

  // ═══════════ PICKUPS ═══════════
  _spawnPickup(pk) {
    const group = new THREE.Group();
    const isHp = pk.kind === 'health';
    const color = isHp ? 0x38d977 : 0xffd23b;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.3, 0.44),
      new THREE.MeshStandardMaterial({ color: 0x22262c, emissive: color, emissiveIntensity: 1.4, roughness: 0.4, metalness: 0.6 })
    );
    box.position.y = 0.3;
    box.castShadow = true;
    // anillo emisivo en el suelo en lugar de PointLight (añadir luces recompila shaders)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.72, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(box, ring);
    group.position.set(pk.x, 0, pk.z);
    this.scene.add(group);
    this.pickups.set(pk.id, { group, kind: pk.kind, t: Math.random() * 6 });
  }

  _removePickup(id) {
    const pk = this.pickups.get(id);
    if (!pk) return;
    this.scene.remove(pk.group);
    this.pickups.delete(id);
  }

  // ═══════════ ARMAS ═══════════
  _buildViewmodel() {
    this.viewmodel.clear();
    this.gunMesh = makeGunMesh(this.currentWeapon);
    this.gunMesh.position.set(0.22, -0.2, -0.42);
    this.viewmodel.add(this.gunMesh);
    this.gunBaseY = -0.2;
  }

  _switchWeapon(id) {
    if (!id || !this.unlocked.includes(id) || id === this.currentWeapon || this.reloading) return;
    this.currentWeapon = id;
    this._buildViewmodel();
    this._updateWeaponHud();
    this._updateAmmoHud();
    sfx.click();
  }

  _updateWeaponHud() { this._hud('weapon-name', WEAPONS[this.currentWeapon].name); }

  _updateAmmoHud() {
    const a = this.ammo[this.currentWeapon];
    this._hud('ammo-mag', a.mag);
    $('ammo-reserve').textContent = a.reserve === Infinity ? '/ ∞' : `/ ${a.reserve}`;
    $('ammo').classList.toggle('reloading', this.reloading);
  }

  _startReload() {
    const a = this.ammo[this.currentWeapon];
    const w = WEAPONS[this.currentWeapon];
    if (this.reloading || a.mag >= w.mag || a.reserve <= 0 || !this.me.alive) return;
    this.reloading = true;
    this.reloadEnd = performance.now() + w.reloadTime * 1000;
    sfx.reload();
    this._updateAmmoHud();
  }

  _finishReload() {
    const a = this.ammo[this.currentWeapon];
    const w = WEAPONS[this.currentWeapon];
    const need = w.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take;
    if (a.reserve !== Infinity) a.reserve -= take;
    this.reloading = false;
    this._updateAmmoHud();
  }

  _tryFire() {
    if (!this.running || this.paused || !this.me.alive || this.chatOpen || this.gameEnded) return;
    const w = WEAPONS[this.currentWeapon];
    const now = performance.now();
    if (this.reloading || now - this.lastShot < 60000 / w.rpm) return;
    const a = this.ammo[this.currentWeapon];
    if (a.mag <= 0) {
      if (a.reserve > 0) this._startReload();
      else sfx.dryFire();
      return;
    }
    this.lastShot = now;
    a.mag--;
    this._updateAmmoHud();
    sfx.shot(this.currentWeapon);

    // origen del rayo: cámara (el crosshair siempre es fiel)
    const camPos = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    // posición del cañón para trazadora/fogonazo
    let muzzle;
    if (this.view === 'fp') {
      muzzle = this.gunMesh.localToWorld(this.gunMesh.userData.muzzle.clone());
    } else {
      muzzle = this.me.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
    }
    this.effects.muzzleFlash(muzzle);

    const ray = new THREE.Raycaster();
    let anyHit = false, headHit = false;
    const hitboxes = [];
    for (const e of this.enemies.values()) if (!e.dead) hitboxes.push(...e.model.hitboxes);
    for (let p = 0; p < w.pellets; p++) {
      const dir = camDir.clone();
      dir.x += (Math.random() - 0.5) * w.spread * 2;
      dir.y += (Math.random() - 0.5) * w.spread * 2;
      dir.z += (Math.random() - 0.5) * w.spread * 2;
      dir.normalize();
      ray.set(camPos, dir);
      ray.far = w.range;
      const hitsE = ray.intersectObjects(hitboxes, false);
      const hitsW = ray.intersectObjects(this.worldMeshes, false);
      const eDist = hitsE[0]?.distance ?? Infinity;
      const wDist = hitsW[0]?.distance ?? Infinity;

      let end;
      if (eDist < wDist) {
        const hit = hitsE[0];
        end = hit.point;
        const head = hit.object.userData.part === 'head';
        anyHit = true; headHit ||= head;
        this.net.emit('hitEnemy', { id: hit.object.userData.enemyId, dmg: w.dmg, weapon: this.currentWeapon, head });
        this.effects.impact(end.clone());
      } else if (wDist < Infinity) {
        end = hitsW[0].point;
        this.effects.impact(end.clone());
      } else {
        end = camPos.clone().addScaledVector(dir, w.range);
      }
      this.effects.tracer(muzzle.clone(), end);
    }

    if (anyHit) {
      sfx.hit(headHit);
      const hm = $('hitmarker');
      hm.classList.remove('show', 'head');
      void hm.offsetWidth;
      hm.classList.add('show');
      if (headHit) hm.classList.add('head');
    }

    // retroceso
    this.recoilPitch += w.recoil;
    this.gunMesh.position.z += w.kick;

    // aviso al servidor para trazadoras remotas
    this.net.emit('shoot', {
      w: this.currentWeapon,
      o: [muzzle.x, muzzle.y, muzzle.z],
      d: [camDir.x, camDir.y, camDir.z],
    });

    if (a.mag === 0 && a.reserve > 0) this._startReload();
  }

  _raycastWorldEnd(from, dir, range) {
    const ray = new THREE.Raycaster(from, dir, 0.1, range);
    const hits = ray.intersectObjects(this.worldMeshes, false);
    return hits[0]?.point || from.clone().addScaledVector(dir, range);
  }

  // ═══════════ VISTA ═══════════
  _toggleView() {
    this.view = this.view === 'fp' ? 'tp' : 'fp';
    this._applyViewMode();
    sfx.click();
  }

  _applyViewMode() {
    const fp = this.view === 'fp' && this.me.alive;
    this.myModel.group.visible = !fp;
    this.viewmodel.visible = fp;
  }

  // ═══════════ BUCLE PRINCIPAL ═══════════
  _frame() {
    if (!this.running || !this.renderer) return;
    const dt = Math.min(0.05, this.clock.getDelta());

    if (!this.paused) {
      this._updatePlayer(dt);
      this._updateRemotes(dt);
      this._updateEnemies(dt);
      this._updatePickups(dt);
      this._updateRevive(dt);
      this.effects.update(dt);
      if (this.mouseDown && WEAPONS[this.currentWeapon].auto) this._tryFire();
      if (this.reloading && performance.now() >= this.reloadEnd) this._finishReload();

      // envío de estado ~15 Hz
      this.netTimer += dt;
      if (this.netTimer > 0.066) {
        this.netTimer = 0;
        const speed2 = this.me.vel.x ** 2 + this.me.vel.z ** 2;
        const anim = !this.me.alive ? 'Dead' : speed2 > 22 ? 'Run' : speed2 > 0.6 ? 'Walk' : 'Idle';
        this.net.emit('state', {
          x: this.me.pos.x, y: this.me.pos.y, z: this.me.pos.z,
          ry: this.me.yaw, p: this.me.pitch, a: anim,
        });
      }
    }

    this._updateCamera(dt);
    this.renderer.render(this.scene, this.camera);

    // FPS
    if (settings.showFps) {
      $('fps-counter').classList.remove('hidden');
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        $('fps-counter').textContent = Math.round(this.fpsFrames / this.fpsTime) + ' FPS';
        this.fpsFrames = 0; this.fpsTime = 0;
      }
    } else $('fps-counter').classList.add('hidden');
  }

  _updatePlayer(dt) {
    const me = this.me;
    if (!me.alive) { me.vel.set(0, 0, 0); this._updateMyModel(dt); return; }

    const sprint = this.keys.ShiftLeft || this.keys.ShiftRight;
    const speed = sprint ? 7.2 : 4.4;
    const f = new THREE.Vector3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const wish = new THREE.Vector3();
    if (this.keys.KeyW) wish.add(f);
    if (this.keys.KeyS) wish.sub(f);
    if (this.keys.KeyD) wish.add(r);
    if (this.keys.KeyA) wish.sub(r);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    const accel = me.onGround ? 14 : 4;
    me.vel.x += (wish.x - me.vel.x) * Math.min(1, accel * dt);
    me.vel.z += (wish.z - me.vel.z) * Math.min(1, accel * dt);

    if (this.keys.Space && me.onGround) {
      me.vel.y = 8.4;
      me.onGround = false;
    }
    me.vel.y += GRAVITY * dt;

    me.pos.x += me.vel.x * dt;
    me.pos.z += me.vel.z * dt;
    collideCircle(me.pos, 0.35, me.pos.y);
    me.pos.y += me.vel.y * dt;

    const gh = groundHeight(me.pos.x, me.pos.z);
    if (me.pos.y <= gh) {
      me.pos.y = gh;
      me.vel.y = 0;
      me.onGround = true;
    } else if (me.pos.y > gh + 0.02) {
      me.onGround = false;
    }

    // retroceso se recupera
    this.recoilPitch *= Math.exp(-8 * dt);
    if (this.gunMesh) this.gunMesh.position.z += (-0.42 - this.gunMesh.position.z) * Math.min(1, 12 * dt);

    this._updateMyModel(dt);
  }

  _updateMyModel(dt) {
    const g = this.myModel.group;
    g.position.copy(this.me.pos);
    g.rotation.y = this.me.yaw;
    const speed2 = this.me.vel.x ** 2 + this.me.vel.z ** 2;
    if (!this.me.alive) {
      g.rotation.x = Math.max(-Math.PI / 2, g.rotation.x - dt * 3);
    } else {
      g.rotation.x = 0;
      this._playSoldierAnim(this.myModel, speed2 > 22 ? 'Run' : speed2 > 0.6 ? 'Walk' : 'Idle');
    }
    this.myModel.mixer.update(dt);
  }

  _updateCamera(dt) {
    const me = this.me;
    const pitch = me.pitch + this.recoilPitch;
    if (this.view === 'fp' && me.alive) {
      // bob sutil al andar
      const speed2 = me.vel.x ** 2 + me.vel.z ** 2;
      this.bobT = (this.bobT || 0) + dt * (speed2 > 22 ? 11 : 7.5);
      const bob = me.onGround && speed2 > 0.6 ? Math.sin(this.bobT) * 0.022 : 0;
      this.camera.position.set(me.pos.x, me.pos.y + EYE + bob, me.pos.z);
      this.camera.rotation.set(pitch, me.yaw, 0, 'YXZ');
      if (this.gunMesh) this.gunMesh.position.y = this.gunBaseY + bob * 0.7;
    } else {
      // 3ª persona sobre el hombro con colisión de cámara
      const head = new THREE.Vector3(me.pos.x, me.pos.y + 1.7, me.pos.z);
      const dirBack = new THREE.Vector3(
        Math.sin(me.yaw) * Math.cos(pitch),
        -Math.sin(pitch),
        Math.cos(me.yaw) * Math.cos(pitch)
      ).normalize();
      const shoulder = new THREE.Vector3(-Math.cos(me.yaw), 0, Math.sin(me.yaw)).multiplyScalar(-0.55);
      const desired = 3.6;
      const ray = new THREE.Raycaster(head, dirBack, 0, desired + 0.3);
      const hits = ray.intersectObjects(this.worldMeshes, false);
      const dist = hits.length ? Math.max(0.4, hits[0].distance - 0.25) : desired;
      const camPos = head.clone().addScaledVector(dirBack, dist).add(shoulder);
      this.camera.position.copy(camPos);
      this.camera.rotation.set(pitch, me.yaw, 0, 'YXZ');
    }

    // FOV dinámico al esprintar
    const sprinting = (this.keys.ShiftLeft || this.keys.ShiftRight) && (me.vel.x ** 2 + me.vel.z ** 2) > 22;
    const targetFov = settings.fov + (sprinting ? 6 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 8 * dt);
      this.camera.updateProjectionMatrix();
    }
  }

  _updateRemotes(dt) {
    const k = 1 - Math.exp(-14 * dt);
    for (const r of this.remotes.values()) {
      const g = r.model.group;
      if (g.position.distanceToSquared(r.target.pos) > 36) g.position.copy(r.target.pos);
      else g.position.lerp(r.target.pos, k);
      let dy = r.target.ry - g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * k;
      if (!r.alive) {
        g.rotation.x = Math.max(-Math.PI / 2, g.rotation.x - dt * 3);
      } else {
        g.rotation.x = 0;
        this._playSoldierAnim(r.model, r.anim);
      }
      r.model.mixer.update(dt);
    }
  }

  _updateEnemies(dt) {
    const k = 1 - Math.exp(-10 * dt);
    for (const [id, e] of this.enemies) {
      const g = e.model.group;
      if (e.dead) {
        e.deathT += dt;
        // tras la animación de muerte, el robot se hunde en el suelo
        // (sin tocar materiales: cambiar transparencia recompila shaders)
        if (e.deathT > 1.5) g.position.y -= dt * 1.4;
        if (e.deathT > 2.8) {
          this.scene.remove(g);
          this.enemies.delete(id);
          continue;
        }
        e.model.mixer.update(dt);
        continue;
      }
      if (g.position.distanceToSquared(e.target.pos) > 49) g.position.copy(e.target.pos);
      else g.position.lerp(e.target.pos, k);
      let dy = e.target.ry - g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * k;
      const clip = e.serverAnim === 1 ? 'Running' : e.serverAnim === 2 ? 'Punch' : 'Idle';
      this._playRobotAnim(e, clip);
      e.model.mixer.update(dt);
    }
  }

  _updatePickups(dt) {
    for (const pk of this.pickups.values()) {
      pk.t += dt;
      pk.group.rotation.y += dt * 1.6;
      pk.group.children[0].position.y = 0.3 + Math.sin(pk.t * 2.4) * 0.09;
    }
  }

  _updateRevive(dt) {
    const prompt = $('interact-prompt');
    const wrap = $('revive-bar-wrap');
    if (!this.me.alive) { prompt.classList.add('hidden'); wrap.classList.add('hidden'); return; }
    // buscar aliado caído cercano
    let target = null, bestD = 3.2;
    for (const [id, r] of this.remotes) {
      if (r.alive) continue;
      const d = r.model.group.position.distanceTo(this.me.pos);
      if (d < bestD) { bestD = d; target = { id, r }; }
    }
    if (!target) {
      prompt.classList.add('hidden');
      wrap.classList.add('hidden');
      this.reviveTime = 0;
      return;
    }
    if (this.keys.KeyE) {
      this.reviveTime += dt;
      prompt.classList.add('hidden');
      wrap.classList.remove('hidden');
      $('revive-fill').style.width = Math.min(100, this.reviveTime / 3 * 100) + '%';
      if (this.reviveTime >= 3) {
        this.net.emit('revive', { id: target.id });
        this.reviveTime = 0;
        wrap.classList.add('hidden');
      }
    } else {
      this.reviveTime = 0;
      wrap.classList.add('hidden');
      prompt.classList.remove('hidden');
      prompt.innerHTML = `Mantén <kbd>E</kbd> para revivir a <b>${target.r.name}</b>`;
    }
  }

  // ═══════════ HUD helpers ═══════════
  _hud(id, val) { $(id).textContent = val; }

  _updateHpHud() {
    const hp = Math.max(0, Math.round(this.me.hp));
    this._hud('hp-num', hp);
    const fill = $('hp-fill');
    fill.style.width = hp + '%';
    fill.classList.toggle('low', hp <= 35);
    $('damage-vignette').style.opacity = hp <= 35 ? 0.45 + (35 - hp) / 80 : 0;
  }

  _damageFlash() {
    const v = $('damage-vignette');
    v.style.transition = 'none';
    v.style.opacity = 0.85;
    requestAnimationFrame(() => {
      v.style.transition = 'opacity 0.5s';
      v.style.opacity = this.me.hp <= 35 ? 0.5 : 0;
    });
  }

  _killfeed(html) {
    const el = document.createElement('div');
    el.className = 'kf-item';
    el.innerHTML = html;
    const feed = $('killfeed');
    feed.appendChild(el);
    while (feed.children.length > 6) feed.firstChild.remove();
    setTimeout(() => el.remove(), 5000);
  }

  _chatLine(name, msg) {
    const el = document.createElement('div');
    el.className = 'chat-line';
    el.innerHTML = `<b>${name}:</b> ${msg.replace(/</g, '&lt;')}`;
    const log = $('chat-log');
    log.appendChild(el);
    while (log.children.length > 6) log.firstChild.remove();
    setTimeout(() => el.remove(), 9000);
  }

  _announce(title, sub = '') {
    const a = $('announce');
    a.classList.remove('hidden');
    a.innerHTML = `${title}<small>${sub}</small>`;
    clearTimeout(this._annT);
    this._annT = setTimeout(() => a.classList.add('hidden'), 3200);
  }

  _renderScoreboard() {
    const body = $('scoreboard-body');
    const rows = [...this.scores.entries()]
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.score - a.score);
    // mi propia puntuación es la más fiable en local
    body.innerHTML = rows.map(r => {
      const score = r.id === this.net.id ? this.me.score : r.score;
      const kills = r.id === this.net.id ? this.me.kills : r.kills;
      const alive = r.id === this.net.id ? this.me.alive : r.alive;
      return `<tr class="${r.id === this.net.id ? 'me' : ''}">
        <td>${r.name}</td><td>${score}</td><td>${kills}</td>
        <td class="${alive ? 'st-alive' : 'st-dead'}">${alive ? 'EN COMBATE' : 'CAÍDO'}</td></tr>`;
    }).join('');
  }
}
