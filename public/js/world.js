// Construcción del mundo 3D: iluminación, arena, obstáculos con PBR
import * as THREE from 'three';
import { assets } from './assets.js';
import { ARENA_SIZE, HALF, WALL_HEIGHT, WALL_THICK, OBSTACLES, ENEMY_GATES } from './shared/map.js';

export function buildWorld(scene, quality) {
  // ─── Entorno / cielo ───
  scene.environment = assets.envMap;
  scene.background = assets.envMap;
  scene.backgroundBlurriness = 0.04;
  scene.fog = new THREE.Fog(0xc9a385, 60, 220);

  // ─── Luces ───
  const sun = new THREE.DirectionalLight(0xffdcb0, 2.6);
  sun.position.set(45, 60, -30);
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffe0c0, 0x2a2620, 0.5));

  // ─── Suelo ───
  const gt = assets.tex;
  for (const t of [gt.groundDiff, gt.groundNor, gt.groundRough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(14, 14);
    t.anisotropy = quality.anisotropy;
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_SIZE + 40, ARENA_SIZE + 40),
    new THREE.MeshStandardMaterial({
      map: gt.groundDiff, normalMap: gt.groundNor, roughnessMap: gt.groundRough,
      roughness: 1.0, metalness: 0.0,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ─── Materiales de obstáculos ───
  for (const t of [gt.metalDiff, gt.metalNor, gt.metalRough, gt.concreteDiff, gt.concreteNor]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = quality.anisotropy;
  }
  const matMetal = new THREE.MeshStandardMaterial({
    map: gt.metalDiff, normalMap: gt.metalNor, roughnessMap: gt.metalRough,
    roughness: 0.6, metalness: 0.9, color: 0xb8bcc2,
  });
  const matMetalOrange = matMetal.clone();
  matMetalOrange.color = new THREE.Color(0xcc5a1e);
  const matMetalBlue = matMetal.clone();
  matMetalBlue.color = new THREE.Color(0x2e5d8a);
  const matConcrete = new THREE.MeshStandardMaterial({
    map: gt.concreteDiff, normalMap: gt.concreteNor, roughness: 0.95, metalness: 0.0,
  });

  // ─── Obstáculos (colisionables — misma lista que el servidor) ───
  const raycastables = [ground];
  const metalMats = [matMetal, matMetalOrange, matMetalBlue];
  OBSTACLES.forEach((o, i) => {
    const mat = o.mat === 'concrete' ? matConcrete : metalMats[i % 3];
    const m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), mat);
    m.position.set(o.x, o.h / 2, o.z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    raycastables.push(m);
  });

  // ─── Muros perimetrales ───
  const wallMat = matConcrete.clone();
  wallMat.map = gt.concreteDiff.clone();
  wallMat.map.repeat.set(12, 1.2);
  wallMat.map.wrapS = wallMat.map.wrapT = THREE.RepeatWrapping;
  wallMat.map.colorSpace = THREE.SRGBColorSpace;
  const mkWall = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), wallMat);
    m.position.set(x, WALL_HEIGHT / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    raycastables.push(m);
  };
  mkWall(ARENA_SIZE + WALL_THICK * 2, WALL_THICK, 0, -HALF - WALL_THICK / 2);
  mkWall(ARENA_SIZE + WALL_THICK * 2, WALL_THICK, 0, HALF + WALL_THICK / 2);
  mkWall(WALL_THICK, ARENA_SIZE, -HALF - WALL_THICK / 2, 0);
  mkWall(WALL_THICK, ARENA_SIZE, HALF + WALL_THICK / 2, 0);

  // ─── Puertas de aparición: marco luminoso rojo ───
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2200, emissiveIntensity: 1.6 });
  for (const gpos of ENEMY_GATES) {
    const gate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 2.6), gateMat);
    gate.position.set(gpos.x, 0.02, gpos.z);
    scene.add(gate);
  }

  // ─── Torres de luz en las esquinas ───
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5, metalness: 0.8 });
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 9, 8), towerMat);
    pole.position.set(sx * (HALF - 3), 4.5, sz * (HALF - 3));
    pole.castShadow = true;
    scene.add(pole);
    const lampMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.3, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffcc88, emissiveIntensity: 2 })
    );
    lampMesh.position.set(sx * (HALF - 3), 9, sz * (HALF - 3));
    scene.add(lampMesh);
  }

  return { raycastables, sun };
}
