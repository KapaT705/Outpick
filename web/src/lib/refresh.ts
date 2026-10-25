// Обновление данных Stratz из приложения: та же логика, что в scripts/refresh-data.mjs,
// результат пишется в USER_DIR/data (поверх данных, упакованных в приложение).
import fs from "node:fs";
import path from "node:path";
import { USER_DIR } from "./paths";
import { invalidateData } from "./data";

export const USER_DATA_DIR = path.join(USER_DIR, "data");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

type Progress = (msg: string) => void;

async function gql(token: string, query: string) {
  const res = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query }) });
  const j = await res.json();
  if (j.errors) throw new Error(j.errors[0]?.message ?? "Stratz error");
  return j.data;
}

export async function refreshData(token: string, me: number | null, progress: Progress = () => {}) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  const save = (name: string, obj: unknown) => fs.writeFileSync(path.join(USER_DATA_DIR, name), JSON.stringify(obj));

  progress("герои");
  const heroesRaw = (await gql(token, `{ constants { heroes { id displayName shortName stats { primaryAttribute } } } }`)).constants.heroes as { id: number; displayName: string; shortName: string; stats?: { primaryAttribute?: string } }[];
  const heroes = heroesRaw.map((h) => ({ id: h.id, name: h.displayName, short: h.shortName, attr: h.stats?.primaryAttribute ?? "all" }));
  save("heroes.json", heroes);
  const names = new Map(heroes.map((h) => [h.id, h.name]));

  progress("матчапы");
  const matchups: unknown[] = [];
  const batches = chunks(heroes.map((h) => h.id), 10);
  for (let i = 0; i < batches.length; i++) {
    const q = batches[i].map((id) => `h${id}: matchUp(heroId: ${id}, bracketBasicIds: [DIVINE_IMMORTAL], take: 160) { heroId matchCountWith matchCountVs with { heroId2 matchCount winCount synergy } vs { heroId2 matchCount winCount synergy } }`).join(" ");
    const d = await gql(token, `{ heroStats { ${q} } }`);
    type Pair = { heroId2: number; matchCount: number; winCount: number; synergy: number };
    type MU = { heroId: number; matchCountWith: number; matchCountVs: number; with: Pair[]; vs: Pair[] };
    for (const v of Object.values(d.heroStats) as MU[][]) {
      const m = v[0]; if (!m) continue;
      matchups.push({ heroId: m.heroId, matchCountWith: m.matchCountWith, matchCountVs: m.matchCountVs, with: m.with.map((x) => ({ h: x.heroId2, n: x.matchCount, w: x.winCount, s: x.synergy })), vs: m.vs.map((x) => ({ h: x.heroId2, n: x.matchCount, w: x.winCount, s: x.synergy })) });
    }
    progress(`матчапы ${Math.min((i + 1) * 10, heroes.length)}/${heroes.length}`);
    await sleep(250);
  }
  save("matchups.json", matchups);

  progress("мета мида");
  type WW = { week: number; heroId: number; winCount: number; matchCount: number };
  const mid: WW[] = (await gql(token, `{ heroStats { winWeek(positionIds: [POSITION_2], bracketIds: [DIVINE, IMMORTAL], take: 400) { week heroId winCount matchCount } } }`)).heroStats.winWeek;
  const all: WW[] = (await gql(token, `{ heroStats { winWeek(bracketIds: [DIVINE, IMMORTAL], take: 400) { week heroId winCount matchCount } } }`)).heroStats.winWeek;
  const weeks = [...new Set(mid.map((r) => r.week))].sort().slice(-4);
  const agg = (rows: WW[]) => { const m = new Map<number, { g: number; w: number }>(); for (const r of rows) { if (!weeks.includes(r.week)) continue; const a = m.get(r.heroId) ?? { g: 0, w: 0 }; a.g += r.matchCount; a.w += r.winCount; m.set(r.heroId, a); } return m; };
  const midA = agg(mid), allA = agg(all);
  save("mid-meta.json", [...midA].map(([heroId, a]) => ({ heroId, name: names.get(heroId), midGames: a.g, midWins: a.w, allGames: allA.get(heroId)?.g ?? a.g, midRate: a.g / (allA.get(heroId)?.g ?? a.g), midWinrate: a.w / a.g })).sort((x, y) => y.midGames - x.midGames));

  progress("роли героев");
  const posAgg = new Map<number, Record<string, number>>();
  for (const pos of [1, 2, 3, 4, 5]) {
    const rows: WW[] = (await gql(token, `{ heroStats { winWeek(positionIds: [POSITION_${pos}], bracketIds: [DIVINE, IMMORTAL], take: 400) { week heroId matchCount winCount } } }`)).heroStats.winWeek;
    for (const r of rows) { if (!weeks.includes(r.week)) continue; const a = posAgg.get(r.heroId) ?? { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; a[pos] += r.matchCount; posAgg.set(r.heroId, a); }
    await sleep(200);
  }
  save("hero-positions.json", [...posAgg].map(([heroId, a]) => { const tot = Object.values(a).reduce((x, y) => x + y, 0) || 1; return { heroId, name: names.get(heroId), games: tot, p: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v / tot])) }; }));

  if (me) {
    progress("твои матчи за год");
    const start = Math.floor(Date.now() / 1000) - 365 * 86400;
    type MM = { id: number; startDateTime: number; lobbyType: string; players: { steamAccountId: number; heroId: number; position: string | null; isRadiant: boolean; isVictory: boolean }[] };
    const matches: MM[] = [];
    for (let skip = 0; skip < 3000; skip += 100) {
      const page: MM[] = (await gql(token, `{ player(steamAccountId: ${me}) { matches(request: {take: 100, skip: ${skip}}) { id startDateTime lobbyType players { steamAccountId heroId position isRadiant isVictory } } } }`)).player.matches;
      matches.push(...page.filter((m) => m.startDateTime >= start && m.lobbyType === "RANKED"));
      if (page.length < 100 || Math.min(...page.map((m) => m.startDateTime)) < start) break;
      await sleep(250);
    }
    const pool = new Map<number, { heroId: number; name: string | undefined; games: number; wins: number; midGames: number; midWins: number; lastPlayed: number }>();
    const pairs = new Map<string, { own: number; other: number; ally: boolean; games: number; wins: number }>();
    for (const m of matches) {
      const self = m.players.find((p) => p.steamAccountId === me); if (!self) continue;
      const isMid = self.position === "POSITION_2" || self.position == null;
      const p = pool.get(self.heroId) ?? { heroId: self.heroId, name: names.get(self.heroId), games: 0, wins: 0, midGames: 0, midWins: 0, lastPlayed: 0 };
      p.games++; if (self.isVictory) p.wins++; if (isMid) { p.midGames++; if (self.isVictory) p.midWins++; } p.lastPlayed = Math.max(p.lastPlayed, m.startDateTime); pool.set(self.heroId, p);
      if (!isMid) continue;
      for (const o of m.players) { if (o.steamAccountId === me) continue; const ally = o.isRadiant === self.isRadiant; const k = `${self.heroId}-${o.heroId}-${ally}`; const e = pairs.get(k) ?? { own: self.heroId, other: o.heroId, ally, games: 0, wins: 0 }; e.games++; if (self.isVictory) e.wins++; pairs.set(k, e); }
    }
    save("player-pool.json", [...pool.values()].sort((a, b) => b.midGames - a.midGames));
    save("personal-pairs.json", [...pairs.values()]);
  }
  fs.writeFileSync(path.join(USER_DATA_DIR, "updated-at.json"), JSON.stringify({ at: Math.floor(Date.now() / 1000) }));
  invalidateData();
  progress("готово");
}

export function dataUpdatedAt(): number | null {
  try { return JSON.parse(fs.readFileSync(path.join(USER_DATA_DIR, "updated-at.json"), "utf8")).at; } catch { return null; }
}
