// Carga de assets reales: modelos GLB animados, HDRI y texturas PBR (Poly Haven, CC0)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const assets = {
  soldier: null,        // gltf del soldado (jugadores)
  robot: null,          // gltf del robot (enemigos)
  envMap: null,         // HDRI equirectangular
  tex: {},              // texturas PBR
};

export async function loadAssets(onProgress) {
  const gltfLoader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  const rgbeLoader = new RGBELoader();

  const jobs = [
    ['Soldado', () => gltfLoader.loadAsync('assets/models/Soldier.glb').then(g => assets.soldier = g)],
    ['Robots hostiles', () => gltfLoader.loadAsync('assets/models/RobotExpressive.glb').then(g => assets.robot = g)],
    ['Cielo HDRI', () => rgbeLoader.loadAsync('assets/hdri/sky.hdr').then(t => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      assets.envMap = t;
    })],
    ['Terreno (difuso)', () => texLoader.loadAsync('assets/textures/ground_diff.jpg').then(t => assets.tex.groundDiff = t)],
    ['Terreno (normales)', () => texLoader.loadAsync('assets/textures/ground_nor.jpg').then(t => assets.tex.groundNor = t)],
    ['Terreno (rugosidad)', () => texLoader.loadAsync('assets/textures/ground_rough.jpg').then(t => assets.tex.groundRough = t)],
    ['Metal (difuso)', () => texLoader.loadAsync('assets/textures/metal_diff.jpg').then(t => assets.tex.metalDiff = t)],
    ['Metal (normales)', () => texLoader.loadAsync('assets/textures/metal_nor.jpg').then(t => assets.tex.metalNor = t)],
    ['Metal (rugosidad)', () => texLoader.loadAsync('assets/textures/metal_rough.jpg').then(t => assets.tex.metalRough = t)],
    ['Hormigón (difuso)', () => texLoader.loadAsync('assets/textures/concrete_diff.jpg').then(t => assets.tex.concreteDiff = t)],
    ['Hormigón (normales)', () => texLoader.loadAsync('assets/textures/concrete_nor.jpg').then(t => assets.tex.concreteNor = t)],
  ];

  let done = 0;
  await Promise.all(jobs.map(([label, fn]) =>
    fn().then(() => onProgress?.(++done / jobs.length, label))
  ));

  for (const key of ['groundDiff', 'metalDiff', 'concreteDiff']) {
    assets.tex[key].colorSpace = THREE.SRGBColorSpace;
  }
  return assets;
}

// ─── Fábrica de soldados (jugadores) ───
export function makeSoldier(colorHex) {
  const root = SkeletonUtils.clone(assets.soldier.scene);
  root.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
      o.material = o.material.clone();
      o.frustumCulled = false;
      if (colorHex !== undefined && /shirt|vest|body|main|torso/i.test(o.material.name + o.name)) {
        o.material.color = new THREE.Color(colorHex);
      }
    }
  });
  // Tinte de escuadra: emisivo sutil en todo el cuerpo para distinguir jugadores
  if (colorHex !== undefined) {
    root.traverse(o => {
      if (o.isSkinnedMesh && o.material?.emissive) {
        o.material.emissive = new THREE.Color(colorHex);
        o.material.emissiveIntensity = 0.12;
      }
    });
  }
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of assets.soldier.animations) {
    actions[clip.name] = mixer.clipAction(clip);
  }
  // El Soldier.glb ya mira hacia -Z local, que es "adelante" en nuestra convención de yaw
  const group = new THREE.Group();
  group.add(root);
  return { group, root, mixer, actions };
}

// ─── Fábrica de robots (enemigos) ───
const ROBOT_TINTS = { grunt: 0xd8dde2, runner: 0x76e08a, tank: 0xff5a48 };

export function makeRobot(type = 'grunt', scale = 1) {
  const root = SkeletonUtils.clone(assets.robot.scene);
  const tint = new THREE.Color(ROBOT_TINTS[type] ?? 0xffffff);
  root.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.material = o.material.clone();
      o.frustumCulled = false;
      if (/main|grey/i.test(o.material.name)) o.material.color.lerp(tint, 0.55);
      if (o.material.emissive && type === 'tank') {
        o.material.emissive = new THREE.Color(0x881100);
        o.material.emissiveIntensity = 0.25;
      }
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const clip of assets.robot.animations) {
    actions[clip.name] = mixer.clipAction(clip);
  }
  const group = new THREE.Group();
  // RobotExpressive mide ~4.5; lo bajamos a tamaño humanoide (~2 m) y aplicamos escala de tipo
  const s = 0.42 * scale;
  root.scale.setScalar(s);
  group.add(root);

  // Hitboxes invisibles: cuerpo + cabeza
  const hbMat = new THREE.MeshBasicMaterial({ visible: false });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9 * scale, 1.5 * scale, 0.7 * scale), hbMat);
  body.position.y = 0.85 * scale;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34 * scale, 8, 8), hbMat.clone());
  head.position.y = 1.72 * scale;
  body.userData.part = 'body';
  head.userData.part = 'head';
  group.add(body, head);

  return { group, root, mixer, actions, hitboxes: [body, head] };
}

// ─── Armas procedurales (viewmodel y arma en mano) ───
export function makeGunMesh(weaponId) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    map: assets.tex.metalDiff, normalMap: assets.tex.metalNor, roughnessMap: assets.tex.metalRough,
    color: 0x666a70, roughness: 0.55, metalness: 0.85,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4, metalness: 0.7 });
  const box = (w, h, d, mat = metal) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const cyl = (r, l, mat = dark) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 10), mat);
    m.rotation.x = Math.PI / 2;
    return m;
  };

  if (weaponId === 'pistol') {
    const slide = box(0.05, 0.06, 0.22); slide.position.set(0, 0.02, -0.02);
    const grip = box(0.045, 0.13, 0.06, dark); grip.position.set(0, -0.07, 0.06); grip.rotation.x = 0.25;
    const barrel = cyl(0.012, 0.08); barrel.position.set(0, 0.02, -0.16);
    g.add(slide, grip, barrel);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.2);
  } else if (weaponId === 'shotgun') {
    const body = box(0.055, 0.075, 0.5); body.position.set(0, 0, -0.1);
    const pump = box(0.06, 0.055, 0.16, dark); pump.position.set(0, -0.05, -0.22);
    const barrel = cyl(0.018, 0.5); barrel.position.set(0, 0.035, -0.25);
    const stock = box(0.05, 0.09, 0.2, dark); stock.position.set(0, -0.02, 0.24);
    g.add(body, pump, barrel, stock);
    g.userData.muzzle = new THREE.Vector3(0, 0.035, -0.5);
  } else if (weaponId === 'smg') {
    const body = box(0.05, 0.09, 0.32); body.position.set(0, 0, -0.04);
    const grip = box(0.04, 0.12, 0.05, dark); grip.position.set(0, -0.09, 0.05);
    const mag = box(0.035, 0.14, 0.05, dark); mag.position.set(0, -0.1, -0.06); mag.rotation.x = -0.15;
    const barrel = cyl(0.014, 0.14); barrel.position.set(0, 0.015, -0.26);
    g.add(body, grip, mag, barrel);
    g.userData.muzzle = new THREE.Vector3(0, 0.015, -0.34);
  } else { // rifle
    const body = box(0.05, 0.08, 0.46); body.position.set(0, 0, -0.05);
    const grip = box(0.04, 0.12, 0.05, dark); grip.position.set(0, -0.09, 0.1);
    const mag = box(0.04, 0.16, 0.07, dark); mag.position.set(0, -0.11, -0.03); mag.rotation.x = -0.2;
    const barrel = cyl(0.015, 0.26); barrel.position.set(0, 0.02, -0.38);
    const stock = box(0.045, 0.08, 0.18, dark); stock.position.set(0, -0.01, 0.26);
    const sight = box(0.02, 0.035, 0.06, dark); sight.position.set(0, 0.055, -0.1);
    g.add(body, grip, mag, barrel, stock, sight);
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.51);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}
