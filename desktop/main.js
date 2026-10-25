const { app, BrowserWindow, utilityProcess, shell, Menu, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");

const isDev = !app.isPackaged;
let serverProc = null;
let win = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
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
  const port = await freePort();
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
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("http://127.0.0.1")) { e.preventDefault(); shell.openExternal(url); } });
  try {
    const url = await startServer();
    await win.loadURL(url);
  } catch (err) {
    await win.loadURL(`data:text/html;charset=utf-8,<body style="font-family:sans-serif;background:#0f1115;color:#eee;padding:24px"><h2>Не удалось запустить сервер</h2><pre>${String(err.message)}</pre></body>`);
  }
}

// --- обновления через GitHub Releases ---
let updateState = { checking: false, available: null, downloaded: false };
function setupUpdater() {
  if (isDev) return;
  autoUpdater.autoDownload = false;
  autoUpdater.on("update-available", async (info) => {
    updateState.available = info.version;
    const { response } = await dialog.showMessageBox(win, { type: "info", title: "Обновление", message: `Доступна версия ${info.version} (у тебя ${app.getVersion()}).`, detail: "Скачать сейчас? Установится после перезапуска.", buttons: ["Скачать", "Позже"], defaultId: 0, cancelId: 1 });
    if (response === 0) autoUpdater.downloadUpdate();
  });
  autoUpdater.on("update-not-available", () => { if (updateState.checking) dialog.showMessageBox(win, { type: "info", message: `У тебя последняя версия (${app.getVersion()}).` }); updateState.checking = false; });
  autoUpdater.on("update-downloaded", async () => {
    updateState.downloaded = true;
    const { response } = await dialog.showMessageBox(win, { type: "info", title: "Обновление скачано", message: "Перезапустить и установить сейчас?", buttons: ["Перезапустить", "Позже"], defaultId: 0, cancelId: 1 });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on("error", (e) => { if (updateState.checking) dialog.showMessageBox(win, { type: "warning", message: "Не удалось проверить обновления", detail: String(e?.message ?? e) }); updateState.checking = false; });
  autoUpdater.checkForUpdates().catch(() => {});
}
function checkUpdatesManually() {
  if (isDev) { dialog.showMessageBox(win, { type: "info", message: "В режиме разработки обновления не проверяются." }); return; }
  updateState.checking = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Dota Mid Helper", submenu: [
      { label: `Проверить обновления (v${app.getVersion()})`, click: checkUpdatesManually },
      { type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "quit" }] },
    { role: "editMenu" },
  ]));
  createWindow().then(setupUpdater);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { serverProc?.kill(); });
