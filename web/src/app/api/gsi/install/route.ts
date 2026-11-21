import { NextResponse } from "next/server";
import { findDotaDirs } from "@/lib/dotaDirs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GSI_TOKEN } from "@/lib/gsi";
import { readConfig, writeConfig } from "@/lib/config";

/** Папка game\dota по пути, который ввёл человек: сама папка, на уровень или два выше (dota 2 beta, game) или папка
 *  библиотеки Steam. Признак настоящей папки: gameinfo.gi или pak01_dir.vpk. Иначе null (ничего не создаём). */
function resolveDotaDir(input: string): string | null {
  const p = input.trim().replace(/^"+|"+$/g, "");
  if (!p) return null;
  const cands = [p, path.join(p, "dota"), path.join(p, "game", "dota"), path.join(p, "steamapps", "common", "dota 2 beta", "game", "dota")];
  return cands.find((d) => fs.existsSync(path.join(d, "gameinfo.gi")) || fs.existsSync(path.join(d, "pak01_dir.vpk"))) ?? null;
}
/** Найденные папки Доты плюс указанная вручную (если она на месте). */
function allDotaDirs(): string[] {
  const manual = readConfig().dotaDir;
  const dirs = findDotaDirs();
  if (manual && fs.existsSync(manual) && !dirs.some((d) => d.toLowerCase() === manual.toLowerCase())) dirs.push(manual);
  return dirs;
}

export const dynamic = "force-dynamic";

export function cfgText(origin: string) {
  return `"Outpick"
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

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const dirs = allDotaDirs();
  let installed = false, rewritten = false, installedUri: string | null = null;
  for (const d of dirs) {
    const file = path.join(d, "cfg", "gamestate_integration", "gamestate_integration_midhelper.cfg");
    if (!fs.existsSync(file)) continue;
    installed = true;
    try {
      const txt = fs.readFileSync(file, "utf8");
      installedUri = txt.match(/"uri"\s+"([^"]+)"/)?.[1] ?? null;
      // конфиг со старым портом: переписываем на текущий адрес, Доту нужно перезапустить
      if (installedUri && installedUri !== `${origin}/api/gsi`) { fs.writeFileSync(file, cfgText(origin)); rewritten = true; installedUri = `${origin}/api/gsi`; }
    } catch {}
  }
  return NextResponse.json({ cfg: cfgText(origin), dotaDirs: dirs, fileName: "gamestate_integration_midhelper.cfg", installed, installedUri, rewritten, expectedUri: `${origin}/api/gsi` });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { dotaDir?: string };
  const origin = new URL(req.url).origin;
  let dirs: string[];
  if (typeof body.dotaDir === "string" && body.dotaDir.trim()) {
    const manual = resolveDotaDir(body.dotaDir);
    if (!manual) return NextResponse.json({ ok: false, error: "По этому пути Доты нет: нужна папка ...\\steamapps\\common\\dota 2 beta\\game\\dota" }, { status: 400 });
    const cfg = readConfig(); cfg.dotaDir = manual; writeConfig(cfg); // запоминаем: проверка «конфиг на месте» будет смотреть и сюда
    dirs = [manual];
  } else dirs = allDotaDirs();
  if (dirs.length === 0) return NextResponse.json({ ok: false, error: "Папка Доты не найдена. Укажи путь к папке dota 2 beta\\game\\dota вручную." }, { status: 404 });
  const dir = dirs[0];
  const target = path.join(dir, "cfg", "gamestate_integration");
  try {
    fs.mkdirSync(target, { recursive: true });
    const file = path.join(target, "gamestate_integration_midhelper.cfg");
    fs.writeFileSync(file, cfgText(origin));
    return NextResponse.json({ ok: true, file });
  } catch (e) {
    const m = String((e as Error).message);
    const text = /EACCES|EPERM/i.test(m) ? "нет доступа к папке Доты: проверь путь или запусти программу от администратора" : /ENOENT|ENOTDIR/i.test(m) ? "папка Доты не найдена по этому пути" : `не удалось записать конфиг: ${m}`;
    return NextResponse.json({ ok: false, error: text }, { status: 500 });
  }
}
