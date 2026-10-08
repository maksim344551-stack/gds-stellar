import * as THREE from 'three';
import { getSkinTextures } from './skins.js';

// Профиль вращения с микро-фасками: на хроме кромки ловят блик, как на фрезерованном металле.
function bevelProfile(pts, e = 0.012) {
  const out = [pts[0].clone()];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const a = pts[i - 1];
    const b = pts[i + 1];
    const da = a.clone().sub(p);
    const db = b.clone().sub(p);
    const ta = Math.min(e / da.length(), 0.45);
    const tb = Math.min(e / db.length(), 0.45);
    out.push(p.clone().addScaledVector(da, ta));
    out.push(p.clone().addScaledVector(db, tb));
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}

function glowSprite(map) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.17,
  }));
  s.scale.setScalar(7.2);
  s.position.set(0, 0, -1.4);
  return s;
}

// Банка GDS: этикетка с фольгой, хромированная крышка с «термо-полусферой» сверху.
export function createJar({ glowMap }) {
  const rig = new THREE.Group(); // позиция/масштаб/наклон
  const aura = glowSprite(glowMap);
  rig.add(aura);
  const spin = new THREE.Group(); // вращение вокруг оси
  rig.add(spin);
  const inner = new THREE.Group();
  inner.position.y = 0.18; // центрируем по высоте
  spin.add(inner);

  const labelMat = new THREE.MeshPhysicalMaterial({
    roughness: 1, metalness: 1, clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.72,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.985, 1.05, 160, 1, true), labelMat);
  body.position.y = -0.425;
  inner.add(body);

  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xd2d7dd, metalness: 1, roughness: 0.24, clearcoat: 0.25, clearcoatRoughness: 0.25, envMapIntensity: 1,
  });
  const darkChrome = chrome.clone();
  darkChrome.color.set(0x8f959d);
  darkChrome.roughness = 0.34;

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.95, 0.14, 96), darkChrome);
  neck.position.y = 0.12;
  inner.add(neck);

  // нижний хромированный поясок — как на рендере упаковки
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.99, 0.975, 0.045, 96), darkChrome);
  foot.position.y = -0.935;
  inner.add(foot);

  const bottom = new THREE.Mesh(
    new THREE.CircleGeometry(0.975, 64),
    new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.6, metalness: 0.4 }),
  );
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -0.958;
  inner.add(bottom);

  // крышка — профиль вращения с канавками и углублением под этикетку
  const prof = bevelProfile([
    [1.02, 0], [1.045, 0.03], [1.052, 0.08],
    [1.052, 0.12], [1.04, 0.13], [1.04, 0.15], [1.052, 0.16],
    [1.052, 0.28], [1.04, 0.29], [1.04, 0.31], [1.052, 0.32],
    [1.052, 0.36], [1.035, 0.43], [0.995, 0.465], [0.94, 0.472], [0.905, 0.455], [0.885, 0.415], [0.872, 0.4],
    [0, 0.4],
  ].map(([x, y]) => new THREE.Vector2(x, y)));
  const lid = new THREE.Mesh(new THREE.LatheGeometry(prof, 160), chrome);
  lid.position.y = 0.08;
  inner.add(lid);

  const lidMat = new THREE.MeshPhysicalMaterial({
    roughness: 1, metalness: 1, clearcoat: 0.35, clearcoatRoughness: 0.2, envMapIntensity: 0.9,
  });
  const lidTop = new THREE.Mesh(new THREE.CircleGeometry(0.874, 96), lidMat);
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.y = 0.08 + 0.402;
  inner.add(lidTop);

  // точки привязки для выносок (не вращаются вместе с банкой)
  const anchors = {};
  [['lid', -1.04, 0.5, 0.2], ['body', -1.0, -0.3, 0.2], ['base', -0.92, -1.0, 0.2]].forEach(([name, x, y, z]) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    rig.add(o);
    anchors[name] = o;
  });

  let current = null;
  function setSkin(id) {
    if (current === id) return;
    current = id;
    const t = getSkinTextures(id);
    labelMat.map = t.label;
    labelMat.roughnessMap = t.mr;
    labelMat.metalnessMap = t.mr;
    labelMat.needsUpdate = true;
    lidMat.map = t.lid;
    lidMat.roughnessMap = t.lidMr;
    lidMat.metalnessMap = t.lidMr;
    lidMat.needsUpdate = true;
  }

  function setAccent(color) {
    aura.material.color.copy(color);
  }

  return { rig, spin, setSkin, setAccent, anchors, aura, get skin() { return current; } };
}
