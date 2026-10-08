import * as THREE from 'three';
import { SKINS } from './data.js';
import LOGO_URL from './assets/logo-lg.png';

// Один шрифт сайта. DISPLAY печатается в расширенном начертании (как логотип), SANS в обычном.
const SANS = '"Roboto Flex Variable", system-ui, sans-serif';
const DISPLAY = '"Roboto Flex Variable", sans-serif';

// Карта «шероховатость/металличность» (G/B-каналы): пластик, чернила и фольга.
const MR = {
  plastic: 'rgb(255,128,0)',
  ink: 'rgb(255,112,0)',
  panel: 'rgb(255,150,0)',
  foil: 'rgb(255,84,196)',
};

const CACHE_LIMIT = 4;
let logo = null;
let maxAniso = 8;
const tintCache = new Map();
const cache = new Map(); // id -> { label, mr, lid, lidMr }
const pinned = new Set(); // комплекты, которые сейчас на банке: их нельзя выселять
export const pinSkin = (id) => { pinned.clear(); pinned.add(id); };

export async function loadSkinAssets(renderer) {
  maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  logo = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = LOGO_URL;
  });
  try {
    await Promise.all([
      document.fonts.load(`800 40px ${DISPLAY}`, 'МятаDiscover'),
      document.fonts.load(`500 40px ${SANS}`, 'Табак 25 г'),
      document.fonts.load(`700 30px ${SANS}`, 'КУРЕНИЕ ВРЕДИТ'),
    ]);
  } catch { /* шрифты подтянутся позже, этикетка перерисуется при следующем показе */ }
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function foilLogo(kind, solid) {
  const key = `${kind}:${solid || ''}`;
  if (tintCache.has(key)) return tintCache.get(key);
  const w = 1400;
  const h = Math.round((w * logo.height) / logo.width);
  const c = canvas(w, h);
  const x = c.getContext('2d');
  if (solid) {
    x.fillStyle = solid;
  } else {
    const g = x.createLinearGradient(0, 0, w * 0.4, h);
    const palettes = {
      gold: [[0, '#f8e7ad'], [0.35, '#d9aa4e'], [0.6, '#f3d98c'], [1, '#b38630']],
      ink: [[0, '#2e343a'], [0.35, '#0d1013'], [0.6, '#454c53'], [1, '#0a0c0e']],
      silver: [[0, '#ffffff'], [0.35, '#c5ccd3'], [0.6, '#f4f6f8'], [1, '#9aa3ab']],
    };
    const stops = palettes[kind] || palettes.silver;
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    x.fillStyle = g;
  }
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(logo, 0, 0, w, h);
  tintCache.set(key, c);
  return c;
}

function sparkle(ctx, x, y, r, color, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 0.08, -r * 0.08, r, 0);
  ctx.quadraticCurveTo(r * 0.08, r * 0.08, 0, r);
  ctx.quadraticCurveTo(-r * 0.08, r * 0.08, -r, 0);
  ctx.quadraticCurveTo(-r * 0.08, -r * 0.08, 0, -r);
  ctx.fill();
  ctx.restore();
}

// Текст, который сжимается до maxW, чтобы не вылезать за видимую часть цилиндра.
function fitText(ctx, text, x, y, maxW, size, weight, family, fill, spacing = 0) {
  let s = size;
  ctx.fillStyle = fill;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (; s > 12; s -= 2) {
    ctx.font = `${weight} ${s}px ${family}`;
    if ('fontStretch' in ctx) ctx.fontStretch = family === DISPLAY ? 'expanded' : 'normal'; // после font: шорткат сбрасывает ширину
    ctx.letterSpacing = `${spacing}px`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
}

function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Светлые этикетки печатаются тёмными чернилами — иначе белый текст теряется. */
function darkInk(skin) {
  return skin.id !== 'brand' && luminance(mixHex(skin.a, skin.b, 0.55)) > 0.3;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seedOf(id) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Рисует этикетку. pass: 'color' — альбедо, 'mr' — карта шероховатости/металличности. */
function drawLabel(x, skin, pass) {
  const W = 2048;
  const H = 1024;
  const cx = W / 2;
  const brand = skin.id === 'brand';
  const color = pass === 'color';
  const r = rand(seedOf(skin.id));
  const dark = darkInk(skin);
  const kind = brand ? 'gold' : dark ? 'ink' : 'silver';
  const foilFill = color ? (brand ? '#e9c871' : dark ? '#101316' : '#eef1f4') : MR.foil;
  const logoCanvas = color ? foilLogo(kind) : foilLogo('mr', MR.foil);
  const textMain = dark ? '#0b0d0a' : '#ffffff';
  const textSoft = dark ? 'rgba(8,10,8,0.88)' : 'rgba(255,255,255,0.9)';

  // основа
  if (!color) {
    x.fillStyle = MR.plastic;
    x.fillRect(0, 0, W, H);
  } else if (brand) {
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#18181b');
    g.addColorStop(1, '#070708');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  } else {
    x.fillStyle = skin.c;
    x.fillRect(0, 0, W, H);
    // «полярное сияние», как на рендере упаковки
    const g1 = x.createRadialGradient(cx - 160, H * 0.55, 20, cx - 160, H * 0.55, 780);
    g1.addColorStop(0, `${mixHex(skin.a, skin.b, 0.55)}ee`);
    g1.addColorStop(0.45, `${skin.b}d0`);
    g1.addColorStop(1, `${skin.c}00`);
    x.fillStyle = g1;
    x.fillRect(0, 0, W, H);
    const g2 = x.createLinearGradient(cx - 600, 0, cx + 500, H);
    g2.addColorStop(0, 'rgba(255,255,255,0)');
    g2.addColorStop(0.42, 'rgba(255,255,255,0.17)');
    g2.addColorStop(0.55, 'rgba(255,255,255,0)');
    x.fillStyle = g2;
    x.fillRect(0, 0, W, H);
  }

  // звёздная пыль (только в альбедо)
  if (color) {
    for (let i = 0; i < 300; i++) {
      x.globalAlpha = 0.12 + r() * 0.5;
      x.fillStyle = brand ? '#e9c871' : '#ffffff';
      const s = r() * 2.2 + 0.6;
      x.fillRect(r() * W, r() * H, s, s);
    }
    x.globalAlpha = 1;
  }

  // линии сверху и снизу — фольга
  x.strokeStyle = color ? (brand ? 'rgba(233,200,113,0.7)' : dark ? 'rgba(10,12,10,0.55)' : 'rgba(255,255,255,0.55)') : MR.foil;
  x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, 56); x.lineTo(W, 56); x.moveTo(0, H - 56); x.lineTo(W, H - 56); x.stroke();

  const white = color ? textSoft : MR.ink;
  if (brand) {
    fitText(x, 'DISCOVER STAR', cx, 250, 640, 62, 800, DISPLAY, foilFill, 4);
    fitText(x, 'ЛИНЕЙКА STELLAR', cx, 312, 560, 30, 700, SANS, color ? 'rgba(255,255,255,0.78)' : MR.ink, 10);
  } else {
    fitText(x, 'PREMIUM CIGAR HOOKAH TOBACCO', cx, 168, 620, 28, 700, SANS, white, 3);
    fitText(x, 'С АРОМАТОМ:', cx, 206, 400, 28, 700, SANS, white, 3);
    fitText(x, skin.label, cx, 298, 640, 78, 800, DISPLAY, color ? textMain : MR.ink, 0);
    fitText(x, `«${skin.star.toUpperCase()}»`, cx, 372, 560, 54, 700, DISPLAY, color ? (dark ? textMain : skin.a) : MR.foil, 2);
  }

  // логотип — фольга
  const lw = 600;
  const lh = (lw * logo.height) / logo.width;
  x.drawImage(logoCanvas, cx - lw / 2, brand ? 392 : 418, lw, lh);

  fitText(x, '25 г', cx, H - 118, 300, 36, 700, SANS, color ? (dark ? 'rgba(8,10,8,0.78)' : 'rgba(255,255,255,0.72)') : MR.ink, 6);

  // задняя сторона: маленький знак
  const sw = 260;
  const sh = (sw * logo.height) / logo.width;
  x.drawImage(logoCanvas, 150 - sw / 2, H / 2 - sh / 2 - 30, sw, sh);
  fitText(x, 'DISCOVER STAR', 150, H / 2 + sh / 2 + 20, 280, 24, 700, DISPLAY, foilFill, 2);

  if (color) {
    for (const [sx, sy, sr] of [[cx - 420, 250, 26], [cx + 410, 360, 20], [cx - 380, 760, 22], [cx + 330, 820, 30], [cx - 120, 640, 14]]) {
      sparkle(x, sx, sy, sr, '#ffffff', brand ? 0.55 : 0.95);
    }
  }

  // чёрная панель для предупреждения (текст — заглушка: формулировку и графику даёт юрист)
  const px = cx + 640;
  x.fillStyle = color ? '#050505' : MR.panel;
  x.fillRect(px, 70, 330, H - 140);
  x.strokeStyle = color ? 'rgba(255,255,255,0.35)' : MR.ink;
  x.lineWidth = 3;
  x.strokeRect(px + 14, 84, 302, H - 168);
  const warn = color ? '#ffffff' : MR.ink;
  fitText(x, 'КУРЕНИЕ', px + 165, 330, 270, 54, 800, SANS, warn, 2);
  fitText(x, 'ВРЕДИТ', px + 165, 396, 270, 54, 800, SANS, warn, 2);
  fitText(x, 'ВАШЕМУ', px + 165, 462, 270, 54, 800, SANS, warn, 2);
  fitText(x, 'ЗДОРОВЬЮ', px + 165, 528, 270, 54, 800, SANS, warn, 2);
  x.strokeStyle = warn;
  x.lineWidth = 5;
  x.beginPath(); x.arc(px + 165, 720, 62, 0, Math.PI * 2); x.stroke();
  fitText(x, '18+', px + 165, 744, 90, 56, 800, SANS, warn, 0);
}

function drawLid(x, skin, pass) {
  const S = 1024;
  const brand = skin.id === 'brand';
  const color = pass === 'color';
  const r = rand(seedOf(skin.id) ^ 0x9e3779b9);

  if (!color) {
    x.fillStyle = MR.plastic;
    x.fillRect(0, 0, S, S);
  } else if (brand) {
    const g = x.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S / 2);
    g.addColorStop(0, '#1d1d21');
    g.addColorStop(1, '#070708');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
  } else {
    const g = x.createRadialGradient(S * 0.42, S * 0.4, 30, S / 2, S / 2, S * 0.62);
    g.addColorStop(0, mixHex(skin.a, skin.b, 0.55));
    g.addColorStop(0.5, skin.b);
    g.addColorStop(1, skin.c);
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
  }

  if (color) {
    for (let i = 0; i < 180; i++) {
      x.globalAlpha = 0.12 + r() * 0.5;
      x.fillStyle = '#ffffff';
      const s = r() * 2.2 + 0.6;
      x.fillRect(r() * S, r() * S, s, s);
    }
    x.globalAlpha = 1;
  }

  const dark = darkInk(skin);
  x.strokeStyle = color ? (brand ? 'rgba(233,200,113,0.65)' : dark ? 'rgba(10,12,10,0.5)' : 'rgba(255,255,255,0.5)') : MR.foil;
  x.lineWidth = 4;
  x.beginPath(); x.arc(S / 2, S / 2, S * 0.45, 0, Math.PI * 2); x.stroke();

  const lw = S * 0.66;
  const lh = (lw * logo.height) / logo.width;
  const lidLogo = color ? foilLogo(brand ? 'gold' : dark ? 'ink' : 'silver') : foilLogo('mr', MR.foil);
  x.drawImage(lidLogo, S / 2 - lw / 2, S / 2 - lh / 2, lw, lh);
  if (color) {
    sparkle(x, S * 0.2, S * 0.3, 34, '#ffffff', 0.9);
    sparkle(x, S * 0.82, S * 0.72, 28, '#ffffff', 0.85);
    sparkle(x, S * 0.74, S * 0.2, 18, '#ffffff', 0.7);
  }
}

function toTexture(cv, { srgb, wrap }) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  if (wrap) {
    t.wrapS = THREE.RepeatWrapping;
    t.offset.x = 0.5; // центр этикетки — на передней стороне цилиндра
  }
  t.needsUpdate = true;
  return t;
}

// Этикетка рисуется в «авторском» пространстве 2048x1024 и масштабируется под реальный размер текстуры.
// 2560x1280 даёт около 410 текселей на единицу длины окружности: чёткий текст и при плотности пикселей 2,
// при этом один комплект занимает около 33 МБ видеопамяти (3072x1536 был бы около 47 МБ).
function build(id) {
  const skin = SKINS[id];
  const label = canvas(2560, 1280);
  const lc = label.getContext('2d');
  lc.scale(1.25, 1.25);
  drawLabel(lc, skin, 'color');
  const mr = canvas(1280, 640);
  const mc = mr.getContext('2d');
  mc.scale(0.625, 0.625);
  drawLabel(mc, skin, 'mr');
  const lid = canvas(1280, 1280);
  const ld = lid.getContext('2d');
  ld.scale(1.25, 1.25);
  drawLid(ld, skin, 'color');
  const lidMr = canvas(640, 640);
  const lm = lidMr.getContext('2d');
  lm.scale(0.625, 0.625);
  drawLid(lm, skin, 'mr');
  return {
    label: toTexture(label, { srgb: true, wrap: true }),
    mr: toTexture(mr, { srgb: false, wrap: true }),
    lid: toTexture(lid, { srgb: true }),
    lidMr: toTexture(lidMr, { srgb: false }),
  };
}

export function getSkinTextures(id) {
  let entry = cache.get(id);
  if (!entry) {
    entry = build(id);
    cache.set(id, entry);
  } else {
    cache.delete(id); // обновляем порядок: свежие — в конце
    cache.set(id, entry);
  }
  // выбрасываем самые давние, чтобы не копить сотни МБ видеопамяти
  while (cache.size > CACHE_LIMIT) {
    const victim = [...cache.entries()].find(([k]) => k !== id && !pinned.has(k));
    if (!victim) break;
    const [oldId, old] = victim;
    Object.values(old).forEach((t) => t.dispose());
    cache.delete(oldId);
  }
  return entry;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 800 }) : setTimeout(r, 60)));

/**
 * Готовит текстуры заранее, по одной штуке за раз (рисование и загрузка в GPU разнесены по кадрам),
 * чтобы смена вкуса и первый скролл не давали рывков. immediate: true для заставки, иначе в простое.
 */
export async function warmSkins(ids, renderer, { immediate = false } = {}) {
  for (const id of ids) {
    await (immediate ? frame() : idle());
    const t = getSkinTextures(id);
    for (const tx of Object.values(t)) {
      await frame();
      renderer?.initTexture(tx);
    }
  }
}
