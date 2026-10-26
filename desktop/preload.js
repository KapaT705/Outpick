// Мост между окном и Electron: только обновления и версия, ничего лишнего.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  version: () => ipcRenderer.invoke("app:version"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  recognizeDraft: () => ipcRenderer.invoke("draft:recognize"),
  captureSources: () => ipcRenderer.invoke("draft:sources"),
  debugCapture: () => ipcRenderer.invoke("draft:debug"),
  onUpdate: (cb) => { const h = (_e, data) => cb(data); ipcRenderer.on("update:event", h); return () => ipcRenderer.removeListener("update:event", h); },
});
