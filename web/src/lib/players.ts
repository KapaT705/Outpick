// Игроки текущего матча: Steam ID из server_log.txt Доты и их статистика из Stratz.
//
// При подключении к матчу Дота дописывает в game/dota/server_log.txt строку вида
//   10/28/2026 - 19:39:05: =[A:1:…] (Lobby 29812345678901234 DOTA_GAMEMODE_AP 0:[U:1:401776935] 1:[U:1:…] … 9:[U:1:…])
// (формат по npm-пакету dota2-server-log; Valve в 2020 собиралась перестать писать его, проверяется по диагностике).
// Порядок 0–4 считаем Светом, 5–9 Тьмой, внутри команды порядок как в верхней панели (проверяется сверкой с матчем).
// По Steam ID у Stratz берём за 30 дней ранговых игр: позиции (роли), любимых героев и винрейт по героям.
// Закрытые профили (isAnonymous) дают пусто, как и у Overplus.
import fs from "node:fs";
import path from "node:path";
import { findDotaDirs } from "./dotaDirs";
import { readConfig } from "./config";
import type { Role } from "./types";

export type LobbyPlayer = { slot: number; accountId: number; team: "radiant" | "dire" };
export type Lobby = { lobbyId: string; mode: string; at: number; players: LobbyPlayer[]; file: string };
export type PlayerStats = {
  accountId: number;
  name: string | null;
  anonymous: boolean;
  games: number;                         // ранговых игр за 30 дней
  roles: Record<Role, number>;           // доля игр по позициям за 30 дней (сумма 1), пусто = равномерно
  rolesKnown: boolean;
  topHeroes: { heroId: number; games: number; wins: number }[]; // по числу игр
  heroes: Record<number, { games: number; wins: number }>;
};

const LOBBY_MAX_AGE = 2 * 3600; // секунд: старше — не текущий матч
const RE_LOBBY = /^(\d\d)\/(\d\d)\/(\d{4}) - (\d\d):(\d\d):(\d\d): .*\(Lobby (\d+) (\w+) ((?:\d+:\[U:1:\d+\]\s*)+)/;

let lobbyCache: { file: string; mtime: number; lobby: Lobby | null } | null = null;

/** Последний матч из server_log.txt: null, если файла нет, строки нет или она старше двух часов. */
export function currentLobby(): Lobby | null {
  for (const dir of findDotaDirs()) {
    const file = path.join(dir, "server_log.txt");
    let st: fs.Stats; try { st = fs.statSync(file); } catch { continue; }
    if (lobbyCache && lobbyCache.file === file && lobbyCache.mtime === st.mtimeMs) return lobbyCache.lobby;
    let lobby: Lobby | null = null;
    try {
      const len = Math.min(st.size, 512 * 1024); const buf = Buffer.alloc(len);
      const fd = fs.openSync(file, "r"); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
      const lines = buf.toString("utf8").split(/\r?\n/).reverse();
      for (const line of lines) {
        const m = RE_LOBBY.exec(line); if (!m) continue;
        const at = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6])).getTime() / 1000;
        const players: LobbyPlayer[] = [];
        for (const pm of m[9].matchAll(/(\d+):\[U:1:(\d+)\]/g)) { const slot = Number(pm[1]); players.push({ slot, accountId: Number(pm[2]), team: slot < 5 ? "radiant" : "dire" }); }
        if (players.length < 10) continue;
        lobby = { lobbyId: m[7], mode: m[8], at, players, file };
        break;
      }
    } catch {}
    if (lobby && Date.now() / 1000 - lobby.at > LOBBY_MAX_AGE) lobby = null;
    lobbyCache = { file, mtime: st.mtimeMs, lobby };
    return lobby;
  }
  return null;
}

const statsCache = new Map<number, { at: number; stats: PlayerStats }>();
const STATS_TTL = 6 * 3600 * 1000;
let inflight: Promise<void> | null = null;

const ROLE_OF: Record<string, Role> = { POSITION_1: 1, POSITION_2: 2, POSITION_3: 3, POSITION_4: 4, POSITION_5: 5 };
const emptyStats = (accountId: number): PlayerStats => ({ accountId, name: null, anonymous: true, games: 0, roles: { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 }, rolesKnown: false, topHeroes: [], heroes: {} });

/** Статистика игроков из Stratz одним запросом (алиасы по id); результат кэшируется на 6 часов. */
export async function fetchPlayerStats(ids: number[]): Promise<Map<number, PlayerStats>> {
  const { stratzToken } = readConfig();
  const out = new Map<number, PlayerStats>();
  const now = Date.now();
  const need = ids.filter((id) => { const c = statsCache.get(id); if (c && now - c.at < STATS_TTL) { out.set(id, c.stats); return false; } return true; });
  if (need.length && stratzToken) {
    if (!inflight) inflight = (async () => {
      const since = Math.floor(now / 1000) - 30 * 86400;
      const q = `{ ${need.map((id) => `p${id}: player(steamAccountId: ${id}) { steamAccount { name isAnonymous } heroesPerformance(request: {take: 60, lobbyTypeIds: [7], startDateTime: ${since}}, take: 60) { heroId matchCount winCount } matches(request: {take: 30, lobbyTypeIds: [7], startDateTime: ${since}}) { id players(steamAccountId: ${id}) { position } } }`).join(" ")} }`;
      try {
        const r = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${stratzToken}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query: q }) });
        const j = await r.json();
        for (const id of need) {
          const p = j?.data?.[`p${id}`];
          const st = emptyStats(id);
          if (p) {
            st.name = p.steamAccount?.name ?? null; st.anonymous = !!p.steamAccount?.isAnonymous;
            const perf: { heroId: number; matchCount: number; winCount: number }[] = p.heroesPerformance ?? [];
            for (const h of perf) st.heroes[h.heroId] = { games: h.matchCount, wins: h.winCount };
            st.topHeroes = perf.map((h) => ({ heroId: h.heroId, games: h.matchCount, wins: h.winCount })).sort((a, b) => b.games - a.games).slice(0, 6);
            const counts: Record<Role, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; let n = 0;
            for (const m of p.matches ?? []) { const pos = m.players?.[0]?.position; const r = pos ? ROLE_OF[pos] : undefined; if (r) { counts[r]++; n++; } }
            st.games = (p.matches ?? []).length;
            if (n >= 3) { st.rolesKnown = true; for (const r of [1, 2, 3, 4, 5] as Role[]) st.roles[r] = (counts[r] + 0.3) / (n + 1.5); }
          }
          statsCache.set(id, { at: Date.now(), stats: st });
        }
      } catch {}
    })().finally(() => { inflight = null; });
    await inflight;
    for (const id of need) { const c = statsCache.get(id); if (c) out.set(id, c.stats); }
  }
  return out;
}

/** Статистика уже загруженных игроков без похода в сеть (для оценки драфта). */
export function cachedPlayerStats(ids: number[]): Map<number, PlayerStats> {
  const out = new Map<number, PlayerStats>();
  for (const id of ids) { const c = statsCache.get(id); if (c) out.set(id, c.stats); }
  return out;
}
