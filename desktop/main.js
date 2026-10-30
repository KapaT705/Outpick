const { app, BrowserWindow, utilityProcess, shell, Menu, ipcMain, desktopCapturer, screen } = require("electron");
const recog = require("./recognize.js");
const frames = require("./frames.js");
const os = require("node:os");
const AdmZip = require("adm-zip");
const { PNG } = require("pngjs");

// --- журнал главного процесса (последние 800 строк) для диагностики ---
const LOG = [];
const logLine = (level, args) => { const line = `${new Date().toISOString()} [${level}] ${args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ")}`; LOG.push(line); if (LOG.length > 800) LOG.shift(); };
for (const lvl of ["log", "warn", "error"]) { const orig = console[lvl].bind(console); console[lvl] = (...a) => { logLine(lvl, a); orig(...a); }; }
// журнал пишется и на диск (userData/main-log.txt), при старте прошлый сохраняется как main-log-prev.txt:
// так диагностика после перезапуска видит, что было в прошлом запуске
let logFile = null, logPrevFile = null;
function flushLog() { if (!logFile) return; try { fs.writeFileSync(logFile, LOG.join("\n")); } catch {} }
function initLog(userDir) {
  logFile = path.join(userDir, "main-log.txt"); logPrevFile = path.join(userDir, "main-log-prev.txt");
  try { if (fs.existsSync(logFile)) fs.renameSync(logFile, logPrevFile); } catch {}
  setInterval(flushLog, 30_000);
}
// обещание с таймаутом: захват экрана на Windows изредка не отвечает, и без этого цикл чтения экрана зависал навсегда
function withTimeout(promise, ms, label) {
  let t; const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label}: нет ответа ${Math.round(ms / 1000)} с`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
process.on("uncaughtException", (e) => console.error("uncaught:", e?.stack ?? String(e)));
let serverPort = null;
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const net = require("node:net");

// Переименование в Outpick (0.10): папка данных пользователя раньше звалась «Dota Mid Helper» (по productName).
// appId не менялся, поэтому установщик и обновления те же, а историю, настройки и кадры переносим один раз сюда.
// Делается до whenReady, пока в новую папку никто не писал.
function migrateUserData() {
  try {
    const cur = app.getPath("userData");
    const old = path.join(path.dirname(cur), "Dota Mid Helper");
    if (!fs.existsSync(old) || fs.existsSync(path.join(cur, "config.json"))) return;
    fs.mkdirSync(cur, { recursive: true });
    for (const name of fs.readdirSync(old)) {
      const from = path.join(old, name), to = path.join(cur, name);
      if (fs.existsSync(to)) continue;
      try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true }); }
    }
    console.log(`[app] данные перенесены из «${old}» в «${cur}»`);
  } catch (e) { console.warn("[app] перенос данных не удался:", e?.message ?? e); }
}
const fs = require("node:fs");

const isDev = !app.isPackaged;
// --expose-gc: после каждого кадра принудительно отдаём память снимков экрана (Electron держит их до сборки мусора,
// а V8 не видит их размер, поэтому без этого процесс разрастался на гигабайты)
app.commandLine.appendSwitch("js-flags", "--expose-gc");
const { execFile } = require("node:child_process");

// --- запущена ли Дота: проверяем список процессов не чаще раза в 10 секунд ---
let dotaCheck = { at: 0, running: false };
function dotaRunning() {
  if (process.env.CAPTURE_ALWAYS) return Promise.resolve(true);
  const now = Date.now();
  if (now - dotaCheck.at < 10_000) return Promise.resolve(dotaCheck.running);
  dotaCheck.at = now;
  return new Promise((resolve) => {
    const done = (running) => { dotaCheck.running = running; resolve(running); };
    if (process.platform === "win32") execFile("tasklist", ["/FI", "IMAGENAME eq dota2.exe", "/NH", "/FO", "CSV"], { windowsHide: true, timeout: 5000 }, (err, out) => done(!err && /dota2\.exe/i.test(String(out))));
    else execFile("pgrep", ["-x", "dota2"], { timeout: 5000 }, (err) => done(!err));
  });
}
setInterval(() => { const m = process.memoryUsage(); console.log(`[mem] rss=${Math.round(m.rss / 1e6)}MB heap=${Math.round(m.heapUsed / 1e6)}MB ext=${Math.round(m.external / 1e6)}MB dota=${dotaCheck.running}`); }, Number(process.env.MEM_LOG_SEC || 300) * 1000);
let serverProc = null;
let win = null;

const PREFERRED_PORT = 3781; // на этот порт указывает конфиг GSI в Доте
function freePort(preferred = 0) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(preferred ? freePort(0) : 0));
    s.listen(preferred, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function waitFor(url, tries = 100) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      fetch(url).then((r) => (r.ok ? resolve() : retry(n))).catch(() => retry(n));
    };
    const retry = (n) => (n <= 0 ? reject(new Error("server did not start")) : setTimeout(() => attempt(n - 1), 200));
    attempt(tries);
  });
}

async function startServer() {
  const port = await freePort(PREFERRED_PORT);
  if (port !== PREFERRED_PORT) console.warn(`[app] порт ${PREFERRED_PORT} занят, использую ${port}: GSI из Доты не будет приходить`);
  const resources = isDev ? path.join(__dirname) : process.resourcesPath;
  const appDir = path.join(resources, "next-app");     // автономная сборка Next
  const dataDir = isDev ? path.join(__dirname, "..", "data") : path.join(resources, "data"); // данные Stratz (только чтение)
  const userDir = app.getPath("userData");             // журнал, настройки
  fs.mkdirSync(userDir, { recursive: true });
  initLog(userDir);
  frames.init(userDir);
  const serverJs = path.join(appDir, "server.js");
  if (!fs.existsSync(serverJs)) throw new Error(`Не найден ${serverJs}. Запусти npm run prepare-app.`);
  serverProc = utilityProcess.fork(serverJs, [], {
    cwd: appDir,
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production", DATA_DIR: dataDir, USER_DIR: userDir },
    stdio: "pipe",
  });
  serverProc.stdout?.on("data", (d) => { logLine("next", [String(d).trim()]); process.stdout.write(`[next] ${d}`); });
  serverProc.stderr?.on("data", (d) => { logLine("next-err", [String(d).trim()]); process.stderr.write(`[next] ${d}`); });
  serverPort = port;
  const url = `http://127.0.0.1:${port}`;
  await waitFor(url);
  console.log(`[app] server ready at ${url}`);
  return url;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: "#0f1115",
    title: "Outpick",
    autoHideMenuBar: true, // на Windows меню скрыто, Alt показывает
    icon: path.join(__dirname, "icon.png"),
    // backgroundThrottling: false — во время пиков окно за Дотой, а видеопоток и таймеры страницы должны работать
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("http://127.0.0.1")) { e.preventDefault(); shell.openExternal(url); } });
  try {
    // пока поднимается сервер (несколько секунд), окно показывает экран запуска с кристаллами, а не пустоту
    await win.loadFile(path.join(__dirname, "splash.html")).catch(() => {});
    const url = await startServer();
    await win.loadURL(url);
    if (isDev) {
      win.webContents.executeJavaScript("typeof window.desktop + ':' + Object.keys(window.desktop||{}).join(',')").then((v) => console.log(`[app] bridge: ${v}`)).catch((e) => console.log(`[app] bridge error: ${e}`));
      win.webContents.executeJavaScript("window.desktop.recognizeDraft()").then((v) => console.log(`[app] recognize: ${JSON.stringify(v).slice(0, 400)}`)).catch((e) => console.log(`[app] recognize error: ${e}`));
      if (process.env.FRAME_TEST) { // проверка хранения кадров на скриншоте: FRAME_TEST=/путь/к/скриншоту.jpg
        try { const { nativeImage } = require("electron"); const im = nativeImage.createFromPath(process.env.FRAME_TEST); const sz = im.getSize(); ensureTemplates();
          const frame = { name: "test", w: sz.width, h: sz.height, data: im.toBitmap(), bgra: true, image: im }; const slots = recog.recognize(frame);
          console.log(`[app] frame-test: ${slots.map((x) => x.name ?? "-").join(",")} saved=${frames.remember(frame, slots, { matchId: "999", team: "radiant", slot: 0 })} again=${frames.remember(frame, slots, { matchId: "999" })}`, JSON.stringify(frames.learnedInfo()));
        } catch (e) { console.log(`[app] frame-test error: ${e.stack}`); }
      }
      if (process.env.STREAM_TEST) { // проверка захвата видеопотоком и памяти: STREAM_TEST=<число кадров>
        const n = Number(process.env.STREAM_TEST) || 30;
        const m0 = process.memoryUsage().rss;
        win.webContents.executeJavaScript(`(async () => { const out = []; for (let i = 0; i < ${n}; i++) { const r = await window.desktop.recognizeDraft({ phase: "DOTA_GAMERULES_STATE_HERO_SELECTION" }); out.push(r.ok ? (r.black ? "black" : r.source + " " + r.w + "x" + r.h + " " + r.ms + "ms") : "ERR " + r.error); await new Promise((res) => setTimeout(res, 300)); } return out; })()`)
          .then((v) => { gcNow(); console.log(`[app] stream-test: ${JSON.stringify(v.slice(0, 3))} … всего ${v.length}, rss ${Math.round(m0 / 1e6)} → ${Math.round(process.memoryUsage().rss / 1e6)} MB`); })
          .catch((e) => console.log(`[app] stream-test error: ${e}`));
      }
      if (process.env.DIAG_TEST) setTimeout(() => win.webContents.executeJavaScript("window.desktop.saveDiagnostics()").then((v) => console.log(`[app] diag: ${JSON.stringify(v)}`)).catch((e) => console.log(`[app] diag error: ${e}`)), 3000);
    }
  } catch (err) {
    await win.loadURL(`data:text/html;charset=utf-8,<body style="font-family:sans-serif;background:#0f1115;color:#eee;padding:24px"><h2>Не удалось запустить сервер</h2><pre>${String(err.message)}</pre></body>`);
  }
}

// --- обновления через GitHub Releases: события уходят в окно, интерфейс рисует сама страница ---
const send = (data) => { try { win?.webContents.send("update:event", data); } catch {} };
function readUserConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf8")); } catch { return {}; }
}
// репозиторий открытый: релизы читаются без токена; старый токен из настроек, если он есть, просто не используется
function configureFeed() {
  autoUpdater.setFeedURL({ provider: "github", owner: "KapaT705", repo: "dota-mid-helper" });
  return true;
}
function setupUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.on("checking-for-update", () => send({ type: "checking" }));
  autoUpdater.on("update-available", (info) => send({ type: "available", version: info.version, current: app.getVersion() }));
  autoUpdater.on("update-not-available", () => send({ type: "none", current: app.getVersion() }));
  autoUpdater.on("download-progress", (p) => send({ type: "progress", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => send({ type: "downloaded", version: info.version }));
  autoUpdater.on("error", (e) => send({ type: "error", message: String(e?.message ?? e) }));
  ipcMain.handle("app:version", () => app.getVersion());
  // Тестовая сборка на маке: кнопка в настройках запускает desktop/scripts/install-mac.sh из папки проекта
  // (собирает текущий код, подменяет программу в /Applications, перезапускает). Только macOS и только если папка есть.
  const sourceScript = () => { const dir = process.env.DMH_SOURCE_DIR || readUserConfig().sourceDir || "/Users/arsenijbabajcev/код/dota"; const f = path.join(dir, "desktop", "scripts", "install-mac.sh"); return fs.existsSync(f) ? f : null; };
  ipcMain.handle("dev:info", () => ({ canRebuild: process.platform === "darwin" && !!sourceScript(), source: sourceScript() }));
  ipcMain.handle("dev:rebuild", () => {
    const f = sourceScript();
    if (process.platform !== "darwin" || !f) return { ok: false, reason: "только на маке с папкой проекта" };
    try { const child = require("node:child_process").spawn("/bin/zsh", [f], { detached: true, stdio: "ignore", env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` } }); child.unref(); console.log("[dev] пересборка из кода запущена:", f); return { ok: true }; }
    catch (e) { return { ok: false, reason: String(e?.message ?? e) }; }
  });
  ipcMain.handle("update:check", async () => {
    if (isDev) return { ok: false, reason: "dev" };
    configureFeed();
    try { await autoUpdater.checkForUpdates(); return { ok: true }; } catch (e) { return { ok: false, reason: String(e?.message ?? e) }; }
  });
  ipcMain.handle("update:download", async () => { try { await autoUpdater.downloadUpdate(); return { ok: true }; } catch (e) { return { ok: false, reason: String(e?.message ?? e) }; } });
  // тихая установка (NSIS /S) и автозапуск после неё: без мастера «Далее → Готово», окно программы просто возвращается
  ipcMain.handle("update:install", () => { setTimeout(() => autoUpdater.quitAndInstall(true, true), 300); return { ok: true }; });
  // тихая проверка при старте
  if (!isDev && configureFeed()) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
}

// --- распознавание экрана пиков ---
let templatesLoaded = false;
function ensureTemplates() {
  if (templatesLoaded) return true;
  const resources = isDev ? __dirname : process.resourcesPath;
  const dataDir = isDev ? path.join(__dirname, "..", "data") : path.join(resources, "data");
  const assets = isDev ? path.join(__dirname, "assets") : path.join(resources, "assets");
  try { recog.loadTemplates(path.join(dataDir, "heroes.json"), path.join(assets, "heroes"), [path.join(assets, "empty-slot.json"), path.join(assets, "empty-slot-2.json")]); templatesLoaded = true; const n = frames.loadLearned(); if (n) console.log(`[recog] выученных портретов: ${n}`); } catch (e) { console.error("[recog] templates:", e.message); }
  return templatesLoaded;
}
function frameIsBlack(bitmap, w, h) {
  // средняя яркость по сетке 32x32 точек верхней трети экрана
  let sum = 0, n = 0;
  for (let gy = 0; gy < 32; gy++) for (let gx = 0; gx < 32; gx++) { const x = Math.floor((gx + 0.5) * w / 32), y = Math.floor((gy + 0.5) * (h / 3) / 32); const i = (y * w + x) * 4; sum += bitmap[i] + bitmap[i + 1] + bitmap[i + 2]; n += 3; }
  return sum / n < 6;
}
let preferredScreen = null; // id экрана, на котором в прошлый раз была стадия пиков
function landscapeDisplays() {
  // Дота не бывает на вертикальном мониторе: такие экраны не читаем вовсе
  return screen.getAllDisplays().filter((d) => d.size.width >= d.size.height);
}
async function captureDotaFrame() {
  const displays = landscapeDisplays();
  if (displays.length === 0) throw new Error("нет горизонтальных экранов");
  const primaryId = String(screen.getPrimaryDisplay().id);
  const biggest = displays.reduce((a, d) => (d.size.width * d.scaleFactor > a.size.width * a.scaleFactor ? d : a), displays[0]);
  const size = { width: Math.round(biggest.size.width * biggest.scaleFactor), height: Math.round(biggest.size.height * biggest.scaleFactor) };
  // только экраны (окна не запрашиваем: каждый снимок окна стоит столько же памяти, сколько экран);
  // окно Доты берём отдельно, только если все экраны чёрные
  const all = await withTimeout(desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size, fetchWindowIcons: false }), 10_000, "захват экрана");
  const landscapeIds = new Set(displays.map((d) => String(d.id)));
  const screens = all.filter((s) => { const sz = s.thumbnail.getSize(); return (s.display_id ? landscapeIds.has(String(s.display_id)) : true) && sz.width >= sz.height; });
  const rank = (s) => (s.id === preferredScreen ? 0 : String(s.display_id) === primaryId ? 1 : 2);
  const ordered = screens.sort((a, b) => rank(a) - rank(b));
  let lastErr = "нет источников захвата";
  const tryWindow = async () => { const wins = await withTimeout(desktopCapturer.getSources({ types: ["window"], thumbnailSize: size, fetchWindowIcons: false }), 10_000, "захват окна"); return wins.filter((s) => /dota\s*2/i.test(s.name)); };
  for (const src of [...ordered, ...(await tryWindow().catch(() => []))]) {
    const img = src.thumbnail; const sz = img.getSize();
    if (sz.width === 0 || sz.height === 0) { lastErr = "пустой кадр"; continue; }
    const data = img.toBitmap();
    if (frameIsBlack(data, sz.width, sz.height)) { lastErr = `чёрный кадр из «${src.name}»`; continue; }
    return { id: src.id, name: src.name, w: sz.width, h: sz.height, data, bgra: true, image: img };
  }
  throw new Error(lastErr);
}
// Принудительная сборка мусора в главном процессе. Переключатель --expose-gc через app.commandLine действует только
// на страницы, в главном процессе global.gc так и остаётся undefined (в 0.7.1–0.7.3 сборка не вызывалась, и снимки экрана
// копились до 5 ГБ: V8 не видит их размер и сам сборку не запускает). Поэтому функцию gc берём через v8/vm.
let gcFn = null;
try { require("node:v8").setFlagsFromString("--expose-gc"); gcFn = require("node:vm").runInNewContext("gc"); } catch (e) { console.warn("[mem] gc недоступен:", e.message); }
console.log(`[mem] gc: ${typeof gcFn === "function" ? "есть" : "нет"}`);
const gcNow = () => { try { gcFn?.(); } catch {} };
// сводка цикла чтения экрана раз в минуту (только когда были вызовы): по ней видно, работал ли цикл во время пиков
const loop = { calls: 0, idle: 0, captured: 0, onPick: 0, saved: 0, errors: 0, lastErr: null, lastCtx: null, lastState: null };
setInterval(() => {
  if (!loop.calls) return;
  console.log(`[loop] вызовов=${loop.calls} дота_закрыта=${loop.idle} кадров=${loop.captured} экран_пиков=${loop.onPick} сохранено=${loop.saved} ошибок=${loop.errors}${loop.lastErr ? ` последняя: ${loop.lastErr}` : ""} ctx=${JSON.stringify(loop.lastCtx)} слоты=${loop.lastState ?? "-"}`);
  Object.assign(loop, { calls: 0, idle: 0, captured: 0, onPick: 0, saved: 0, errors: 0, lastErr: null });
}, 60_000);
// --- кадры приходят из окна: страница держит видеопоток экрана и присылает верхнюю полосу RGBA ---
// (desktopCapturer.getSources на каждый кадр на Windows не освобождал снимки: до 6 ГБ за два матча)
ipcMain.handle("capture:gate", async () => (ensureTemplates() ? { ok: true, dota: await dotaRunning() } : { ok: false, error: "шаблоны героев не загружены" }));
ipcMain.handle("capture:sources", async () => {
  const displays = landscapeDisplays();
  const ids = new Set(displays.map((d) => String(d.id)));
  const primaryId = String(screen.getPrimaryDisplay().id);
  const all = await withTimeout(desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }), 10_000, "список экранов");
  const list = all.filter((src) => !src.display_id || ids.has(String(src.display_id))).map((src) => {
    const d = displays.find((x) => String(x.id) === String(src.display_id)) ?? displays[0];
    return { id: src.id, name: src.name, displayId: String(src.display_id || ""), w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor) };
  });
  const rank = (x) => (x.id === preferredScreen ? 0 : x.displayId === primaryId ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b));
});
const bytes = (u) => (u ? Buffer.from(u.buffer ?? u, u.byteOffset ?? 0, u.byteLength ?? u.length) : null);
function frameFromRenderer(f) {
  if (!f || !f.strip || !f.w || !f.h || !f.stripH) throw new Error("пустой кадр из окна");
  const strip = f.strip instanceof Uint8Array ? f.strip : new Uint8Array(f.strip);
  if (strip.length < f.w * f.stripH * 4) throw new Error("полоса кадра короче ожидаемого");
  return { id: f.id, name: f.name, w: f.w, h: f.h, stripH: f.stripH, data: strip, bgra: false, jpeg: bytes(f.jpeg), png: bytes(f.png) };
}
const slotsOut = (slots) => slots.map((x) => ({ team: x.team, idx: x.idx, heroId: x.heroId, name: x.name ?? null, score: x.score ?? null, margin: x.margin ?? null, empty: !!x.empty, learned: !!x.learned }));
ipcMain.handle("draft:recognizeFrame", async (_e, ctx, f) => {
  if (!ensureTemplates()) return { ok: false, error: "шаблоны героев не загружены" };
  loop.calls++; loop.lastCtx = ctx ?? null;
  try {
    const frame = frameFromRenderer(f);
    loop.captured++;
    const t = Date.now();
    if (frameIsBlack(frame.data, frame.w, frame.stripH * 3)) { loop.lastState = "black"; return { ok: true, black: true, source: frame.name, w: frame.w, h: frame.h, ms: Date.now() - t, onPickScreen: false, slots: [] }; }
    const slots = recog.recognize(frame);
    const onPickScreen = slots.filter((x) => x.empty || x.heroId).length >= 4;
    const c = ctx && typeof ctx === "object" ? ctx : {};
    // пока Дота по GSI сообщает стадию выбора героев, кадры сохраняем даже если панель не распознана:
    // по ним потом видно, как выглядит экран, который программа не поняла
    const inPicks = c.phase === "DOTA_GAMERULES_STATE_HERO_SELECTION";
    if (onPickScreen) { loop.onPick++; preferredScreen = frame.id; }
    if (onPickScreen || inPicks) { if (frames.remember(frame, slots, c)) loop.saved++; }
    loop.lastState = slots.map((x) => (x.empty ? "E" : x.heroId ?? (x.flat ? "F" : "U"))).join(",");
    return { ok: true, source: frame.name, w: frame.w, h: frame.h, ms: Date.now() - t, onPickScreen, slots: slotsOut(slots) };
  } catch (e) { loop.errors++; loop.lastErr = String(e?.message ?? e); return { ok: false, error: String(e?.message ?? e) }; }
});
function stripDataUrl(frame) {
  const p = new PNG({ width: frame.w, height: frame.stripH });
  p.data = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.w * frame.stripH * 4);
  return `data:image/png;base64,${PNG.sync.write(p).toString("base64")}`;
}
ipcMain.handle("draft:debug", async (_e, f) => {
  if (!ensureTemplates()) return { ok: false, error: "шаблоны героев не загружены" };
  try {
    const frame = frameFromRenderer(f);
    const slots = recog.recognize(frame);
    const onPickScreen = slots.filter((x) => x.empty || x.heroId).length >= 4;
    if (onPickScreen) frames.remember(frame, slots, {});
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } }).catch(() => []);
    return { ok: true, source: frame.name, w: frame.w, h: frame.h, stripH: frame.stripH, scale: 1, image: stripDataUrl(frame), slots, onPickScreen, sources: sources.map((x) => x.name).slice(0, 12), dotaRunning: await dotaRunning() };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});
async function serverJson(pathname) {
  try { const r = await fetch(`http://127.0.0.1:${serverPort}${pathname}`); return await r.json(); } catch (e) { return { error: String(e?.message ?? e) }; }
}
ipcMain.handle("diag:save", async (_e, f) => {
  try {
    const zip = new AdmZip();
    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, size: d.size, scaleFactor: d.scaleFactor, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id }));
    const settings = await serverJson("/api/settings");
    const info = { app: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch, os: `${os.type()} ${os.release()}`, cpu: os.cpus()?.[0]?.model, memGb: Math.round(os.totalmem() / 1e9), displays, serverPort, savedAt: new Date().toISOString(), settings, memory: process.memoryUsage(), dotaRunning: await dotaRunning(), uptimeMin: Math.round(process.uptime() / 60) };
    zip.addFile("info.json", Buffer.from(JSON.stringify(info, null, 2)));
    zip.addFile("main-log.txt", Buffer.from(LOG.join("\n")));
    try { if (logPrevFile && fs.existsSync(logPrevFile)) zip.addFile("main-log-prev.txt", fs.readFileSync(logPrevFile)); } catch {}
    zip.addFile("gsi-raw.json", Buffer.from(JSON.stringify(await serverJson("/api/gsi/raw"), null, 1)));
    const gsiCfg = await serverJson("/api/gsi/install");
    zip.addFile("gsi-config.json", Buffer.from(JSON.stringify(gsiCfg, null, 1)));
    // файлы Доты, где при подключении к матчу могут быть Steam ID всех десяти игроков (server_log.txt) — хвост 256 КБ
    for (const dir of gsiCfg?.dotaDirs ?? []) for (const name of ["server_log.txt", "console.log"]) {
      try {
        const p = path.join(dir, name); if (!fs.existsSync(p)) continue;
        const st = fs.statSync(p); const len = Math.min(st.size, 256 * 1024); const buf = Buffer.alloc(len);
        const fd = fs.openSync(p, "r"); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
        zip.addFile(`dota-${name}`, buf);
      } catch {}
    }
    zip.addFile("draft-log.json", Buffer.from(JSON.stringify(await serverJson("/api/log"), null, 1)));
    zip.addFile("refresh.json", Buffer.from(JSON.stringify(await serverJson("/api/refresh"), null, 1)));
    try { const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } }); zip.addFile("capture-sources.json", Buffer.from(JSON.stringify(sources.map((s) => ({ id: s.id, name: s.name })), null, 1))); } catch (e) { zip.addFile("capture-sources.json", Buffer.from(JSON.stringify({ error: String(e?.message ?? e) }))); }
    // свежий кадр с распознаванием: из видеопотока окна, а если его нет (Дота закрыта и поток не поднялся) — снимок экрана
    try {
      if (f && f.strip) {
        const frame = frameFromRenderer(f);
        const slots = ensureTemplates() ? recog.recognize(frame) : [];
        if (frame.png) zip.addFile("frame-now.png", frame.png); else zip.addFile("frame-now-strip.png", Buffer.from(stripDataUrl(frame).split(",")[1], "base64"));
        zip.addFile("frame-now.json", Buffer.from(JSON.stringify({ source: frame.name, via: "stream", w: frame.w, h: frame.h, slots }, null, 1)));
      } else {
        const frame = await captureDotaFrame();
        const slots = ensureTemplates() ? recog.recognize(frame) : [];
        zip.addFile("frame-now.png", frame.image.toPNG());
        zip.addFile("frame-now.json", Buffer.from(JSON.stringify({ source: frame.name, via: "desktopCapturer", w: frame.w, h: frame.h, slots }, null, 1)));
      }
    } catch (e) { zip.addFile("frame-now.json", Buffer.from(JSON.stringify({ error: String(e?.message ?? e) }))); }
    gcNow();
    // кадры со стадии пиков двух последних драфтов (хранятся на диске, переживают перезапуск), разметка и выученные портреты
    let nFrames = 0;
    for (const f of frames.diagFiles(2)) { try { zip.addFile(f.zipPath, fs.readFileSync(f.file)); nFrames++; } catch {} }
    zip.addFile("learned.json", Buffer.from(JSON.stringify(frames.learnedInfo(), null, 1)));
    try { zip.addFile("pick-labels.json", fs.readFileSync(frames.labelsFile)); } catch {}
    const file = path.join(app.getPath("downloads"), `outpick-diag-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.zip`);
    zip.writeZip(file);
    shell.showItemInFolder(file);
    return { ok: true, file, frames: nFrames };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});
ipcMain.handle("draft:markMatch", (_e, matchId) => ({ ok: frames.markMatch(matchId) }));
ipcMain.handle("learn:run", () => { if (!ensureTemplates()) return { ok: false, error: "шаблоны не загружены" }; const r = frames.learn(); if (r.ok && (r.added || r.checked)) console.log(`[learn] проверено матчей: ${r.checked}, выучено портретов: ${r.added}, всего: ${r.total}`, r.notes.join("; ")); return r; });
ipcMain.handle("learn:info", () => frames.learnedInfo());
ipcMain.handle("draft:sources", async () => {
  try { const sources = await desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: { width: 0, height: 0 } }); return sources.map((s) => ({ id: s.id, name: s.name })); } catch (e) { return [{ id: "error", name: String(e?.message ?? e) }]; }
});

migrateUserData();
app.whenReady().then(() => {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "Outpick", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "quit" }] },
      { role: "editMenu" },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
  setupUpdater();
  createWindow();
  // доучиваем портреты по матчам, результаты которых подтянулись: при старте и каждые 5 минут, если разметка обновилась
  // (результаты сервер подтягивает сам по таймеру, см. web/src/lib/sync.ts)
  let labelsSeen = 0;
  const learnIfNew = (why) => {
    try {
      const m = fs.existsSync(frames.labelsFile) ? fs.statSync(frames.labelsFile).mtimeMs : 0;
      if (m === labelsSeen) return; labelsSeen = m;
      if (!ensureTemplates()) return;
      const r = frames.learn();
      if (r.ok && (r.added || r.checked)) console.log(`[learn] ${why}: проверено матчей ${r.checked}, выучено портретов ${r.added}, всего ${r.total}`, r.notes.join("; "));
    } catch (e) { console.warn("[learn]", e.message); }
  };
  setTimeout(() => learnIfNew("при старте"), 8000);
  setInterval(() => learnIfNew("по таймеру"), 5 * 60_000);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { flushLog(); serverProc?.kill(); });
