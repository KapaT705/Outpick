// Кадры со стадии пиков на диске и самообучение портретов по итогам матча.
// Папка userData/pick-frames/<matchId|draft-...>/frame-N.{json,jpg,strip.png}; метки приходят от сервера
// (userData/pick-labels.json, по данным Stratz: герой каждого слота), выученные портреты лежат в userData/learned-templates.json.
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const recog = require("./recognize.js");

const MAX_FRAMES = 16, MAX_SESSIONS = 8, SESSION_GAP_MS = 180_000, RESAVE_MS = 20_000, MIN_SAVE_GAP_MS = 2_500;
const MAX_LEARNED_PER_HERO = 6, DUP_NCC = 0.92, MIN_CONSISTENT = 5, STABLE_NCC = 0.9;

let root = null, labelsFile = null, learnedFile = null;
let session = null; // {key, dir, matchId, lastAt, lastSavedAt, stateKey, n}

function init(userDir) {
  root = path.join(userDir, "pick-frames");
  labelsFile = path.join(userDir, "pick-labels.json");
  learnedFile = path.join(userDir, "learned-templates.json");
  fs.mkdirSync(root, { recursive: true });
}
const stateKeyOf = (slots) => slots.map((s) => (s.empty ? "E" : s.heroId ?? (s.flat ? "F" : "U"))).join(",");

function listSessions() {
  try {
    return fs.readdirSync(root).map((name) => { const dir = path.join(root, name); try { return { name, dir, mtime: fs.statSync(dir).mtimeMs }; } catch { return null; } }).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}
function prune() {
  for (const s of listSessions().slice(MAX_SESSIONS)) fs.rmSync(s.dir, { recursive: true, force: true });
}
function startSession(matchId, now) {
  const key = matchId ? String(matchId) : `draft-${new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const dir = path.join(root, key);
  fs.mkdirSync(dir, { recursive: true });
  session = { key, dir, matchId: matchId ? String(matchId) : null, lastAt: now, lastSavedAt: 0, stateKey: "", n: 0 };
  prune();
}
/** Привязывает текущую серию кадров к матчу (переименовывает папку). */
function markMatch(matchId) {
  if (!session || !matchId) return false;
  const id = String(matchId);
  if (session.matchId === id) return true;
  if (session.matchId && session.matchId !== id) return false;
  if (Date.now() - session.lastAt > 15 * 60_000) return false;
  const dir = path.join(root, id);
  try { fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(session.dir, dir); session.dir = dir; session.key = id; session.matchId = id; return true; } catch { return false; }
}

/** frame: {name,w,h,image(NativeImage)}; slots: результат recognize; ctx: {matchId, team, slot}. */
function remember(frame, slots, ctx = {}) {
  if (!root) return false;
  const now = Date.now();
  if (!session || now - session.lastAt > SESSION_GAP_MS || (ctx.matchId && session.matchId && String(ctx.matchId) !== session.matchId)) startSession(ctx.matchId, now);
  else if (ctx.matchId && !session.matchId) markMatch(ctx.matchId);
  session.lastAt = now;
  const key = stateKeyOf(slots);
  const changed = key !== session.stateKey;
  if (now - session.lastSavedAt < MIN_SAVE_GAP_MS) return false;
  if (!changed && now - session.lastSavedAt < RESAVE_MS) return false;
  try {
    const n = ++session.n;
    const stripH = Math.min(frame.h, frame.stripH ?? recog.stripHeight(frame.h));
    // кадр либо NativeImage (старый путь, тесты), либо полоса RGBA из окна (+ готовый JPEG уменьшенного кадра)
    let stripPng, jpg = null;
    if (frame.image) {
      stripPng = frame.image.crop({ x: 0, y: 0, width: frame.w, height: stripH }).toPNG();
      jpg = frame.image.resize({ width: Math.min(1280, frame.w) }).toJPEG(70);
    } else {
      const need = frame.w * stripH * 4;
      if (!frame.data || frame.data.length < need) throw new Error(`полоса кадра короче ожидаемого (${frame.data?.length ?? 0} < ${need})`);
      const p = new PNG({ width: frame.w, height: stripH });
      p.data = Buffer.from(frame.data.buffer, frame.data.byteOffset, need);
      stripPng = PNG.sync.write(p);
      jpg = frame.jpeg ?? null;
    }
    fs.writeFileSync(path.join(session.dir, `frame-${n}-strip.png`), stripPng);
    if (jpg) fs.writeFileSync(path.join(session.dir, `frame-${n}.jpg`), jpg);
    fs.writeFileSync(path.join(session.dir, `frame-${n}.json`), JSON.stringify({ at: new Date(now).toISOString(), source: frame.name, w: frame.w, h: frame.h, stripH, matchId: session.matchId, ctx, slots }, null, 1));
    session.stateKey = key; session.lastSavedAt = now;
    if (n > MAX_FRAMES) for (const suf of ["-strip.png", ".jpg", ".json"]) fs.rmSync(path.join(session.dir, `frame-${n - MAX_FRAMES}${suf}`), { force: true });
    return true;
  } catch (e) { console.warn("[frames] save:", e.message); return false; }
}

function readJson(file, dflt) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return dflt; } }
/** Кадры серии по возрастанию номера: [{n, json, strip: путь}]. */
function sessionFrames(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const m = /^frame-(\d+)\.json$/.exec(f); if (!m) continue;
    const n = Number(m[1]); const strip = path.join(dir, `frame-${n}-strip.png`);
    if (!fs.existsSync(strip)) continue;
    out.push({ n, json: readJson(path.join(dir, f), null), strip });
  }
  return out.filter((x) => x.json).sort((a, b) => a.n - b.n);
}
function decodeStrip(file) { const p = PNG.sync.read(fs.readFileSync(file)); return { w: p.width, h: p.height, data: p.data, bgra: false }; }

/** Для диагностики: файлы последних серий. */
function diagFiles(limit = 2) {
  const out = [];
  for (const s of listSessions().slice(0, limit)) for (const f of fs.readdirSync(s.dir)) out.push({ zipPath: `pick-frames/${s.name}/${f}`, file: path.join(s.dir, f) });
  return out;
}

/**
 * Обучение: для каждого размеченного матча берём два последних кадра серии, проверяем, что базовые портреты
 * узнают большинство слотов правильно (значит порядок слотов совпадает с разметкой), и для слотов, где герой
 * не узнан или узнан неверно, запоминаем кроп как дополнительный портрет этого героя (персона, аркана, иной стиль).
 */
function learn() {
  if (!root) return { ok: false, error: "not initialised" };
  const labels = readJson(labelsFile, { matches: {} }).matches ?? {};
  const learned = readJson(learnedFile, { version: 1, heroes: {}, done: [] });
  learned.heroes ??= {}; learned.done ??= [];
  let added = 0, checked = 0; const notes = [];
  for (const [matchId, lab] of Object.entries(labels)) {
    if (learned.done.includes(matchId)) continue;
    const dir = path.join(root, matchId);
    if (!fs.existsSync(dir)) continue;
    const frames = sessionFrames(dir).slice(-2);
    if (frames.length === 0) { learned.done.push(matchId); continue; }
    checked++;
    const expected = (team, idx) => (team === "radiant" ? lab.radiant : lab.dire)?.[idx] ?? null;
    // кропы по кадрам: [{team, idx, v, q}]
    const perFrame = frames.map((fr) => {
      const img = decodeStrip(fr.strip);
      return recog.slotRects(fr.json.w, fr.json.h).map((r) => { const v = recog.normalize(recog.sample(img, r.x, r.y, r.w, r.h)); return { team: r.team, idx: r.idx, v, q: recog.scoreVector(v, { useLearned: false }) }; });
    });
    const last = perFrame[perFrame.length - 1], prev = perFrame.length > 1 ? perFrame[0] : null;
    const consistent = last.filter((s) => s.q.ok && s.q.best.id === expected(s.team, s.idx)).length;
    if (consistent < MIN_CONSISTENT) { notes.push(`${matchId}: совпало только ${consistent} слотов, пропускаю`); learned.done.push(matchId); continue; }
    for (const s of last) {
      const want = expected(s.team, s.idx);
      if (!want || s.q.empty || s.q.flat) continue;
      if (s.q.ok && s.q.best.id === want) continue;
      // кроп должен быть стабилен между двумя последними кадрами (игрок не менял героя)
      if (prev) { const p = prev.find((x) => x.team === s.team && x.idx === s.idx); if (!p || recog.ncc(p.v, s.v) < STABLE_NCC) continue; }
      const list = (learned.heroes[want] ??= []);
      if (list.some((e) => recog.ncc(Float32Array.from(e.v), s.v) >= DUP_NCC)) continue;
      if (list.length >= MAX_LEARNED_PER_HERO) list.shift();
      list.push({ v: Array.from(s.v, (x) => +x.toFixed(3)), from: matchId, at: new Date().toISOString(), was: s.q.best?.name ?? null });
      recog.addLearned(Number(want), s.v);
      added++;
      notes.push(`${matchId}: ${s.team} ${s.idx + 1} выучен как ${want} (было: ${s.q.ok ? s.q.best.name : "не узнан"})`);
    }
    learned.done.push(matchId);
  }
  if (learned.done.length > 200) learned.done = learned.done.slice(-200);
  try { fs.writeFileSync(learnedFile, JSON.stringify(learned)); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, checked, added, total: recog.learnedCount(), notes };
}
function learnedInfo() {
  const learned = readJson(learnedFile, { heroes: {} });
  const heroes = Object.entries(learned.heroes ?? {}).map(([id, list]) => ({ heroId: Number(id), n: list.length }));
  return { total: heroes.reduce((a, h) => a + h.n, 0), heroes, sessions: listSessions().map((s) => s.name) };
}
function loadLearned() { return recog.loadLearned(learnedFile); }

module.exports = { init, remember, markMatch, learn, learnedInfo, loadLearned, diagFiles, labelsFile };
