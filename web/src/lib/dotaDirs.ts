import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Ищем папку Доты: стандартные пути Steam плюс библиотеки из libraryfolders.vdf. */
export function findDotaDirs(): string[] {
  const roots: string[] = [];
  // DOTA_DIR: папка game/dota вручную (разработка, нестандартная установка)
  if (process.env.DOTA_DIR && fs.existsSync(process.env.DOTA_DIR)) return [process.env.DOTA_DIR];
  if (process.platform === "win32") {
    roots.push("C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam");
    for (const d of ["D", "E", "F", "G"]) roots.push(`${d}:\\Steam`, `${d}:\\SteamLibrary`, `${d}:\\Games\\Steam`);
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

