import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, USER_DIR } from "./paths";
import { accountFile, currentAccount } from "./accounts";
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

export function invalidateData() { general = null; generalStamp = ""; accounts.clear(); }

type General = {
  heroes: Hero[];
  heroById: Map<number, Hero>;
  matchups: Map<number, Matchup>;
  midMeta: Map<number, MidMeta>;
  positions: Map<number, HeroPositions>;
  aliases: AliasMap;
  roleMeta: Map<number, Map<number, RoleMetaEntry>>; // роль -> герой -> статистика за 4 недели
};
/** Данные аккаунта: пул героев и личные пары. Пустые у незнакомого аккаунта (общий режим). */
type AccountData = { accountId: number | null; pool: Map<number, PoolEntry>; pairs: PersonalPair[] };
export type Data = General & AccountData;

let general: General | null = null;
let generalStamp = "";
const accounts = new Map<number, { stamp: string; data: AccountData }>();

// кэш сбрасывается, когда любой файл в data/ меняется (после scripts/refresh-data.mjs перезапуск не нужен)
function stamp(): string {
  const dirs = [DATA_DIR, USER_DATA].filter((d) => fs.existsSync(d));
  return dirs.map((d) => fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => `${f}:${fs.statSync(path.join(d, f)).mtimeMs}`).join("|")).join("||");
}

function loadGeneral(): General {
  const st = stamp();
  if (general && st === generalStamp) return general;
  generalStamp = st;
  const heroes = readJson<Hero[]>("heroes.json");
  const matchups = readJson<Matchup[]>("matchups.json");
  const midMeta = readJson<MidMeta[]>("mid-meta.json");
  const positions = readJson<HeroPositions[]>("hero-positions.json");
  const aliases = readJson<AliasMap>("hero-aliases.json");
  let roleMetaRaw: Record<string, RoleMetaEntry[]> = {};
  try { roleMetaRaw = readJson<Record<string, RoleMetaEntry[]>>("role-meta.json"); } catch {
    // старые данные без role-meta: мид берём из mid-meta, остальные роли пустые
    roleMetaRaw = { 2: midMeta.map((m) => ({ heroId: m.heroId, games: m.midGames, wins: m.midWins, winrate: m.midWinrate, rate: m.midRate })) };
  }
  const roleMeta = new Map<number, Map<number, RoleMetaEntry>>();
  for (const r of [1, 2, 3, 4, 5]) roleMeta.set(r, new Map((roleMetaRaw[String(r)] ?? []).map((e) => [e.heroId, e])));
  general = {
    heroes,
    heroById: new Map(heroes.map((h) => [h.id, h])),
    matchups: new Map(matchups.map((m) => [m.heroId, m])),
    midMeta: new Map(midMeta.map((m) => [m.heroId, m])),
    positions: new Map(positions.map((p) => [p.heroId, p])),
    aliases,
    roleMeta,
  };
  return general;
}

const readFile = <T,>(f: string | null): T[] => { if (!f) return []; try { return JSON.parse(fs.readFileSync(f, "utf8")) as T[]; } catch { return []; } };

export function loadAccountData(accountId: number | null): AccountData {
  if (!accountId) return { accountId: null, pool: new Map(), pairs: [] };
  const files = [accountFile(accountId, "player-pool.json"), accountFile(accountId, "personal-pairs.json")];
  const st = files.map((f) => (f && fs.existsSync(f) ? `${f}:${fs.statSync(f).mtimeMs}` : "-")).join("|");
  const hit = accounts.get(accountId);
  if (hit && hit.stamp === st) return hit.data;
  const pool = readFile<PoolEntry>(files[0]);
  const data: AccountData = { accountId, pool: new Map(pool.map((p) => [p.heroId, p])), pairs: readFile<PersonalPair>(files[1]) };
  accounts.set(accountId, { stamp: st, data });
  return data;
}

/** Общие данные плюс данные аккаунта (по умолчанию того, который сейчас играет). */
export function loadData(accountId?: number | null): Data {
  const id = accountId === undefined ? currentAccount().id : accountId;
  return { ...loadGeneral(), ...loadAccountData(id) };
}
