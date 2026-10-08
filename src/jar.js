import * as THREE from 'three';
import { getSkinTextures, pinSkin } from './skins.js';
import { SKINS } from './data.js';

// Профиль вращения с микро-фасками: на металле кромки ловят блик, как на фрезерованной крышке.
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

// Размеры в единицах сцены. Банка приземистая, как на эталонном фото: диаметр 2,1, высота около 1,85, крышка около четверти высоты.
// Окружность этикетки 2π·R относится к её высоте как 4,83: полотно этикетки (LABEL_W x LABEL_H в skins.js) в том же отношении,
// поэтому буквы не растянуты.
export const JAR = { R: 1, bodyH: 1.3, bodyBottom: -0.9 };

// Банка GDS целиком из примитивов: корпус с этикеткой, цветная металлическая крышка с углублением под логотип, шейка и поясок.
// Всё замкнуто, без щелей и без шумной сетки.
export async function createJar() {
  const rig = new THREE.Group(); // позиция, масштаб, наклон
  const spin = new THREE.Group(); // вращение вокруг оси
  rig.add(spin);
  const inner = new THREE.Group();
  inner.scale.setScalar(0.9);
  inner.position.y = -0.03; // центрируем по высоте
  spin.add(inner);

  const bodyTop = JAR.bodyBottom + JAR.bodyH; // 0.4

  const labelMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1, envMapIntensity: 1.1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(JAR.R, JAR.R, JAR.bodyH, 256, 1, true), labelMat);
  body.position.y = JAR.bodyBottom + JAR.bodyH / 2;
  inner.add(body);

  // Металл крышки красится в цвет вкуса в setSkin
  const chrome = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, metalness: 0.92, roughness: 0.36, envMapIntensity: 2.4 });
  const darkChrome = chrome.clone();
  darkChrome.roughness = 0.42;
  darkChrome.envMapIntensity = 1.8;

  // шейка: уже корпуса и крышки, поэтому между ними видна ровная канавка, а не щель
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.965, 0.975, 0.14, 160), darkChrome);
  neck.position.y = bodyTop + 0.03;
  inner.add(neck);

  // нижний поясок
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.004, 0.995, 0.05, 160), darkChrome);
  foot.position.y = JAR.bodyBottom + 0.02;
  inner.add(foot);

  const bottom = new THREE.Mesh(
    new THREE.CircleGeometry(0.98, 96),
    new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.6, metalness: 0.4 }),
  );
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = JAR.bodyBottom - 0.005;
  inner.add(bottom);

  // крышка: гладкая стенка, фаска сверху и неглубокое углубление под логотип
  const lidBase = bodyTop + 0.04;
  const prof = bevelProfile([
    [0.99, 0], [1.032, 0.012], [1.045, 0.05],
    [1.045, 0.40], [1.032, 0.455], [0.99, 0.495], [0.935, 0.512], [0.9, 0.5], [0.885, 0.47],
    [0, 0.47],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 0.014);
  const lid = new THREE.Mesh(new THREE.LatheGeometry(prof, 256), chrome);
  lid.position.y = lidBase;
  inner.add(lid);

  const lidMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1, envMapIntensity: 0.75 });
  const lidTop = new THREE.Mesh(new THREE.CircleGeometry(0.886, 128), lidMat);
  lidTop.rotation.x = -Math.PI / 2;
  lidTop.position.y = lidBase + 0.472;
  inner.add(lidTop);

  // точки привязки для выносок (не вращаются вместе с банкой)
  const anchors = {};
  [['lid', -1.0, 0.6, 0.2], ['body', -0.97, -0.25, 0.2], ['base', -0.9, -0.84, 0.2]].forEach(([name, x, y, z]) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    rig.add(o);
    anchors[name] = o;
  });

  const tmpC = new THREE.Color();
  let current = null;
  function setSkin(id) {
    if (current === id) return;
    current = id;
    pinSkin(id);
    const t = getSkinTextures(id);
    // металл того же цвета, что и банка: тон вкуса на тёмной основе; у фирменной банки чёрный
    const sk = SKINS[id];
    if (sk && id !== 'brand') chrome.color.set(sk.b).lerp(tmpC.set(sk.c), 0.12);
    else chrome.color.set('#18181c');
    darkChrome.color.copy(chrome.color).multiplyScalar(0.8);
    labelMat.map = t.label;
    labelMat.roughnessMap = t.mr;
    labelMat.metalnessMap = t.mr;
    labelMat.needsUpdate = true;
    lidMat.map = t.lid;
    lidMat.roughnessMap = t.lidMr;
    lidMat.metalnessMap = t.lidMr;
    lidMat.needsUpdate = true;
  }

  return { rig, spin, setSkin, anchors, get skin() { return current; } };
}
