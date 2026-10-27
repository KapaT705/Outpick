const { app, BrowserWindow, utilityProcess, shell, Menu, ipcMain, desktopCapturer, screen } = require("electron");
const recog = require("./recognize.js");
const frames = require("./frames.js");
const os = require("node:os");
const AdmZip = require("adm-zip");

// --- журнал главного процесса (последние 800 строк) для диагностики ---
const LOG = [];
const logLine = (level, args) => { const line = `${new Date().toISOString()} [${level}] ${args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ")}`; LOG.push(line); if (LOG.length > 800) LOG.shift(); };
for (const lvl of ["log", "warn", "error"]) { const orig = console[lvl].bind(console); console[lvl] = (...a) => { logLine(lvl, a); orig(...a); }; }
process.on("uncaughtException", (e) => console.error("uncaught:", e?.stack ?? String(e)));
let serverPort = null;
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");

const isDev = !app.isPackaged;
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
    title: "Dota Mid Helper",
    autoHideMenuBar: true, // на Windows меню скрыто, Alt показывает
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("http://127.0.0.1")) { e.preventDefault(); shell.openExternal(url); } });
  try {
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
function configureFeed() {
  const token = readUserConfig().githubToken;
  if (!token) return false;
  autoUpdater.setFeedURL({ provider: "github", owner: "KapaT705", repo: "dota-mid-helper", private: true, token });
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
  ipcMain.handle("update:check", async () => {
    if (isDev) return { ok: false, reason: "dev" };
    if (!configureFeed()) return { ok: false, reason: "no-token" };
    try { await autoUpdater.checkForUpdates(); return { ok: true }; } catch (e) { return { ok: false, reason: String(e?.message ?? e) }; }
  });
  ipcMain.handle("update:download", async () => { try { await autoUpdater.downloadUpdate(); return { ok: true }; } catch (e) { return { ok: false, reason: String(e?.message ?? e) }; } });
  ipcMain.handle("update:install", () => { autoUpdater.quitAndInstall(); return { ok: true }; });
  // тихая проверка при старте, если есть токен
  if (!isDev && configureFeed()) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
}

// --- распознавание экрана пиков ---
let templatesLoaded = false;
function ensureTemplates() {
  if (templatesLoaded) return true;
  const resources = isDev ? __dirname : process.resourcesPath;
  const dataDir = isDev ? path.join(__dirname, "..", "data") : path.join(resources, "data");
  const assets = isDev ? path.join(__dirname, "assets") : path.join(resources, "assets");
  try { recog.loadTemplates(path.join(dataDir, "heroes.json"), path.join(assets, "heroes"), path.join(assets, "empty-slot.json")); templatesLoaded = true; const n = frames.loadLearned(); if (n) console.log(`[recog] выученных портретов: ${n}`); } catch (e) { console.error("[recog] templates:", e.message); }
  return templatesLoaded;
}
function frameIsBlack(bitmap, w, h) {
  // средняя яркость по сетке 32x32 точек верхней трети экрана
  let sum = 0, n = 0;
  for (let gy = 0; gy < 32; gy++) for (let gx = 0; gx < 32; gx++) { const x = Math.floor((gx + 0.5) * w / 32), y = Math.floor((gy + 0.5) * (h / 3) / 32); const i = (y * w + x) * 4; sum += bitmap[i] + bitmap[i + 1] + bitmap[i + 2]; n += 3; }
  return sum / n < 6;
}
async function captureDotaFrame() {
  const primary = screen.getPrimaryDisplay();
  const size = { width: Math.round(primary.size.width * primary.scaleFactor), height: Math.round(primary.size.height * primary.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: size, fetchWindowIcons: false });
  // сначала весь основной экран (надёжнее для полноэкранной игры), потом окно Доты, если экран чёрный
  const ordered = [sources.find((s) => s.id.startsWith("screen:")), sources.find((s) => /dota\s*2/i.test(s.name)), ...sources].filter(Boolean);
  let lastErr = "нет источников захвата";
  for (const src of ordered) {
    const img = src.thumbnail; const sz = img.getSize();
    if (sz.width === 0 || sz.height === 0) { lastErr = "пустой кадр"; continue; }
    const data = img.toBitmap();
    if (frameIsBlack(data, sz.width, sz.height)) { lastErr = `чёрный кадр из «${src.name}»`; continue; }
    return { name: src.name, w: sz.width, h: sz.height, data, bgra: true, image: img };
  }
  throw new Error(lastErr);
}
ipcMain.handle("draft:recognize", async (_e, ctx) => {
  if (!ensureTemplates()) return { ok: false, error: "шаблоны героев не загружены" };
  try {
    const frame = await captureDotaFrame();
    const t = Date.now();
    const slots = recog.recognize(frame);
    const onPickScreen = slots.filter((x) => x.empty || x.heroId).length >= 4;
    if (onPickScreen) frames.remember(frame, slots, ctx && typeof ctx === "object" ? ctx : {});
    return { ok: true, source: frame.name, w: frame.w, h: frame.h, ms: Date.now() - t, onPickScreen, slots: slots.map((s) => ({ team: s.team, idx: s.idx, heroId: s.heroId, name: s.name ?? null, score: s.score ?? null, margin: s.margin ?? null, empty: !!s.empty, learned: !!s.learned })) };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});
ipcMain.handle("draft:debug", async () => {
  if (!ensureTemplates()) return { ok: false, error: "шаблоны героев не загружены" };
  try {
    const frame = await captureDotaFrame();
    const slots = recog.recognize(frame);
    const onPickScreen = slots.filter((x) => x.empty || x.heroId).length >= 4;
    if (onPickScreen) frames.remember(frame, slots, {});
    const stripH = Math.min(frame.h, recog.stripHeight(frame.h));
    const strip = frame.image.crop({ x: 0, y: 0, width: frame.w, height: stripH });
    const scale = Math.min(1, 1600 / frame.w);
    const small = scale < 1 ? strip.resize({ width: Math.round(frame.w * scale) }) : strip;
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 1, height: 1 } }).catch(() => []);
    return { ok: true, source: frame.name, w: frame.w, h: frame.h, stripH, scale, image: small.toDataURL(), slots, onPickScreen, sources: sources.map((s) => s.name).slice(0, 12) };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});
async function serverJson(pathname) {
  try { const r = await fetch(`http://127.0.0.1:${serverPort}${pathname}`); return await r.json(); } catch (e) { return { error: String(e?.message ?? e) }; }
}
ipcMain.handle("diag:save", async () => {
  try {
    const zip = new AdmZip();
    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, size: d.size, scaleFactor: d.scaleFactor, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id }));
    const settings = await serverJson("/api/settings");
    const info = { app: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch, os: `${os.type()} ${os.release()}`, cpu: os.cpus()?.[0]?.model, memGb: Math.round(os.totalmem() / 1e9), displays, serverPort, savedAt: new Date().toISOString(), settings };
    zip.addFile("info.json", Buffer.from(JSON.stringify(info, null, 2)));
    zip.addFile("main-log.txt", Buffer.from(LOG.join("\n")));
    zip.addFile("gsi-raw.json", Buffer.from(JSON.stringify(await serverJson("/api/gsi/raw"), null, 1)));
    zip.addFile("gsi-config.json", Buffer.from(JSON.stringify(await serverJson("/api/gsi/install"), null, 1)));
    zip.addFile("draft-log.json", Buffer.from(JSON.stringify(await serverJson("/api/log"), null, 1)));
    zip.addFile("refresh.json", Buffer.from(JSON.stringify(await serverJson("/api/refresh"), null, 1)));
    try { const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 1, height: 1 } }); zip.addFile("capture-sources.json", Buffer.from(JSON.stringify(sources.map((s) => ({ id: s.id, name: s.name })), null, 1))); } catch (e) { zip.addFile("capture-sources.json", Buffer.from(JSON.stringify({ error: String(e?.message ?? e) }))); }
    // свежий кадр с распознаванием
    try {
      const frame = await captureDotaFrame();
      const slots = ensureTemplates() ? recog.recognize(frame) : [];
      zip.addFile("frame-now.png", frame.image.toPNG());
      zip.addFile("frame-now.json", Buffer.from(JSON.stringify({ source: frame.name, w: frame.w, h: frame.h, slots }, null, 1)));
    } catch (e) { zip.addFile("frame-now.json", Buffer.from(JSON.stringify({ error: String(e?.message ?? e) }))); }
    // кадры со стадии пиков двух последних драфтов (хранятся на диске, переживают перезапуск), разметка и выученные портреты
    let nFrames = 0;
    for (const f of frames.diagFiles(2)) { try { zip.addFile(f.zipPath, fs.readFileSync(f.file)); nFrames++; } catch {} }
    zip.addFile("learned.json", Buffer.from(JSON.stringify(frames.learnedInfo(), null, 1)));
    try { zip.addFile("pick-labels.json", fs.readFileSync(frames.labelsFile)); } catch {}
    const file = path.join(app.getPath("downloads"), `dota-mid-helper-diag-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.zip`);
    zip.writeZip(file);
    shell.showItemInFolder(file);
    return { ok: true, file, frames: nFrames };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});
ipcMain.handle("draft:markMatch", (_e, matchId) => ({ ok: frames.markMatch(matchId) }));
ipcMain.handle("learn:run", () => { if (!ensureTemplates()) return { ok: false, error: "шаблоны не загружены" }; const r = frames.learn(); if (r.ok && (r.added || r.checked)) console.log(`[learn] проверено матчей: ${r.checked}, выучено портретов: ${r.added}, всего: ${r.total}`, r.notes.join("; ")); return r; });
ipcMain.handle("learn:info", () => frames.learnedInfo());
ipcMain.handle("draft:sources", async () => {
  try { const sources = await desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: { width: 1, height: 1 } }); return sources.map((s) => ({ id: s.id, name: s.name })); } catch (e) { return [{ id: "error", name: String(e?.message ?? e) }]; }
});

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "Dota Mid Helper", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "quit" }] },
      { role: "editMenu" },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
  setupUpdater();
  createWindow();
  // доучиваем портреты по матчам, результаты которых подтянулись, пока программа была закрыта
  setTimeout(() => { try { if (ensureTemplates()) { const r = frames.learn(); if (r.ok && r.added) console.log(`[learn] при старте выучено портретов: ${r.added}`, r.notes.join("; ")); } } catch (e) { console.warn("[learn]", e.message); } }, 8000);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { serverProc?.kill(); });
