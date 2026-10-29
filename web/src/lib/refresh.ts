// Обновление данных Stratz из приложения: та же логика, что в scripts/refresh-data.mjs,
// результат пишется в USER_DIR/data (поверх данных, упакованных в приложение).
import fs from "node:fs";
import path from "node:path";
import { USER_DIR } from "./paths";
import { invalidateData } from "./data";
import { accountDir, addAccount } from "./accounts";

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

/** Общие данные (герои, матчапы, мета по ролям) и, если указан аккаунт, его пул и личная история. */
export async function refreshData(token: string, me: number | null, progress: Progress = () => {}) {
  await refreshGeneral(token, progress);
  if (me) await refreshAccount(token, me, progress);
  progress("готово");
}

export async function refreshGeneral(token: string, progress: Progress = () => {}) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  const save = (name: string, obj: unknown) => fs.writeFileSync(path.join(USER_DATA_DIR, name), JSON.stringify(obj));

  progress("герои");
  const heroesRaw = (await gql(token, `{ constants { heroes { id displayName shortName roles { roleId level } stats { primaryAttribute attackType complexity } } } }`)).constants.heroes as { id: number; displayName: string; shortName: string; roles?: { roleId: string; level: number }[]; stats?: { primaryAttribute?: string; attackType?: string; complexity?: number } }[];
  // roles: теги героя (DISABLER, PUSHER, INITIATOR…) с уровнем 1–3 — для подсказки «чего не хватает команде»
  const heroes = heroesRaw.map((h) => ({ id: h.id, name: h.displayName, short: h.shortName, attr: h.stats?.primaryAttribute ?? "all", roles: (h.roles ?? []).map((x) => ({ r: x.roleId, l: x.level })), attackType: h.stats?.attackType ?? null, complexity: h.stats?.complexity ?? null }));
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
  const roleMeta: Record<string, { heroId: number; games: number; wins: number; winrate: number; rate: number }[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const pos of [1, 2, 3, 4, 5]) {
    const rows: WW[] = (await gql(token, `{ heroStats { winWeek(positionIds: [POSITION_${pos}], bracketIds: [DIVINE, IMMORTAL], take: 400) { week heroId matchCount winCount } } }`)).heroStats.winWeek;
    const per = new Map<number, { g: number; w: number }>();
    for (const r of rows) { if (!weeks.includes(r.week)) continue; const a = posAgg.get(r.heroId) ?? { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; a[pos] += r.matchCount; posAgg.set(r.heroId, a); const q = per.get(r.heroId) ?? { g: 0, w: 0 }; q.g += r.matchCount; q.w += r.winCount ?? 0; per.set(r.heroId, q); }
    roleMeta[pos] = [...per].map(([heroId, q]) => ({ heroId, games: q.g, wins: q.w, winrate: q.g ? q.w / q.g : 0.5, rate: q.g / (allA.get(heroId)?.g || q.g) }));
    await sleep(200);
  }
  // то же только по Immortal: что реально берут и с каким винрейтом игроки верхнего брекета на каждой роли
  progress("мета Immortal");
  const topMeta: Record<string, { heroId: number; games: number; wins: number; winrate: number; rate: number }[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const pos of [1, 2, 3, 4, 5]) {
    const rows: WW[] = (await gql(token, `{ heroStats { winWeek(positionIds: [POSITION_${pos}], bracketIds: [IMMORTAL], take: 400) { week heroId matchCount winCount } } }`)).heroStats.winWeek;
    const per = new Map<number, { g: number; w: number }>();
    for (const r of rows) { if (!weeks.includes(r.week)) continue; const q = per.get(r.heroId) ?? { g: 0, w: 0 }; q.g += r.matchCount; q.w += r.winCount ?? 0; per.set(r.heroId, q); }
    const total = [...per.values()].reduce((a, q) => a + q.g, 0) || 1;
    topMeta[pos] = [...per].map(([heroId, q]) => ({ heroId, games: q.g, wins: q.w, winrate: q.g ? q.w / q.g : 0.5, rate: q.g / total }));
    await sleep(200);
  }
  save("role-meta-immortal.json", topMeta);
  save("hero-positions.json", [...posAgg].map(([heroId, a]) => { const tot = Object.values(a).reduce((x, y) => x + y, 0) || 1; return { heroId, name: names.get(heroId), games: tot, p: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v / tot])) }; }));
  save("role-meta.json", roleMeta);

  fs.writeFileSync(path.join(USER_DATA_DIR, "updated-at.json"), JSON.stringify({ at: Math.floor(Date.now() / 1000) }));
  invalidateData();
}

/** Имя аккаунта и закрыт ли профиль (Stratz не видит матчи закрытых: пул не соберётся, результаты ищутся по номеру матча). */
export async function fetchAccountInfo(token: string, me: number): Promise<{ name: string | null; anonymous: boolean | undefined }> {
  try { const d = await gql(token, `{ player(steamAccountId: ${me}) { steamAccount { name isAnonymous } } }`); return { name: d?.player?.steamAccount?.name ?? null, anonymous: d?.player?.steamAccount?.isAnonymous ?? undefined }; } catch { return { name: null, anonymous: undefined }; }
}

/** Пул героев и личные пары аккаунта за год ранговых игр: в папку аккаунта. Аккаунт добавляется в список. */
export async function refreshAccount(token: string, me: number, progress: Progress = () => {}) {
  const dir = accountDir(me);
  fs.mkdirSync(dir, { recursive: true });
  const save = (name: string, obj: unknown) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));
  const names = new Map<number, string>();
  try { for (const h of JSON.parse(fs.readFileSync(path.join(USER_DATA_DIR, "heroes.json"), "utf8")) as { id: number; name: string }[]) names.set(h.id, h.name); } catch {}
  progress("имя аккаунта");
  const { name: accName, anonymous } = await fetchAccountInfo(token, me);
  addAccount(me, accName ?? undefined, false, anonymous);
  {
    progress(`матчи ${accName ?? me} за год`);
    const start = Math.floor(Date.now() / 1000) - 365 * 86400;
    type MM = { id: number; startDateTime: number; lobbyType: string; players: { steamAccountId: number; heroId: number; position: string | null; isRadiant: boolean; isVictory: boolean }[] };
    const matches: MM[] = [];
    for (let skip = 0; skip < 3000; skip += 100) {
      const page: MM[] = (await gql(token, `{ player(steamAccountId: ${me}) { matches(request: {take: 100, skip: ${skip}}) { id startDateTime lobbyType players { steamAccountId heroId position isRadiant isVictory } } } }`)).player.matches;
      matches.push(...page.filter((m) => m.startDateTime >= start && m.lobbyType === "RANKED"));
      if (page.length < 100 || Math.min(...page.map((m) => m.startDateTime)) < start) break;
      await sleep(250);
    }
    const pool = new Map<number, { heroId: number; name: string | undefined; games: number; wins: number; midGames: number; midWins: number; lastPlayed: number; byRole: Record<string, { games: number; wins: number }> }>();
    const pairs = new Map<string, { role: number; own: number; other: number; ally: boolean; games: number; wins: number }>();
    for (const m of matches) {
      const self: MM["players"][number] | undefined = m.players.find((pl) => pl.steamAccountId === me); if (!self) continue;
      const isMid = self.position === "POSITION_2" || self.position == null;
      const role = self.position ? Number(self.position.replace("POSITION_", "")) : 2; // позиция не определена: считаем мидом
      const p = pool.get(self.heroId) ?? { heroId: self.heroId, name: names.get(self.heroId), games: 0, wins: 0, midGames: 0, midWins: 0, lastPlayed: 0, byRole: {} as Record<string, { games: number; wins: number }> };
      p.games++; if (self.isVictory) p.wins++; if (isMid) { p.midGames++; if (self.isVictory) p.midWins++; } p.lastPlayed = Math.max(p.lastPlayed, m.startDateTime); pool.set(self.heroId, p);
      { const br = p.byRole[String(role)] ?? { games: 0, wins: 0 }; br.games++; if (self.isVictory) br.wins++; p.byRole[String(role)] = br; }
      const pairRole = role;
      for (const o of m.players as MM["players"]) { if (o.steamAccountId === me) continue; const ally = o.isRadiant === self.isRadiant; const k = `${pairRole}-${self.heroId}-${o.heroId}-${ally}`; const e = pairs.get(k) ?? { role: pairRole, own: self.heroId, other: o.heroId, ally, games: 0, wins: 0 }; e.games++; if (self.isVictory) e.wins++; pairs.set(k, e); }
    }
    save("player-pool.json", [...pool.values()].sort((a, b) => b.midGames - a.midGames));
    save("personal-pairs.json", [...pairs.values()]);
  }
  fs.writeFileSync(path.join(dir, "updated-at.json"), JSON.stringify({ at: Math.floor(Date.now() / 1000) }));
  invalidateData();
}

export function dataUpdatedAt(): number | null {
  try { return JSON.parse(fs.readFileSync(path.join(USER_DATA_DIR, "updated-at.json"), "utf8")).at; } catch { return null; }
}
