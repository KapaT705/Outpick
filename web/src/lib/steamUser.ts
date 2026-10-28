// Аккаунт, под которым сейчас запущен Steam: Дота сообщает Steam ID только внутри матча, а в меню его нет.
// Windows: реестр HKCU\Software\Valve\Steam\ActiveProcess\ActiveUser (32-битный id, 0 если не вошёл).
// macOS/Linux: loginusers.vdf, запись с MostRecent 1. Результат кэшируется на 5 секунд.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { toSteam32 } from "./config";

let cached: { at: number; id: number | null } = { at: 0, id: null };

function fromRegistry(): number | null {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Valve\\Steam\\ActiveProcess", "/v", "ActiveUser"], { encoding: "utf8", windowsHide: true, timeout: 3000 });
    const m = /ActiveUser\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)/i.exec(out);
    if (!m) return null;
    const n = Number(m[1]);
    return n > 0 ? n : null;
  } catch { return null; }
}

function fromLoginUsers(): number | null {
  const candidates = process.platform === "darwin"
    ? [path.join(os.homedir(), "Library", "Application Support", "Steam", "config", "loginusers.vdf")]
    : [path.join(os.homedir(), ".steam", "steam", "config", "loginusers.vdf"), path.join(os.homedir(), ".local", "share", "Steam", "config", "loginusers.vdf")];
  for (const f of candidates) {
    let txt: string;
    try { txt = fs.readFileSync(f, "utf8"); } catch { continue; }
    // блоки вида "7656119..." { ... "MostRecent" "1" ... }
    const re = /"(\d{17})"\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt))) if (/"MostRecent"\s*"1"/.test(m[2])) return toSteam32(m[1]);
  }
  return null;
}

/** 32-битный Steam ID аккаунта, под которым запущен Steam, или null. */
export function steamActiveUser(): number | null {
  const now = Date.now();
  if (now - cached.at < 5000) return cached.id;
  const id = process.platform === "win32" ? fromRegistry() : fromLoginUsers();
  cached = { at: now, id };
  return id;
}
