// Efectos visuales: trazadoras, chispas de impacto, fogonazos.
// Rendimiento: pool FIJO de PointLights (añadir/quitar luces recompila todos los
// shaders en three.js), geometrías compartidas y sin cambios de material en caliente.
import * as THREE from 'three';

const LIGHT_POOL_SIZE = 6;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.sparks = [];
    this.flashes = [];

    this.sparkGeo = new THREE.SphereGeometry(0.03, 4, 4);
    this.sparkMatA = new THREE.MeshBasicMaterial({ color: 0xffcc55 });
    this.sparkMatB = new THREE.MeshBasicMaterial({ color: 0xff5522 });
    // cilindro unitario compartido; cada trazadora solo escala en Y
    this.tracerGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 4, 1, true);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9 });

    // Pool de luces: siempre en escena, intensidad 0 cuando están libres.
    // El número de luces nunca cambia → no hay recompilación de shaders.
    this.lightPool = [];
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const l = new THREE.PointLight(0xffb066, 0, 10);
      l.position.set(0, -100, 0);
      scene.add(l);
      this.lightPool.push(l);
    }

    this._up = new THREE.Vector3(0, 1, 0);
  }

  _getLight() {
    for (const l of this.lightPool) if (l.intensity === 0) return l;
    return null; // pool agotado: se omite la luz, nunca se crea una nueva
  }

  _flash(pos, color, intensity, distance, life) {
    const light = this._getLight();
    if (!light) return;
    light.color.set(color);
    light.intensity = intensity;
    light.distance = distance;
    light.position.copy(pos);
    this.flashes.push({ light, life });
  }

  tracer(from, to) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.5) return;
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat.clone());
    m.scale.y = len;
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(this._up, dir.normalize());
    this.scene.add(m);
    this.tracers.push({ m, life: 0.07 });
  }

  impact(pos, big = false) {
    const n = big ? 14 : 7;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.sparkGeo, Math.random() > 0.5 ? this.sparkMatA : this.sparkMatB);
      m.position.copy(pos);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 5 + 1,
        (Math.random() - 0.5) * 6
      );
      this.scene.add(m);
      this.sparks.push({ m, v, life: 0.35 + Math.random() * 0.25 });
    }
  }

  explosion(pos) {
    this.impact(pos, true);
    const p = pos.clone();
    p.y += 1;
    this._flash(p, 0xff6622, 30, 12, 0.25);
  }

  muzzleFlash(pos) {
    this._flash(pos, 0xffb066, 14, 7, 0.045);
  }

  // Precompila los shaders de los efectos para evitar tirones en el primer disparo
  prewarm(renderer, camera) {
    const hidden = new THREE.Vector3(0, -60, 0);
    this.tracer(hidden.clone(), hidden.clone().add(new THREE.Vector3(0, 1, 0)));
    this.impact(hidden);
    renderer.compile(this.scene, camera);
  }

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.m);
        t.m.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.v.y -= 14 * dt;
      s.m.position.addScaledVector(s.v, dt);
      if (s.life <= 0 || s.m.position.y < 0) {
        this.scene.remove(s.m);
        this.sparks.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      f.light.intensity *= 0.82;
      if (f.life <= 0) {
        f.light.intensity = 0;           // se devuelve al pool, nunca sale de escena
        f.light.position.set(0, -100, 0);
        this.flashes.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const t of this.tracers) { this.scene.remove(t.m); t.m.material.dispose(); }
    for (const s of this.sparks) this.scene.remove(s.m);
    for (const f of this.flashes) f.light.intensity = 0;
    for (const l of this.lightPool) this.scene.remove(l);
    this.tracerGeo.dispose();
    this.sparkGeo.dispose();
    this.tracers = []; this.sparks = []; this.flashes = []; this.lightPool = [];
  }
}
