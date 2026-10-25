// Обновляет data/*.json из Stratz. Запуск: node scripts/refresh-data.mjs   (токен берётся из .env)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split("=").map((s) => s.trim())));
const TOKEN = env.STRATZ_TOKEN; const ME = Number(env.STEAM_ACCOUNT_ID);
const DATA = path.join(ROOT, "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query) {
  const res = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query }) });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors[0]));
  return j.data;
}
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const save = (name, obj) => { fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj)); console.log("saved", name); };

// 1. heroes
const heroes = (await gql(`{ constants { heroes { id displayName shortName stats { primaryAttribute } } } }`)).constants.heroes.map((h) => ({ id: h.id, name: h.displayName, short: h.shortName, attr: h.stats?.primaryAttribute ?? "all" }));
save("heroes.json", heroes);
const names = new Map(heroes.map((h) => [h.id, h.name]));

// 2. matchups (Divine/Immortal)
const matchups = [];
for (const batch of chunks(heroes.map((h) => h.id), 10)) {
  const q = batch.map((id) => `h${id}: matchUp(heroId: ${id}, bracketBasicIds: [DIVINE_IMMORTAL], take: 160) { heroId matchCountWith matchCountVs with { heroId2 matchCount winCount synergy } vs { heroId2 matchCount winCount synergy } }`).join(" ");
  const d = await gql(`{ heroStats { ${q} } }`);
  for (const v of Object.values(d.heroStats)) { const m = v[0]; if (!m) continue; matchups.push({ heroId: m.heroId, matchCountWith: m.matchCountWith, matchCountVs: m.matchCountVs, with: m.with.map((x) => ({ h: x.heroId2, n: x.matchCount, w: x.winCount, s: x.synergy })), vs: m.vs.map((x) => ({ h: x.heroId2, n: x.matchCount, w: x.winCount, s: x.synergy })) }); }
  await sleep(300);
}
save("matchups.json", matchups);

// 3. mid meta: last 4 weeks, Divine+Immortal
const mid = (await gql(`{ heroStats { winWeek(positionIds: [POSITION_2], bracketIds: [DIVINE, IMMORTAL], take: 400) { week heroId winCount matchCount } } }`)).heroStats.winWeek;
const all = (await gql(`{ heroStats { winWeek(bracketIds: [DIVINE, IMMORTAL], take: 400) { week heroId winCount matchCount } } }`)).heroStats.winWeek;
const weeks = [...new Set(mid.map((r) => r.week))].sort().slice(-4);
const agg = (rows) => { const m = new Map(); for (const r of rows) { if (!weeks.includes(r.week)) continue; const a = m.get(r.heroId) ?? { g: 0, w: 0 }; a.g += r.matchCount; a.w += r.winCount; m.set(r.heroId, a); } return m; };
const midA = agg(mid), allA = agg(all);
const midMeta = [...midA].map(([heroId, a]) => ({ heroId, name: names.get(heroId), midGames: a.g, midWins: a.w, allGames: allA.get(heroId)?.g ?? a.g, midRate: a.g / (allA.get(heroId)?.g ?? a.g), midWinrate: a.w / a.g })).sort((x, y) => y.midGames - x.midGames);
save("mid-meta.json", midMeta);

// 3b. распределение ролей по героям (последние 4 недели)
const posRows = {};
for (const pos of [1, 2, 3, 4, 5]) {
  posRows[pos] = (await gql(`{ heroStats { winWeek(positionIds: [POSITION_${pos}], bracketIds: [DIVINE, IMMORTAL], take: 400) { week heroId matchCount } } }`)).heroStats.winWeek;
  await sleep(200);
}
const posAgg = new Map();
for (const pos of [1, 2, 3, 4, 5]) for (const r of posRows[pos]) { if (!weeks.includes(r.week)) continue; const a = posAgg.get(r.heroId) ?? { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; a[pos] += r.matchCount; posAgg.set(r.heroId, a); }
save("hero-positions.json", [...posAgg].map(([heroId, a]) => { const tot = Object.values(a).reduce((x, y) => x + y, 0) || 1; return { heroId, name: names.get(heroId), games: tot, p: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v / tot])) }; }));

// 4. player's matches for the last 365 days -> pool + personal pairs
const start = Math.floor(Date.now() / 1000) - 365 * 86400;
const matches = [];
for (let skip = 0; skip < 3000; skip += 100) {
  const d = await gql(`{ player(steamAccountId: ${ME}) { matches(request: {take: 100, skip: ${skip}}) { id startDateTime lobbyType players { steamAccountId heroId position isRadiant isVictory } } } }`);
  const page = d.player.matches; matches.push(...page.filter((m) => m.startDateTime >= start && m.lobbyType === "RANKED"));
  if (page.length < 100 || Math.min(...page.map((m) => m.startDateTime)) < start) break;
  await sleep(300);
}
const pool = new Map(); const pairs = new Map();
for (const m of matches) {
  const me = m.players.find((p) => p.steamAccountId === ME); if (!me) continue;
  const isMid = me.position === "POSITION_2" || me.position == null;
  const p = pool.get(me.heroId) ?? { heroId: me.heroId, name: names.get(me.heroId), games: 0, wins: 0, midGames: 0, midWins: 0, lastPlayed: 0 };
  p.games++; if (me.isVictory) p.wins++; if (isMid) { p.midGames++; if (me.isVictory) p.midWins++; } p.lastPlayed = Math.max(p.lastPlayed, m.startDateTime); pool.set(me.heroId, p);
  if (!isMid) continue;
  for (const o of m.players) { if (o.steamAccountId === ME) continue; const ally = o.isRadiant === me.isRadiant; const k = `${me.heroId}-${o.heroId}-${ally}`; const e = pairs.get(k) ?? { own: me.heroId, other: o.heroId, ally, games: 0, wins: 0 }; e.games++; if (me.isVictory) e.wins++; pairs.set(k, e); }
}
save("player-pool.json", [...pool.values()].sort((a, b) => b.midGames - a.midGames));
save("personal-pairs.json", [...pairs.values()]);
console.log(`done: ${matches.length} ranked matches in the last year`);
