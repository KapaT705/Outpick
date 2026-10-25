// Прототип распознавания героев на экране пиков по портретам.
// Запуск: node tools/match-draft.mjs <скриншот.png|jpg> [--scan | --rects x,y,w,h;...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "desktop", "package.json"));
const { PNG } = require("pngjs");
const jpeg = require("jpeg-js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const heroes = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "heroes.json"), "utf8"));
const TW = 48, TH = 27; // размер сравнения (пропорции 16:9 как у horz-портретов)

function decode(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0x89 && buf[1] === 0x50) { const p = PNG.sync.read(buf); return { w: p.width, h: p.height, data: p.data }; }
  const j = jpeg.decode(buf, { useTArray: true }); return { w: j.width, h: j.height, data: j.data };
}
// билинейное уменьшение области в массив [r,g,b] размером TW*TH
function sample(img, x, y, w, h, tw = TW, th = TH) {
  const out = new Float32Array(tw * th * 3);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const sx0 = x + (tx / tw) * w, sx1 = x + ((tx + 1) / tw) * w, sy0 = y + (ty / th) * h, sy1 = y + ((ty + 1) / th) * h;
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
      const i = (sy * img.w + sx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
    }
    const o = (ty * tw + tx) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return out;
}
function normalize(v) { // убираем яркость/контраст: вычитаем среднее, делим на СКО (по каналам вместе)
  let m = 0; for (const x of v) m += x; m /= v.length;
  let s = 0; for (const x of v) s += (x - m) ** 2; s = Math.sqrt(s / v.length) || 1;
  return v.map((x) => (x - m) / s);
}
function ncc(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s / a.length; }

// шаблоны: горизонтальные портреты, в драфте показывают центральную часть, поэтому сравниваем несколько кропов
const templates = heroes.map((h) => {
  const img = decode(path.join(ROOT, "desktop", "assets", "heroes", `${h.short}_horz.png`));
  const crops = [[0, 0, 1, 1], [0.1, 0.05, 0.8, 0.9], [0.15, 0.1, 0.7, 0.8], [0.2, 0, 0.6, 1]].map(([fx, fy, fw, fh]) => normalize(sample(img, fx * img.w, fy * img.h, fw * img.w, fh * img.h)));
  return { ...h, crops };
});
function best(vec) {
  const v = normalize(vec);
  let out = [];
  for (const t of templates) { let m = -1; for (const c of t.crops) m = Math.max(m, ncc(v, c)); out.push({ id: t.id, name: t.name, score: m }); }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 3);
}

const file = process.argv[2];
if (!file) { console.error("usage: node tools/match-draft.mjs <screenshot> [--scan] [--rects x,y,w,h;...]"); process.exit(1); }
const img = decode(file);
console.log(`image ${img.w}x${img.h}`);
const argRects = process.argv.find((a) => a.startsWith("--rects"));
if (argRects) {
  const rects = (argRects.split("=")[1] ?? process.argv[process.argv.indexOf(argRects) + 1]).split(";").map((r) => r.split(",").map(Number));
  for (const [x, y, w, h] of rects) { const b = best(sample(img, x, y, w, h)); console.log(`rect ${x},${y},${w},${h}: ${b.map((r) => `${r.name} ${r.score.toFixed(2)}`).join(" | ")}`); }
} else {
  // режим поиска: скользим окном по верхней четверти экрана, ищем, где портреты
  const stripH = Math.floor(img.h * 0.3);
  const results = [];
  for (const scale of [0.045, 0.055, 0.065, 0.075, 0.09]) { // ширина окна как доля ширины экрана
    const w = Math.round(img.w * scale), h = Math.round(w * 9 / 16);
    const stepX = Math.max(4, Math.round(w / 6)), stepY = Math.max(4, Math.round(h / 4));
    for (let y = 0; y + h <= stripH; y += stepY) for (let x = 0; x + w <= img.w; x += stepX) {
      const vec = sample(img, x, y, w, h);
      // пропускаем почти однотонные области
      let m = 0; for (const v of vec) m += v; m /= vec.length; let s = 0; for (const v of vec) s += (v - m) ** 2; if (Math.sqrt(s / vec.length) < 18) continue;
      const b = best(vec)[0];
      if (b.score > 0.55) results.push({ x, y, w, h, ...b });
    }
  }
  results.sort((a, b) => b.score - a.score);
  // убираем дубли (пересекающиеся окна с тем же героем)
  const kept = [];
  for (const r of results) { if (kept.some((k) => k.id === r.id && Math.abs(k.x - r.x) < r.w && Math.abs(k.y - r.y) < r.h)) continue; kept.push(r); }
  for (const r of kept.slice(0, 20)) console.log(`${r.name.padEnd(18)} score ${r.score.toFixed(2)} at x=${r.x} y=${r.y} w=${r.w} h=${r.h}  (fx=${(r.x / img.w).toFixed(3)} fy=${(r.y / img.h).toFixed(3)} fw=${(r.w / img.w).toFixed(3)})`);
}
