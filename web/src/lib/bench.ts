// Норма для героя на позиции у Divine/Immortal (Stratz heroStats.stats): средние за матч и средние к каждой минуте.
// Кэш в USER_DIR/data/bench/<hero>-<pos>.json на 14 дней. С ней разбор матча говорит «ластхитов к 10 минуте 38
// при норме 52», а не просто цифру; поминутные строки нужны отчёту (линия на 5 и 10 минуте, смерти по отрезкам).
import fs from "node:fs";
import path from "node:path";
import { USER_DIR } from "./paths";
import { readConfig } from "./config";

/** Средние к минуте t (накопительно с начала матча): добито, не отдано, золото, смерти, уровень, опыт, урон по героям, стаки. */
export type BenchAt = { t: number; cs: number; dn: number; networth: number; deaths: number; level: number; xp: number; heroDamage: number; stacks: number };

export type Bench = {
  heroId: number; position: number; matchCount: number; winrate: number; avgDuration: number;
  overall: { kills: number; deaths: number; assists: number; cs: number; dn: number; xp: number; level: number; networth: number; heroDamage: number; towerDamage: number };
  at10: { cs: number; dn: number; networth: number; deaths: number; level: number; xp: number } | null;
  byTime?: BenchAt[]; // минуты 1..60; в старом кэше нет (или нет урона и стаков), тогда норма перекачивается
  at: number;
};

const DIR = path.join(USER_DIR, "data", "bench");
const TTL = 14 * 86400;
const F = "heroId matchCount winCount time position kills deaths assists cs dn xp level networth heroDamage towerDamage campsStacked";
type Row = { heroId: number; matchCount: number; winCount: number; time: number; kills: number; deaths: number; assists: number; cs: number; dn: number; xp: number; level: number; networth: number; heroDamage: number; towerDamage: number; campsStacked: number };

export function cachedBench(heroId: number, position: number): Bench | null {
  try { const b = JSON.parse(fs.readFileSync(path.join(DIR, `${heroId}-${position}.json`), "utf8")) as Bench; return Date.now() / 1000 - b.at < TTL && b.byTime?.[0]?.stacks != null ? b : null; } catch { return null; }
}

/** Норма к минуте t: строка этой минуты или ближайшая раньше (у коротких матчей поздних минут нет). */
export function benchAt(b: Bench | null | undefined, t: number): BenchAt | null {
  if (!b?.byTime?.length) return null;
  let best: BenchAt | null = null;
  for (const r of b.byTime) if (r.t <= t && (!best || r.t > best.t)) best = r;
  return best;
}

export async function fetchBench(heroId: number, position: number): Promise<Bench | null> {
  return (await fetchBenches(position, [heroId])).get(heroId) ?? null;
}

/** Нормы нескольких героев на одной позиции одним запросом (для сводки смертей по десяткам матчей). */
export async function fetchBenches(position: number, heroIds: number[]): Promise<Map<number, Bench>> {
  const out = new Map<number, Bench>();
  const need: number[] = [];
  for (const id of new Set(heroIds)) { const hit = cachedBench(id, position); if (hit) out.set(id, hit); else need.push(id); }
  if (!need.length || position < 1 || position > 5) return out;
  const { stratzToken } = readConfig();
  if (!stratzToken) return out;
  try {
    const args = `heroIds: [${need.join(",")}], bracketBasicIds: [DIVINE_IMMORTAL], positionIds: [POSITION_${position}], groupByPosition: true, groupByBracket: false`;
    const q = `{ heroStats { overall: stats(${args}, groupByTime: false) { ${F} } byTime: stats(${args}, groupByTime: true, minTime: 1, maxTime: 60) { ${F} } } }`;
    const r = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${stratzToken}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query: q }) });
    const j = await r.json();
    const overall: Row[] = j?.data?.heroStats?.overall ?? [];
    const byTime: Row[] = j?.data?.heroStats?.byTime ?? [];
    fs.mkdirSync(DIR, { recursive: true });
    for (const o of overall) {
      if (!need.includes(o.heroId)) continue;
      const rows = byTime.filter((x) => x.heroId === o.heroId).sort((a, b) => a.time - b.time)
        .map((x): BenchAt => ({ t: x.time, cs: x.cs, dn: x.dn, networth: x.networth, deaths: x.deaths, level: x.level, xp: x.xp, heroDamage: x.heroDamage, stacks: x.campsStacked ?? 0 }));
      const t = rows.find((x) => x.t === 10);
      const b: Bench = {
        heroId: o.heroId, position, matchCount: o.matchCount, winrate: o.matchCount ? o.winCount / o.matchCount : 0.5, avgDuration: o.time,
        overall: { kills: o.kills, deaths: o.deaths, assists: o.assists, cs: o.cs, dn: o.dn, xp: o.xp, level: o.level, networth: o.networth, heroDamage: o.heroDamage, towerDamage: o.towerDamage },
        at10: t ? { cs: t.cs, dn: t.dn, networth: t.networth, deaths: t.deaths, level: t.level, xp: t.xp } : null,
        byTime: rows,
        at: Math.floor(Date.now() / 1000),
      };
      fs.writeFileSync(path.join(DIR, `${o.heroId}-${position}.json`), JSON.stringify(b));
      out.set(o.heroId, b);
    }
  } catch {}
  return out;
}
