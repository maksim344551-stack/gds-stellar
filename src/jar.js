import * as THREE from 'three';
import { getSkinTextures } from './skins.js';

// Банка GDS: матовая этикетка, хромированная крышка с «термо-полусферой» сверху.
export function createJar() {
  const rig = new THREE.Group(); // позиция/масштаб/наклон
  const spin = new THREE.Group(); // вращение вокруг оси
  rig.add(spin);
  const inner = new THREE.Group();
  inner.position.y = 0.18; // центрируем по высоте
  spin.add(inner);

  const labelMat = new THREE.MeshPhysicalMaterial({
    roughness: 0.42, metalness: 0.12, clearcoat: 0.55, clearcoatRoughness: 0.28, envMapIntensity: 0.9,
    side: THREE.FrontSide,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.985, 1.05, 128, 1, true), labelMat);
  body.position.y = -0.425;
  inner.add(body);

  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xc9ced4, metalness: 1, roughness: 0.26, clearcoat: 0.3, clearcoatRoughness: 0.25, envMapIntensity: 0.8,
  });
  const darkChrome = chrome.clone();
  darkChrome.color.set(0x9aa0a8);
  darkChrome.roughness = 0.32;

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.95, 0.14, 96), darkChrome);
  neck.position.y = 0.12;
  inner.add(neck);

  const bottom = new THREE.Mesh(
    new THREE.CircleGeometry(0.985, 64),
    new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.6, metalness: 0.4 }),
  );
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -0.95;
  inner.add(bottom);

  // крышка — профиль вращения с закруглёнными кромками и углублением под этикетку
  const prof = [
    [1.02, 0], [1.045, 0.03], [1.052, 0.1], [1.052, 0.36], [1.035, 0.43], [0.995, 0.465],
    [0.94, 0.472], [0.905, 0.455], [0.885, 0.415], [0.872, 0.4], [0, 0.4],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const lid = new THREE.Mesh(new THREE.LatheGeometry(prof, 128), chrome);
  lid.position.y = 0.08;
  inner.add(lid);

  const lidMat = new THREE.MeshPhysicalMaterial({
    roughness: 0.42, metalness: 0.1, clearcoat: 0.25, clearcoatRoughness: 0.3, envMapIntensity: 0.55,
  });
  const lidTop = new THREE.Mesh(new THREE.CircleGeometry(0.874, 96), lidMat);
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.y = 0.08 + 0.402;
  inner.add(lidTop);

  let current = null;
  function setSkin(id) {
    if (current === id) return;
    current = id;
    const t = getSkinTextures(id);
    labelMat.map = t.label;
    labelMat.needsUpdate = true;
    lidMat.map = t.lid;
    lidMat.needsUpdate = true;
  }

  return { rig, spin, setSkin, get skin() { return current; } };
}
