// Распознавание героев в верхней панели экрана пиков по портретам.
// Работает в главном процессе Electron на сыром кадре (BGRA или RGBA).
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const TW = 32, TH = 18;
// Геометрия слотов относительно центра экрана, в единицах высоты кадра: так HUD Доты ведёт себя при любом
// разрешении и соотношении сторон (интерфейс масштабируется по высоте и центрируется).
// Откалибровано по скриншоту 2000x1125 (16:9): слоты радианта x=234+i*128, диров x=1152+i*128, y=6, w=94, h=56.
const U = 1125;
const SLOT = { y: 6 / U, h: 56 / U, w: 94 / U, inset: 8 / U, pitch: 128 / U, radiant0: (234 - 1000) / U, dire0: (1152 - 1000) / U };
// Интерфейс показывает в слоте не весь горизонтальный портрет, а его вырез: ~65% ширины от левого края ~15%
// и верхние ~79% высоты (подобрано по кадрам 2560x1440 и 2000x1125: сходство с правильным героем 0.8–0.96).
// Несколько близких вырезов на случай небольших отличий в кадрировании.
const CROPS = [[0.15, 0, 0.65, 0.79], [0.1, 0, 0.7, 0.85], [0.2, 0.05, 0.6, 0.71], [0.2, 0, 0.65, 0.79], [0.15, 0.05, 0.6, 0.71]];
// Пороги: сходство с лучшим портретом, отрыв от второго, сходство с пустым слотом,
// и минимальная «детальность» кропа (гладкий градиент рабочего стола или обоев героем быть не может:
// у настоящих портретов энергия границ ≥ 0.25, у пустых слотов и фона ≤ 0.17).
const MIN_SCORE = 0.42, MIN_MARGIN = 0.08, EMPTY_NCC = 0.75, MIN_EDGE = 0.2;
// Выученные портреты (персоны, арканы) считаются точнее базовых: совпадение с ними принимаем с меньшим отрывом.
const LEARNED_SCORE = 0.6;

let templates = null; // [{id, name, crops:[Float32Array], learned:[Float32Array]}]
let byId = new Map();
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
/** Средняя разность соседних точек нормализованного кропа: мера детальности. */
function edgeEnergy(v) {
  let s = 0, n = 0;
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) for (let c = 0; c < 3; c++) {
    const i = (y * TW + x) * 3 + c;
    if (x + 1 < TW) { s += Math.abs(v[i] - v[i + 3]); n++; }
    if (y + 1 < TH) { s += Math.abs(v[i] - v[i + TW * 3]); n++; }
  }
  return s / (n || 1);
}

function loadTemplates(heroesJson, imgDir, emptyJson) {
  const heroes = JSON.parse(fs.readFileSync(heroesJson, "utf8"));
  templates = []; byId = new Map();
  for (const h of heroes) {
    const f = path.join(imgDir, `${h.short}_horz.png`);
    if (!fs.existsSync(f)) continue;
    const p = PNG.sync.read(fs.readFileSync(f));
    const img = { w: p.width, h: p.height, data: p.data, bgra: false };
    const t = { id: h.id, name: h.name, crops: CROPS.map(([fx, fy, fw, fh]) => normalize(sample(img, fx * img.w, fy * img.h, fw * img.w, fh * img.h))), learned: [] };
    templates.push(t); byId.set(h.id, t);
  }
  emptyT = Float32Array.from(JSON.parse(fs.readFileSync(emptyJson, "utf8")));
  return templates.length;
}

/** Подгружает выученные портреты: { heroes: { [heroId]: [{ v: number[] }] } }. Возвращает их число. */
function loadLearned(file) {
  if (!templates) throw new Error("templates not loaded");
  for (const t of templates) t.learned = [];
  let n = 0;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [id, list] of Object.entries(j.heroes ?? {})) {
      const t = byId.get(Number(id));
      if (!t || !Array.isArray(list)) continue;
      for (const e of list) if (Array.isArray(e.v) && e.v.length === TW * TH * 3) { t.learned.push(Float32Array.from(e.v)); n++; }
    }
  } catch {}
  return n;
}
function addLearned(heroId, vec) { const t = byId.get(heroId); if (!t) return false; t.learned.push(Float32Array.from(vec)); return true; }
function learnedCount() { let n = 0; for (const t of templates ?? []) n += t.learned.length; return n; }

function slotRects(W, H) {
  const cx = W / 2;
  const rects = [];
  const mk = (off, team, idx) => ({ team, idx, x: Math.round(cx + (off + SLOT.inset) * H), y: Math.round(SLOT.y * H + 2), w: Math.round((SLOT.w - 2 * SLOT.inset) * H), h: Math.round(SLOT.h * H - 4) });
  for (let i = 0; i < 5; i++) rects.push(mk(SLOT.radiant0 + i * SLOT.pitch, "radiant", i));
  for (let i = 0; i < 5; i++) rects.push(mk(SLOT.dire0 + i * SLOT.pitch, "dire", i));
  return rects;
}
/** Высота верхней полосы, которую стоит показать для отладки (в пикселях кадра). */
function stripHeight(H) { return Math.round((SLOT.y + SLOT.h) * H + 12); }

/** Оценка одного нормализованного кропа: пустой слот, плоский фон или лучший/второй герой. */
function scoreVector(v, { useLearned = true } = {}) {
  const emptyScore = ncc(v, emptyT);
  const edge = edgeEnergy(v);
  let best = null, second = null, learnedHit = false;
  for (const t of templates) {
    let s = -1, viaLearned = false;
    for (const c of t.crops) { const q = ncc(v, c); if (q > s) s = q; }
    if (useLearned) for (const c of t.learned) { const q = ncc(v, c); if (q > s) { s = q; viaLearned = true; } }
    if (!best || s > best.s) { second = best; best = { id: t.id, name: t.name, s, viaLearned }; } else if (!second || s > second.s) second = { id: t.id, name: t.name, s };
  }
  if (best) learnedHit = best.viaLearned && best.s >= LEARNED_SCORE;
  const margin = best ? best.s - (second?.s ?? 0) : 0;
  const empty = emptyScore >= EMPTY_NCC;
  const flat = !empty && edge < MIN_EDGE;
  const ok = !empty && !flat && best && (learnedHit || (best.s >= MIN_SCORE && margin >= MIN_MARGIN));
  return { empty, flat, ok, best, second, margin, emptyScore, edge };
}

/** img: {w,h,data,bgra}. Возвращает слоты с heroId или null (пусто/неуверенно). */
function recognize(img) {
  if (!templates) throw new Error("templates not loaded");
  return slotRects(img.w, img.h).map((r) => {
    const v = normalize(sample(img, r.x, r.y, r.w, r.h));
    const q = scoreVector(v);
    if (q.empty) return { ...r, heroId: null, empty: true, emptyScore: +q.emptyScore.toFixed(2) };
    return {
      ...r, heroId: q.ok ? q.best.id : null, name: q.ok ? q.best.name : null, flat: q.flat,
      score: +(q.best?.s ?? 0).toFixed(2), margin: +q.margin.toFixed(2), emptyScore: +q.emptyScore.toFixed(2), edge: +q.edge.toFixed(2), learned: q.ok && q.best.viaLearned,
    };
  });
}

module.exports = { loadTemplates, loadLearned, addLearned, learnedCount, recognize, scoreVector, slotRects, stripHeight, sample, normalize, ncc, TW, TH };
