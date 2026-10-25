import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GSI_TOKEN } from "@/lib/gsi";

export const dynamic = "force-dynamic";

export function cfgText(origin: string) {
  return `"Dota Mid Helper"
{
  "uri"       "${origin}/api/gsi"
  "timeout"   "5.0"
  "buffer"    "0.1"
  "throttle"  "0.1"
  "heartbeat" "10.0"
  "data"
  {
    "provider" "1"
    "map"      "1"
    "player"   "1"
    "hero"     "1"
    "draft"    "1"
  }
  "auth"
  {
    "token" "${GSI_TOKEN}"
  }
}
`;
}

/** Ищем папку Доты: стандартные пути Steam плюс библиотеки из libraryfolders.vdf. */
function findDotaDirs(): string[] {
  const roots: string[] = [];
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

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const dirs = findDotaDirs();
  const installed = dirs.some((d) => fs.existsSync(path.join(d, "cfg", "gamestate_integration", "gamestate_integration_midhelper.cfg")));
  return NextResponse.json({ cfg: cfgText(origin), dotaDirs: dirs, fileName: "gamestate_integration_midhelper.cfg", installed });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { dotaDir?: string };
  const origin = new URL(req.url).origin;
  const dirs = body.dotaDir ? [body.dotaDir] : findDotaDirs();
  if (dirs.length === 0) return NextResponse.json({ ok: false, error: "Папка Доты не найдена. Укажи путь к папке dota 2 beta\\game\\dota вручную." }, { status: 404 });
  const dir = dirs[0];
  const target = path.join(dir, "cfg", "gamestate_integration");
  try {
    fs.mkdirSync(target, { recursive: true });
    const file = path.join(target, "gamestate_integration_midhelper.cfg");
    fs.writeFileSync(file, cfgText(origin));
    return NextResponse.json({ ok: true, file });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message) }, { status: 500 });
  }
}
