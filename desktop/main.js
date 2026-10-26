const { app, BrowserWindow, utilityProcess, shell, Menu, ipcMain, desktopCapturer, screen } = require("electron");
const recog = require("./recognize.js");
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
  const serverJs = path.join(appDir, "server.js");
  if (!fs.existsSync(serverJs)) throw new Error(`Не найден ${serverJs}. Запусти npm run prepare-app.`);
  serverProc = utilityProcess.fork(serverJs, [], {
    cwd: appDir,
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production", DATA_DIR: dataDir, USER_DIR: userDir },
    stdio: "pipe",
  });
  serverProc.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`));
  serverProc.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`));
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
  try { recog.loadTemplates(path.join(dataDir, "heroes.json"), path.join(assets, "heroes"), path.join(assets, "empty-slot.json")); templatesLoaded = true; } catch (e) { console.error("[recog] templates:", e.message); }
  return templatesLoaded;
}
async function captureDotaFrame() {
  const primary = screen.getPrimaryDisplay();
  const size = { width: Math.round(primary.size.width * primary.scaleFactor), height: Math.round(primary.size.height * primary.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: size, fetchWindowIcons: false });
  const win = sources.find((s) => /dota\s*2/i.test(s.name));
  const src = win ?? sources.find((s) => s.id.startsWith("screen:")) ?? sources[0];
  if (!src) throw new Error("нет источников захвата");
  const img = src.thumbnail;
  const sz = img.getSize();
  if (sz.width === 0 || sz.height === 0) throw new Error("пустой кадр");
  return { name: src.name, w: sz.width, h: sz.height, data: img.toBitmap(), bgra: true };
}
ipcMain.handle("draft:recognize", async () => {
  if (!ensureTemplates()) return { ok: false, error: "шаблоны героев не загружены" };
  try {
    const frame = await captureDotaFrame();
    const t = Date.now();
    const slots = recog.recognize(frame);
    return { ok: true, source: frame.name, w: frame.w, h: frame.h, ms: Date.now() - t, slots: slots.map((s) => ({ team: s.team, idx: s.idx, heroId: s.heroId, name: s.name ?? null, score: s.score ?? null, margin: s.margin ?? null, empty: !!s.empty })) };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});
ipcMain.handle("draft:debug", async () => {
  if (!ensureTemplates()) return { ok: false, error: "шаблоны героев не загружены" };
  try {
    const primary = screen.getPrimaryDisplay();
    const size = { width: Math.round(primary.size.width * primary.scaleFactor), height: Math.round(primary.size.height * primary.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: size, fetchWindowIcons: false });
    const win = sources.find((s) => /dota\s*2/i.test(s.name));
    const src = win ?? sources.find((s) => s.id.startsWith("screen:")) ?? sources[0];
    if (!src) throw new Error("нет источников захвата");
    const img = src.thumbnail; const sz = img.getSize();
    const frame = { w: sz.width, h: sz.height, data: img.toBitmap(), bgra: true };
    const slots = recog.recognize(frame);
    const stripH = Math.min(sz.height, recog.stripHeight(sz.height));
    const strip = img.crop({ x: 0, y: 0, width: sz.width, height: stripH });
    const scale = Math.min(1, 1600 / sz.width);
    const small = scale < 1 ? strip.resize({ width: Math.round(sz.width * scale) }) : strip;
    return { ok: true, source: src.name, w: sz.width, h: sz.height, stripH, scale, image: small.toDataURL(), slots, sources: sources.map((s) => s.name).slice(0, 12) };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});
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
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { serverProc?.kill(); });
