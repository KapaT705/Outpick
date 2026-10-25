// Распознавание героев в верхней панели экрана пиков по портретам.
// Работает в главном процессе Electron на сыром кадре (BGRA или RGBA).
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const TW = 32, TH = 18;
// геометрия слотов для 16:9 в долях кадра (откалибровано по скриншоту 2560x1440)
const SLOT = { y: 6 / 1125, h: 56 / 1125, w: 94 / 2000, inset: 8 / 2000, radiantX: [0, 1, 2, 3, 4].map((i) => (234 + i * 128) / 2000), direX: [0, 1, 2, 3, 4].map((i) => (1152 + i * 128) / 2000) };
const CROPS = [[0.1, 0, 0.8, 1], [0.2, 0, 0.6, 1], [0.15, 0.1, 0.7, 0.8]];
const MIN_SCORE = 0.42, MIN_MARGIN = 0.05, EMPTY_NCC = 0.75;

let templates = null; // [{id, name, crops:[Float32Array]}]
let emptyT = null;

function sample(img, x, y, w, h, tw = TW, th = TH) {
  const { w: W, h: H, data, bgra } = img;
  const out = new Float32Array(tw * th * 3);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const sx0 = x + (tx / tw) * w, sx1 = x + ((tx + 1) / tw) * w, sy0 = y + (ty / th) * h, sy1 = y + ((ty + 1) / th) * h;
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const i = (sy * W + sx) * 4;
      if (bgra) { b += data[i]; g += data[i + 1]; r += data[i + 2]; } else { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
      n++;
    }
    const o = (ty * tw + tx) * 3; out[o] = r / (n || 1); out[o + 1] = g / (n || 1); out[o + 2] = b / (n || 1);
  }
  return out;
}
function normalize(v) { let m = 0; for (const x of v) m += x; m /= v.length; let s = 0; for (const x of v) s += (x - m) ** 2; s = Math.sqrt(s / v.length) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = (v[i] - m) / s; return o; }
function ncc(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s / a.length; }

function loadTemplates(heroesJson, imgDir, emptyJson) {
  const heroes = JSON.parse(fs.readFileSync(heroesJson, "utf8"));
  templates = [];
  for (const h of heroes) {
    const f = path.join(imgDir, `${h.short}_horz.png`);
    if (!fs.existsSync(f)) continue;
    const p = PNG.sync.read(fs.readFileSync(f));
    const img = { w: p.width, h: p.height, data: p.data, bgra: false };
    templates.push({ id: h.id, name: h.name, crops: CROPS.map(([fx, fy, fw, fh]) => normalize(sample(img, fx * img.w, fy * img.h, fw * img.w, fh * img.h))) });
  }
  emptyT = Float32Array.from(JSON.parse(fs.readFileSync(emptyJson, "utf8")));
  return templates.length;
}

function slotRects(W, H) {
  // панель рассчитана на 16:9; при другом соотношении берём центральную 16:9 область по ширине
  const rects = [];
  const mk = (fx, team, idx) => ({ team, idx, x: Math.round((fx + SLOT.inset) * W), y: Math.round(SLOT.y * H + 2), w: Math.round((SLOT.w - 2 * SLOT.inset) * W), h: Math.round(SLOT.h * H - 4) });
  SLOT.radiantX.forEach((fx, i) => rects.push(mk(fx, "radiant", i)));
  SLOT.direX.forEach((fx, i) => rects.push(mk(fx, "dire", i)));
  return rects;
}

/** img: {w,h,data,bgra}. Возвращает слоты с heroId или null (пусто/неуверенно). */
function recognize(img) {
  if (!templates) throw new Error("templates not loaded");
  return slotRects(img.w, img.h).map((r) => {
    const raw = sample(img, r.x, r.y, r.w, r.h);
    const v = normalize(raw);
    const emptyScore = ncc(v, emptyT);
    if (emptyScore >= EMPTY_NCC) return { ...r, heroId: null, empty: true, emptyScore: +emptyScore.toFixed(2) };
    let best = null, second = null;
    for (const t of templates) {
      let s = -1; for (const c of t.crops) { const q = ncc(v, c); if (q > s) s = q; }
      if (!best || s > best.s) { second = best; best = { id: t.id, name: t.name, s }; } else if (!second || s > second.s) second = { id: t.id, name: t.name, s };
    }
    const ok = best && best.s >= MIN_SCORE && best.s - (second?.s ?? 0) >= MIN_MARGIN;
    return { ...r, heroId: ok ? best.id : null, name: ok ? best.name : null, score: +best.s.toFixed(2), margin: +(best.s - (second?.s ?? 0)).toFixed(2), emptyScore: +emptyScore.toFixed(2) };
  });
}

module.exports = { loadTemplates, recognize, slotRects, sample, normalize, TW, TH };
