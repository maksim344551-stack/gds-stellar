import * as THREE from 'three';
import { SKINS } from './data.js';

import LOGO_URL from './assets/logo-lg.png';
const SANS = '"Manrope Variable", system-ui, sans-serif';
const DISPLAY = '"Unbounded Variable", "Manrope Variable", sans-serif';

let logo = null;
const tintCache = new Map();
const texCache = new Map();
let maxAniso = 8;

export async function loadSkinAssets(renderer) {
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  logo = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = LOGO_URL;
  });
  try {
    await Promise.all([
      document.fonts.load(`700 40px ${DISPLAY}`),
      document.fonts.load(`500 40px ${DISPLAY}`),
      document.fonts.load(`600 30px ${SANS}`),
      document.fonts.load(`800 30px ${SANS}`),
    ]);
  } catch { /* шрифты подтянутся позже, лейбл просто перерисуется при следующем показе */ }
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tintedLogo(kind) {
  if (tintCache.has(kind)) return tintCache.get(kind);
  const c = canvas(logo.width, logo.height);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, c.width * 0.35, c.height);
  const stops = kind === 'gold'
    ? [[0, '#f6e3a2'], [0.35, '#c99a43'], [0.6, '#f0d27f'], [1, '#8a6420']]
    : [[0, '#ffffff'], [0.35, '#aab2ba'], [0.6, '#f1f4f6'], [1, '#7c848c']];
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(logo, 0, 0);
  tintCache.set(kind, c);
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
function fitText(ctx, text, x, y, maxW, size, weight, family, color, spacing = 0) {
  let s = size;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (; s > 12; s -= 2) {
    ctx.font = `${weight} ${s}px ${family}`;
    ctx.letterSpacing = `${spacing}px`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
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

function drawLabel(skin) {
  const W = 2048;
  const H = 1024;
  const cx = W / 2;
  const c = canvas(W, H);
  const x = c.getContext('2d');
  const brand = skin.id === 'brand';
  const r = rand(seedOf(skin.id));

  if (brand) {
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#17171a');
    g.addColorStop(1, '#070708');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  } else {
    x.fillStyle = skin.c;
    x.fillRect(0, 0, W, H);
    // «полярное сияние», как на рендере упаковки
    const g1 = x.createRadialGradient(cx - 160, H * 0.55, 20, cx - 160, H * 0.55, 760);
    g1.addColorStop(0, skin.a + 'e6');
    g1.addColorStop(0.45, skin.b + 'cc');
    g1.addColorStop(1, skin.c + '00');
    x.fillStyle = g1;
    x.fillRect(0, 0, W, H);
    const g2 = x.createLinearGradient(cx - 600, 0, cx + 500, H);
    g2.addColorStop(0, 'rgba(255,255,255,0)');
    g2.addColorStop(0.42, 'rgba(255,255,255,0.16)');
    g2.addColorStop(0.55, 'rgba(255,255,255,0)');
    x.fillStyle = g2;
    x.fillRect(0, 0, W, H);
  }

  // звёздная пыль
  for (let i = 0; i < 260; i++) {
    x.globalAlpha = 0.15 + r() * 0.5;
    x.fillStyle = brand ? '#e9c871' : '#ffffff';
    const s = r() * 2.2 + 0.6;
    x.fillRect(r() * W, r() * H, s, s);
  }
  x.globalAlpha = 1;

  const ink = brand ? '#e9c871' : '#ffffff';
  const logoKind = brand ? 'gold' : 'silver';

  // золотые линии сверху и снизу
  x.strokeStyle = brand ? 'rgba(233,200,113,0.55)' : 'rgba(255,255,255,0.35)';
  x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, 56); x.lineTo(W, 56); x.moveTo(0, H - 56); x.lineTo(W, H - 56); x.stroke();

  if (brand) {
    fitText(x, 'DISCOVER STAR', cx, 250, 640, 66, 600, DISPLAY, '#e9c871', 8);
    fitText(x, 'ЛИНЕЙКА STELLAR', cx, 312, 560, 30, 700, SANS, 'rgba(255,255,255,0.8)', 10);
  } else {
    fitText(x, 'PREMIUM CIGAR HOOKAH TOBACCO', cx, 168, 620, 28, 700, SANS, 'rgba(255,255,255,0.88)', 3);
    fitText(x, 'С АРОМАТОМ:', cx, 206, 400, 28, 700, SANS, 'rgba(255,255,255,0.88)', 3);
    fitText(x, skin.label, cx, 298, 640, 82, 700, DISPLAY, '#ffffff', 1);
    fitText(x, `«${skin.star.toUpperCase()}»`, cx, 372, 560, 58, 500, DISPLAY, skin.a, 4);
  }

  // логотип
  const lw = 600;
  const lh = (lw * logo.height) / logo.width;
  x.drawImage(tintedLogo(logoKind), cx - lw / 2, brand ? 392 : 418, lw, lh);

  fitText(x, '25 г', cx, H - 118, 300, 36, 700, SANS, 'rgba(255,255,255,0.7)', 6);

  // задняя сторона: маленький знак
  const sw = 260;
  const sh = (sw * logo.height) / logo.width;
  x.drawImage(tintedLogo(logoKind), 150 - sw / 2, H / 2 - sh / 2 - 30, sw, sh);
  fitText(x, 'DISCOVER STAR', 150, H / 2 + sh / 2 + 20, 280, 26, 600, DISPLAY, ink, 4);
  for (const [sx, sy, sr] of [[cx - 420, 250, 26], [cx + 410, 360, 20], [cx - 380, 760, 22], [cx + 330, 820, 30], [cx - 120, 640, 14]]) {
    sparkle(x, sx, sy, sr, '#ffffff', brand ? 0.55 : 0.95);
  }

  // чёрная панель для предупреждения (текст — заглушка, формулировку и графику даёт юрист)
  const px = cx + 640;
  x.fillStyle = '#050505';
  x.fillRect(px, 70, 330, H - 140);
  x.strokeStyle = 'rgba(255,255,255,0.35)';
  x.lineWidth = 3;
  x.strokeRect(px + 14, 84, 302, H - 168);
  fitText(x, 'КУРЕНИЕ', px + 165, 330, 270, 54, 800, SANS, '#ffffff', 2);
  fitText(x, 'ВРЕДИТ', px + 165, 396, 270, 54, 800, SANS, '#ffffff', 2);
  fitText(x, 'ВАШЕМУ', px + 165, 462, 270, 54, 800, SANS, '#ffffff', 2);
  fitText(x, 'ЗДОРОВЬЮ', px + 165, 528, 270, 54, 800, SANS, '#ffffff', 2);
  x.strokeStyle = '#ffffff';
  x.lineWidth = 5;
  x.beginPath(); x.arc(px + 165, 720, 62, 0, Math.PI * 2); x.stroke();
  fitText(x, '18+', px + 165, 744, 90, 56, 800, SANS, '#ffffff', 0);

  return c;
}

function drawLid(skin) {
  const S = 1024;
  const c = canvas(S, S);
  const x = c.getContext('2d');
  const brand = skin.id === 'brand';
  const r = rand(seedOf(skin.id) ^ 0x9e3779b9);

  if (brand) {
    const g = x.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S / 2);
    g.addColorStop(0, '#1b1b1f');
    g.addColorStop(1, '#070708');
    x.fillStyle = g;
  } else {
    const g = x.createRadialGradient(S * 0.42, S * 0.4, 30, S / 2, S / 2, S * 0.62);
    g.addColorStop(0, skin.a);
    g.addColorStop(0.5, skin.b);
    g.addColorStop(1, skin.c);
    x.fillStyle = g;
  }
  x.fillRect(0, 0, S, S);

  for (let i = 0; i < 160; i++) {
    x.globalAlpha = 0.15 + r() * 0.5;
    x.fillStyle = '#ffffff';
    const s = r() * 2.2 + 0.6;
    x.fillRect(r() * S, r() * S, s, s);
  }
  x.globalAlpha = 1;

  x.strokeStyle = brand ? 'rgba(233,200,113,0.5)' : 'rgba(255,255,255,0.35)';
  x.lineWidth = 4;
  x.beginPath(); x.arc(S / 2, S / 2, S * 0.45, 0, Math.PI * 2); x.stroke();

  const lw = S * 0.66;
  const lh = (lw * logo.height) / logo.width;
  x.drawImage(tintedLogo(brand ? 'gold' : 'silver'), S / 2 - lw / 2, S / 2 - lh / 2, lw, lh);
  sparkle(x, S * 0.2, S * 0.3, 34, '#ffffff', 0.9);
  sparkle(x, S * 0.82, S * 0.72, 28, '#ffffff', 0.85);
  sparkle(x, S * 0.74, S * 0.2, 18, '#ffffff', 0.7);
  return c;
}

function toTexture(cv, wrap) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (wrap) {
    t.wrapS = THREE.RepeatWrapping;
    t.offset.x = 0.5; // центр этикетки — на передней стороне цилиндра
  }
  t.needsUpdate = true;
  return t;
}

export function getSkinTextures(id) {
  if (!texCache.has(id)) {
    const skin = SKINS[id];
    texCache.set(id, { label: toTexture(drawLabel(skin), true), lid: toTexture(drawLid(skin), false) });
  }
  return texCache.get(id);
}
