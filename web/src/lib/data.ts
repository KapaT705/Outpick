import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, USER_DIR } from "./paths";
import type { Hero, Matchup, MidMeta, PoolEntry, PersonalPair, HeroPositions, RoleMetaEntry } from "./types";
import type { AliasMap } from "./aliases";

const USER_DATA = path.join(USER_DIR, "data");

/** Файл из обновлённых данных пользователя (USER_DIR/data), иначе из упакованных (DATA_DIR). */
function resolveFile(name: string): string {
  const u = path.join(USER_DATA, name);
  return fs.existsSync(u) ? u : path.join(DATA_DIR, name);
}

function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(resolveFile(name), "utf8")) as T;
}

export function invalidateData() { cache = null; cacheStamp = ""; }

type Cache = {
  heroes: Hero[];
  heroById: Map<number, Hero>;
  matchups: Map<number, Matchup>;
  midMeta: Map<number, MidMeta>;
  pool: Map<number, PoolEntry>;
  pairs: PersonalPair[];
  positions: Map<number, HeroPositions>;
  aliases: AliasMap;
  roleMeta: Map<number, Map<number, RoleMetaEntry>>; // роль -> герой -> статистика за 4 недели
};

let cache: Cache | null = null;
let cacheStamp = "";

// кэш сбрасывается, когда любой файл в data/ меняется (после scripts/refresh-data.mjs перезапуск не нужен)
function stamp(): string {
  const dirs = [DATA_DIR, USER_DATA].filter((d) => fs.existsSync(d));
  return dirs.map((d) => fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => `${f}:${fs.statSync(path.join(d, f)).mtimeMs}`).join("|")).join("||");
}

export function loadData(): Cache {
  const st = stamp();
  if (cache && st === cacheStamp) return cache;
  cacheStamp = st;
  const heroes = readJson<Hero[]>("heroes.json");
  const matchups = readJson<Matchup[]>("matchups.json");
  const midMeta = readJson<MidMeta[]>("mid-meta.json");
  const pool = readJson<PoolEntry[]>("player-pool.json");
  const pairs = readJson<PersonalPair[]>("personal-pairs.json");
  const positions = readJson<HeroPositions[]>("hero-positions.json");
  const aliases = readJson<AliasMap>("hero-aliases.json");
  let roleMetaRaw: Record<string, RoleMetaEntry[]> = {};
  try { roleMetaRaw = readJson<Record<string, RoleMetaEntry[]>>("role-meta.json"); } catch {
    // старые данные без role-meta: мид берём из mid-meta, остальные роли пустые
    roleMetaRaw = { 2: midMeta.map((m) => ({ heroId: m.heroId, games: m.midGames, wins: m.midWins, winrate: m.midWinrate, rate: m.midRate })) };
  }
  const roleMeta = new Map<number, Map<number, RoleMetaEntry>>();
  for (const r of [1, 2, 3, 4, 5]) roleMeta.set(r, new Map((roleMetaRaw[String(r)] ?? []).map((e) => [e.heroId, e])));
  cache = {
    heroes,
    heroById: new Map(heroes.map((h) => [h.id, h])),
    matchups: new Map(matchups.map((m) => [m.heroId, m])),
    midMeta: new Map(midMeta.map((m) => [m.heroId, m])),
    pool: new Map(pool.map((p) => [p.heroId, p])),
    pairs,
    positions: new Map(positions.map((p) => [p.heroId, p])),
    aliases,
    roleMeta,
  };
  return cache;
}
