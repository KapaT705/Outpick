// Норма для героя на позиции у Divine/Immortal (Stratz heroStats.stats): средние за матч и средние к 10 минуте.
// Кэш в USER_DIR/data/bench/<hero>-<pos>.json на 14 дней. С ней разбор матча говорит «ластхитов к 10 минуте 38
// при норме 52», а не просто цифру.
import fs from "node:fs";
import path from "node:path";
import { USER_DIR } from "./paths";
import { readConfig } from "./config";

export type Bench = {
  heroId: number; position: number; matchCount: number; winrate: number; avgDuration: number;
  overall: { kills: number; deaths: number; assists: number; cs: number; dn: number; xp: number; level: number; networth: number; heroDamage: number; towerDamage: number };
  at10: { cs: number; dn: number; networth: number; deaths: number; level: number; xp: number } | null;
  at: number;
};

const DIR = path.join(USER_DIR, "data", "bench");
const TTL = 14 * 86400;
const F = "heroId matchCount winCount time position kills deaths assists cs dn xp level networth heroDamage towerDamage";
type Row = { heroId: number; matchCount: number; winCount: number; time: number; kills: number; deaths: number; assists: number; cs: number; dn: number; xp: number; level: number; networth: number; heroDamage: number; towerDamage: number };

export function cachedBench(heroId: number, position: number): Bench | null {
  try { const b = JSON.parse(fs.readFileSync(path.join(DIR, `${heroId}-${position}.json`), "utf8")) as Bench; return Date.now() / 1000 - b.at < TTL ? b : null; } catch { return null; }
}

export async function fetchBench(heroId: number, position: number): Promise<Bench | null> {
  const hit = cachedBench(heroId, position);
  if (hit) return hit;
  const { stratzToken } = readConfig();
  if (!stratzToken) return null;
  try {
    const q = `{ heroStats { overall: stats(heroIds: [${heroId}], bracketBasicIds: [DIVINE_IMMORTAL], positionIds: [POSITION_${position}], groupByTime: false, groupByPosition: true, groupByBracket: false) { ${F} } byTime: stats(heroIds: [${heroId}], bracketBasicIds: [DIVINE_IMMORTAL], positionIds: [POSITION_${position}], groupByTime: true, groupByPosition: true, groupByBracket: false, minTime: 10, maxTime: 10) { ${F} } } }`;
    const r = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${stratzToken}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query: q }) });
    const j = await r.json();
    const o: Row | undefined = j?.data?.heroStats?.overall?.[0];
    if (!o) return null;
    const t: Row | undefined = (j?.data?.heroStats?.byTime ?? []).find((x: Row) => x.time === 10);
    const b: Bench = {
      heroId, position, matchCount: o.matchCount, winrate: o.matchCount ? o.winCount / o.matchCount : 0.5, avgDuration: o.time,
      overall: { kills: o.kills, deaths: o.deaths, assists: o.assists, cs: o.cs, dn: o.dn, xp: o.xp, level: o.level, networth: o.networth, heroDamage: o.heroDamage, towerDamage: o.towerDamage },
      at10: t ? { cs: t.cs, dn: t.dn, networth: t.networth, deaths: t.deaths, level: t.level, xp: t.xp } : null,
      at: Math.floor(Date.now() / 1000),
    };
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, `${heroId}-${position}.json`), JSON.stringify(b));
    return b;
  } catch { return null; }
}
