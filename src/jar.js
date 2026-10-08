import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getSkinTextures, pinSkin } from './skins.js';
import { SKINS } from './data.js';
import JAR_URL from './assets/jar.glb?url';

// Банка GDS: модель из jar.glb (три части: этикетка, верхняя пластина крышки, хром). Развёртка этикетки цилиндрическая,
// пластины планарная, их заложил скрипт подготовки модели; текстуры подставляются по вкусу, как раньше.
export async function createJar() {
  const rig = new THREE.Group(); // позиция, масштаб, наклон
  const spin = new THREE.Group(); // вращение вокруг оси
  rig.add(spin);
  const inner = new THREE.Group();
  inner.scale.setScalar(0.94); // модель чуть крупнее прежней банки: подгоняем под сцену
  spin.add(inner);

  const gltf = await new GLTFLoader().loadAsync(JAR_URL);
  const geoms = [];
  gltf.scene.traverse((o) => { if (o.isMesh) geoms.push(o.geometry); });
  if (geoms.length < 3) throw new Error('jar.glb: ожидалось три части');

  // polygonOffset: на стыке этикетки и хромированной горловины поверхности почти совпадают, без сдвига видны «молнии» z-конфликта
  const labelMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1, envMapIntensity: 1.1, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const lidMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 1, envMapIntensity: 0.75 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, metalness: 0.92, roughness: 0.36, envMapIntensity: 2.4 });
  [new THREE.Mesh(geoms[0], labelMat), new THREE.Mesh(geoms[1], lidMat), new THREE.Mesh(geoms[2], chrome)].forEach((m) => inner.add(m));

  // точки привязки для выносок (не вращаются вместе с банкой)
  const anchors = {};
  [['lid', -1.03, 0.52, 0.2], ['body', -1.0, -0.24, 0.2], ['base', -0.94, -0.85, 0.2]].forEach(([name, x, y, z]) => {
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
    // боковина крышки и дно того же цвета, что и банка: тон вкуса на тёмной основе; у фирменной банки чёрный
    const sk = SKINS[id];
    if (sk && id !== 'brand') chrome.color.set(sk.b).lerp(tmpC.set(sk.c), 0.12);
    else chrome.color.set('#18181c');
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
