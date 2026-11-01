import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Windows: где установлен Steam, по реестру (SteamPath у пользователя, InstallPath у машины). Там лежит libraryfolders.vdf
 *  со всеми библиотеками, в том числе на других дисках и в нестандартных папках. */
function steamRootsFromRegistry(): string[] {
  const out: string[] = [];
  const read = (key: string, value: string) => {
    try {
      const txt = execFileSync("reg", ["query", key, "/v", value], { encoding: "utf8", windowsHide: true, timeout: 3000 });
      const m = new RegExp(`${value}\\s+REG_SZ\\s+(.+)`, "i").exec(txt);
      if (m) out.push(m[1].trim().replace(/\//g, "\\"));
    } catch {}
  };
  read("HKCU\\Software\\Valve\\Steam", "SteamPath");
  read("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath");
  read("HKLM\\SOFTWARE\\Valve\\Steam", "InstallPath");
  return out;
}

let cached: { at: number; dirs: string[] } | null = null;
export function invalidateDotaDirs() { cached = null; }

/** Ищем папку Доты: Steam из реестра, стандартные пути, все диски, плюс библиотеки из libraryfolders.vdf.
 *  Результат держится 5 минут: поиск ходит в реестр и перебирает диски, а нужен он при каждой оценке драфта. */
export function findDotaDirs(): string[] {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.dirs;
  const dirs = findDotaDirsNow();
  cached = { at: Date.now(), dirs };
  return dirs;
}
function findDotaDirsNow(): string[] {
  const roots: string[] = [];
  // DOTA_DIR: папка game/dota вручную (разработка, нестандартная установка)
  if (process.env.DOTA_DIR && fs.existsSync(process.env.DOTA_DIR)) return [process.env.DOTA_DIR];
  if (process.platform === "win32") {
    roots.push(...steamRootsFromRegistry());
    roots.push("C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam");
    for (const d of "CDEFGHIJKLMNOPQRSTUVWXYZ") roots.push(`${d}:\\Steam`, `${d}:\\SteamLibrary`, `${d}:\\Games\\Steam`, `${d}:\\Games\\SteamLibrary`, `${d}:\\Program Files\\Steam`, `${d}:\\Program Files (x86)\\Steam`);
  } else if (process.platform === "darwin") {
    roots.push(path.join(os.homedir(), "Library/Application Support/Steam"));
  } else {
    roots.push(path.join(os.homedir(), ".steam/steam"), path.join(os.homedir(), ".local/share/Steam"));
  }
  const libs = new Set<string>(roots);
  for (const r of roots) {
    const vdf = path.join(r, "steamapps", "libraryfolders.vdf");
    try {
      const txt = fs.readFileSync(vdf, "utf8");
      for (const m of txt.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, "\\"));
    } catch {}
  }
  return [...libs].map((l) => path.join(l, "steamapps", "common", "dota 2 beta", "game", "dota")).filter((p) => fs.existsSync(p));
}

