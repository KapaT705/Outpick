// Разбор матча для истории: цифры своего игрока (KDA, GPM, ластхиты и нетворс к 10 минуте, смерти до 10) и соперник
// по линии. Источник: Stratz match(id) с поминутной статистикой; для закрытых профилей OpenDota (lh_t/gold_t есть
// только у распарсенных матчей, остальное всегда).
import { readConfig } from "./config";

export type MatchDetails = {
  kills: number; deaths: number; assists: number;
  gpm: number; xpm: number; lastHits: number; denies: number; level: number;
  heroDamage?: number; towerDamage?: number;
  lane?: "safe" | "mid" | "off" | "jungle" | null;
  position?: number | null;           // 1..5 по данным Stratz/OpenDota
  lh10?: number | null; nw10?: number | null; deaths10?: number | null; // к 10 минуте
  laneOpp?: { heroId: number; nw10: number | null; lh10: number | null } | null; // враг на той же линии
  source: "stratz" | "opendota";
};

const STRATZ = (token: string, query: string) => fetch("https://api.stratz.com/graphql", {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query }),
}).then((r) => r.json());

const LANE: Record<string, MatchDetails["lane"]> = { SAFE_LANE: "safe", MID_LANE: "mid", OFF_LANE: "off", JUNGLE: "jungle", ROAMING: null };
const sum = (a: number[] | undefined, n: number) => (Array.isArray(a) ? a.slice(0, n).reduce((x, y) => x + (y ?? 0), 0) : null);

/** Stratz: свой игрок по Steam ID или по герою (у закрытого профиля id скрыт). */
export async function stratzDetails(id: string | number, me: number, heroId: number): Promise<MatchDetails | null> {
  const { stratzToken } = readConfig();
  if (!stratzToken) return null;
  try {
    const j = await STRATZ(stratzToken, `{ match(id: ${id}) { players { steamAccountId heroId isRadiant lane position kills deaths assists goldPerMinute experiencePerMinute numLastHits numDenies level heroDamage towerDamage stats { lastHitsPerMinute networthPerMinute deathEvents { time } } } } }`);
    type P = { steamAccountId: number | null; heroId: number; isRadiant: boolean; lane: string | null; position: string | null; kills: number; deaths: number; assists: number; goldPerMinute: number; experiencePerMinute: number; numLastHits: number; numDenies: number; level: number; heroDamage: number; towerDamage: number; stats?: { lastHitsPerMinute?: number[]; networthPerMinute?: number[]; deathEvents?: { time: number }[] } };
    const ps: P[] = j?.data?.match?.players ?? [];
    const p = ps.find((x) => x.steamAccountId === me) ?? ps.find((x) => x.heroId === heroId);
    if (!p) return null;
    const lane = p.lane ? LANE[p.lane] ?? null : null;
    const opp = lane ? ps.find((x) => x.isRadiant !== p.isRadiant && x.lane && LANE[x.lane] === lane) : undefined;
    return {
      kills: p.kills, deaths: p.deaths, assists: p.assists, gpm: p.goldPerMinute, xpm: p.experiencePerMinute, lastHits: p.numLastHits, denies: p.numDenies, level: p.level,
      heroDamage: p.heroDamage, towerDamage: p.towerDamage, lane, position: p.position ? Number(p.position.replace("POSITION_", "")) || null : null,
      lh10: sum(p.stats?.lastHitsPerMinute, 10), nw10: p.stats?.networthPerMinute?.[9] ?? null, deaths10: p.stats?.deathEvents ? p.stats.deathEvents.filter((d) => d.time <= 600).length : null,
      laneOpp: opp ? { heroId: opp.heroId, nw10: opp.stats?.networthPerMinute?.[9] ?? null, lh10: sum(opp.stats?.lastHitsPerMinute, 10) } : null,
      source: "stratz",
    };
  } catch { return null; }
}

/** OpenDota: открытый API, свой игрок по account_id или по герою. */
export async function openDotaDetails(id: string | number, me: number, heroId: number): Promise<MatchDetails | null> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20_000);
    const r = await fetch(`https://api.opendota.com/api/matches/${id}`, { headers: { "User-Agent": "outpick" }, signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!r.ok) return null;
    type P = { account_id?: number | null; hero_id: number; player_slot: number; lane?: number | null; lane_role?: number | null; kills: number; deaths: number; assists: number; gold_per_min: number; xp_per_min: number; last_hits: number; denies: number; level: number; hero_damage?: number; tower_damage?: number; lh_t?: number[]; gold_t?: number[]; deaths_log?: { time: number }[] };
    const d = await r.json() as { players?: P[] };
    const ps = d.players ?? [];
    const p = ps.find((x) => x.account_id === me) ?? ps.find((x) => x.hero_id === heroId);
    if (!p) return null;
    const laneOf = (x: P): MatchDetails["lane"] => (x.lane === 1 ? "safe" : x.lane === 2 ? "mid" : x.lane === 3 ? "off" : x.lane ? "jungle" : null);
    const lane = laneOf(p);
    const rad = (x: P) => x.player_slot < 128;
    const opp = lane ? ps.find((x) => rad(x) !== rad(p) && laneOf(x) === lane) : undefined;
    return {
      kills: p.kills, deaths: p.deaths, assists: p.assists, gpm: p.gold_per_min, xpm: p.xp_per_min, lastHits: p.last_hits, denies: p.denies, level: p.level,
      heroDamage: p.hero_damage, towerDamage: p.tower_damage, lane, position: lane === "mid" ? 2 : p.lane_role === 1 && lane === "safe" ? 1 : p.lane_role === 1 && lane === "off" ? 3 : null,
      lh10: p.lh_t?.[10] ?? null, nw10: p.gold_t?.[10] ?? null, deaths10: p.deaths_log ? p.deaths_log.filter((x) => x.time <= 600).length : null,
      laneOpp: opp ? { heroId: opp.hero_id, nw10: opp.gold_t?.[10] ?? null, lh10: opp.lh_t?.[10] ?? null } : null,
      source: "opendota",
    };
  } catch { return null; }
}

export async function fetchMatchDetails(id: string | number, me: number, heroId: number): Promise<MatchDetails | null> {
  return (await stratzDetails(id, me, heroId)) ?? (await openDotaDetails(id, me, heroId));
}
