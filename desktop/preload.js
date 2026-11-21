// Мост между окном и Electron: обновления, версия, чтение экрана пиков, диагностика.
const { contextBridge, ipcRenderer } = require("electron");

// --- захват экрана видеопотоком (getUserMedia с источником «экран») ---
// Раньше каждый кадр брался через desktopCapturer.getSources: на Windows такие снимки не освобождались даже после
// принудительной сборки мусора (до 6 ГБ за два матча). Видеопоток держит один буфер и переиспользует его.
// Поток живёт только пока его просят (гаснет через 10 с без запросов), из кадра берём лишь верхнюю полосу.
const U = 1125, ROLE_ROW_BOTTOM = 140; // низ строки ролей под слотами, как recognize.stripHeight
const stripHeight = (H) => Math.round((ROLE_ROW_BOTTOM / U) * H + 12);
// wantId: экран, на котором в последний раз был виден экран пиков (по id, а не по номеру: порядок списка меняется);
// missRuns: кадров подряд без экрана пиков на текущем экране (при нескольких экранах после MISS_SWITCH пробуем следующий)
const cap = { stream: null, video: null, source: null, sources: [], idx: 0, wantId: null, lastUse: 0, blackRuns: 0, missRuns: 0, starting: null, canvas: null, small: null, full: null };
const MISS_SWITCH = 8;
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: нет ответа ${ms / 1000} с`)), ms))]);

function stopStream() {
  try { cap.stream?.getTracks().forEach((t) => t.stop()); } catch {}
  cap.stream = null;
  if (cap.video) { try { cap.video.pause(); cap.video.srcObject = null; } catch {} cap.video = null; }
}
setInterval(() => { if (cap.stream && Date.now() - cap.lastUse > 10_000) stopStream(); }, 2000);

async function ensureStream() {
  if (cap.stream && cap.stream.active && cap.video && cap.video.videoWidth > 0) return;
  if (cap.starting) return cap.starting;
  cap.starting = (async () => {
    stopStream();
    const list = await ipcRenderer.invoke("capture:sources");
    if (!Array.isArray(list) || list.length === 0) throw new Error("нет горизонтальных экранов для захвата");
    cap.sources = list;
    const want = cap.wantId ? list.findIndex((x) => x.id === cap.wantId) : -1;
    if (want >= 0) cap.idx = want; else if (cap.idx >= list.length) cap.idx = 0;
    const src = list[cap.idx];
    // захват может зависнуть: ждём ограниченно, а поток, пришедший после таймаута или при ошибке, сразу гасим
    // (иначе каждый следующий шаг открывал ещё один поток, и память росла, как до исправления 0.7.1)
    const req = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: src.id, minWidth: src.w, maxWidth: src.w, minHeight: src.h, maxHeight: src.h, maxFrameRate: 4 } },
    });
    let stream;
    try { stream = await withTimeout(req, 8000, "захват экрана"); }
    catch (e) { req.then((st) => st.getTracks().forEach((t) => t.stop())).catch(() => {}); throw e; }
    const video = document.createElement("video");
    try {
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await withTimeout(video.play(), 6000, "видеопоток экрана");
      await new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => { if (video.videoWidth > 0 && video.videoHeight > 0) resolve(); else if (Date.now() - t0 > 6000) reject(new Error("поток экрана не дал кадр")); else setTimeout(tick, 50); };
        tick();
      });
    } catch (e) {
      try { stream.getTracks().forEach((t) => t.stop()); video.pause(); video.srcObject = null; } catch {}
      throw e;
    }
    cap.stream = stream; cap.video = video; cap.source = src;
  })().finally(() => { cap.starting = null; });
  return cap.starting;
}

function canvasFor(key, w, h) {
  let c = cap[key];
  if (!c) { c = document.createElement("canvas"); cap[key] = c; }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
const toBytes = (blob) => blob.arrayBuffer().then((b) => new Uint8Array(b));

/** Кадр с экрана: верхняя полоса RGBA (для распознавания), при желании уменьшенный JPEG и полный PNG. */
async function grab({ jpeg = true, png = false } = {}) {
  await ensureStream();
  cap.lastUse = Date.now();
  const v = cap.video, W = v.videoWidth, H = v.videoHeight;
  const stripH = Math.min(H, stripHeight(H));
  const c = canvasFor("canvas", W, stripH);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(v, 0, 0, W, stripH, 0, 0, W, stripH);
  const strip = new Uint8Array(g.getImageData(0, 0, W, stripH).data.buffer);
  const out = { id: cap.source.id, name: cap.source.name, w: W, h: H, stripH, strip, jpeg: null, png: null };
  if (jpeg) {
    const sw = Math.min(1280, W), sh = Math.round((H * sw) / W);
    const c2 = canvasFor("small", sw, sh); c2.getContext("2d").drawImage(v, 0, 0, sw, sh);
    const blob = await new Promise((r) => c2.toBlob(r, "image/jpeg", 0.7));
    if (blob) out.jpeg = await toBytes(blob);
  }
  if (png) {
    const c3 = canvasFor("full", W, H); c3.getContext("2d").drawImage(v, 0, 0, W, H);
    const blob = await new Promise((r) => c3.toBlob(r, "image/png"));
    if (blob) out.png = await toBytes(blob);
  }
  return out;
}

// Выбор экрана при нескольких мониторах: экран пиков найден - запоминаем этот экран; чёрный кадр 3 раза подряд или
// MISS_SWITCH кадров без экрана пиков - пробуем следующий. Раньше переключение было только по чёрным кадрам: Дота на
// втором мониторе при рабочем столе на основном не находилась никогда.
function noteFrame(res) {
  const next = () => { stopStream(); cap.wantId = null; cap.idx = (cap.idx + 1) % cap.sources.length; cap.blackRuns = 0; cap.missRuns = 0; };
  if (!res || !res.ok) return;
  if (res.onPickScreen) { cap.wantId = cap.source?.id ?? null; cap.blackRuns = 0; cap.missRuns = 0; return; }
  if (res.black) { cap.blackRuns++; if (cap.blackRuns >= 3 && cap.sources.length > 1) next(); return; }
  cap.blackRuns = 0;
  if (cap.sources.length > 1 && ++cap.missRuns >= MISS_SWITCH) next();
}

async function recognizeDraft(ctx) {
  const gate = await ipcRenderer.invoke("capture:gate");
  if (!gate.ok) return { ok: false, error: gate.error ?? "шаблоны героев не загружены" };
  if (!gate.dota) { stopStream(); return { ok: false, idle: true, error: "Дота не запущена" }; }
  let frame;
  try { frame = await grab({ jpeg: true }); } catch (e) { return { ok: false, error: `захват экрана: ${e?.message ?? e}` }; }
  const res = await ipcRenderer.invoke("draft:recognizeFrame", ctx ?? {}, frame);
  noteFrame(res);
  return res;
}

contextBridge.exposeInMainWorld("desktop", {
  version: () => ipcRenderer.invoke("app:version"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  recognizeDraft,
  markMatch: (matchId) => ipcRenderer.invoke("draft:markMatch", matchId),
  learn: () => ipcRenderer.invoke("learn:run"),
  learnedInfo: () => ipcRenderer.invoke("learn:info"),
  captureSources: () => ipcRenderer.invoke("draft:sources"),
  debugCapture: async () => {
    let frame = null;
    try { frame = await grab({ jpeg: false }); } catch (e) { return { ok: false, error: `захват экрана: ${e?.message ?? e}` }; }
    return ipcRenderer.invoke("draft:debug", frame);
  },
  saveDiagnostics: async () => {
    let frame = null;
    try { frame = await grab({ jpeg: false, png: true }); } catch {}
    return ipcRenderer.invoke("diag:save", frame);
  },
  devInfo: () => ipcRenderer.invoke("dev:info"),
  rebuildFromSource: () => ipcRenderer.invoke("dev:rebuild"),
  onUpdate: (cb) => { const h = (_e, data) => cb(data); ipcRenderer.on("update:event", h); return () => ipcRenderer.removeListener("update:event", h); },
  // оверлей поверх Доты: пикер отдаёт данные, главный процесс решает, когда показать, окно оверлея слушает
  overlayPush: (data) => ipcRenderer.send("overlay:push", data),
  overlayShow: () => ipcRenderer.invoke("overlay:show"),
  overlayHide: () => ipcRenderer.invoke("overlay:hide"),
  overlayApply: () => ipcRenderer.invoke("overlay:apply"),
  onOverlayData: (cb) => { const h = (_e, data) => cb(data); ipcRenderer.on("overlay:data", h); return () => ipcRenderer.removeListener("overlay:data", h); },
});
