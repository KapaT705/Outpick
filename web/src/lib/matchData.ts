// Полные данные матча для отчёта: все десять игроков с поминутными добиваниями, золотом и опытом, каждая смерть
// (кто убил, кто помогал, где, сколько золота потеряно и сколько лежал), убийства и помощи по времени, шанс на победу
// по минутам. Источник Stratz match(id). Разобранный матч кэшируется навсегда в USER_DIR/data/matches/<id>.json,
// неразобранный на 20 минут: Stratz дорабатывает запись позже, а иногда не разбирает её вовсе.
import fs from "node:fs";
import path from "node:path";
import { USER_DIR } from "./paths";
import { readConfig } from "./config";

export type Lane = "safe" | "mid" | "off" | "jungle";
export type MDeath = { t: number; attacker: number | null; assist: number[]; x: number; y: number; goldLost: number; timeDead: number };
export type MKill = { t: number; target: number; solo: boolean; smoke: boolean; x: number; y: number };
export type MPlayer = {
  steamAccountId: number | null; heroId: number; isRadiant: boolean; isVictory: boolean;
  lane: Lane | null; position: number | null;
  kills: number; deaths: number; assists: number; lastHits: number; denies: number; gpm: number; xpm: number; level: number; networth: number;
  lh: number[]; dn: number[]; xp: number[]; // прирост за каждую минуту (сумма первых t = к минуте t)
  nw: number[];                             // золото героя по минутам (элемент t-1 = к минуте t)
  dmg: number[];                            // урон по героям, прирост за каждую минуту
  stacks: number[];                         // стаки лагерей, накопительно (элемент t-1 = к минуте t)
  lvlAt: number[];                          // секунды, когда герой брал каждый уровень (первый элемент — первый уровень)
  deathsAt: MDeath[]; killsAt: number[]; assistsAt: number[]; // секунды
  kills2: MKill[];                          // настоящие убийства с подробностями (соло, смок, где)
  heroDamage: number; towerDamage: number; heroHealing: number;
  wardsPlaced: number; wardsKilled: number;
  runes: { t: number; rune: string }[];     // подобранные руны (и в бутылку)
};
export type MatchData = {
  id: number; startDateTime: number; durationSeconds: number; didRadiantWin: boolean; lobbyType: string | null;
  parsed: boolean;                 // есть поминутная статистика и смерти
  winRates: number[] | null;       // шанс Света на победу по минутам, 0..1
  laneOutcome: { top: string | null; mid: string | null; bottom: string | null };
  players: MPlayer[];
  towers: { t: number; attacker: number | null; radiant: boolean }[]; // снесённые вышки: чья, кто добил
  at: number;
  v?: number; // версия разбора: при смене кэш перекачивается
};

const DIR = path.join(USER_DIR, "data", "matches");
const V = 4;
const UNPARSED_TTL = 20 * 60;
const LANE: Record<string, Lane | null> = { SAFE_LANE: "safe", MID_LANE: "mid", OFF_LANE: "off", JUNGLE: "jungle", ROAMING: null };

const Q = (id: number) => `{ match(id: ${id}) { id startDateTime durationSeconds didRadiantWin lobbyType parsedDateTime winRates topLaneOutcome midLaneOutcome bottomLaneOutcome
  towerDeaths { time isRadiant attacker }
  players { steamAccountId heroId isRadiant isVictory lane position kills deaths assists numLastHits numDenies goldPerMinute experiencePerMinute level networth heroDamage towerDamage heroHealing
    stats { lastHitsPerMinute deniesPerMinute experiencePerMinute networthPerMinute heroDamagePerMinute campStack level
      deathEvents { time attacker assist positionX positionY goldLost timeDead } killEvents { time target isSolo isSmoke positionX positionY } assistEvents { time target }
      wards { time } wardDestruction { time isWard } runes { time rune action } } } } }`;

type SP = { steamAccountId: number | null; heroId: number; isRadiant: boolean; isVictory: boolean; lane: string | null; position: string | null; kills: number; deaths: number; assists: number; numLastHits: number; numDenies: number; goldPerMinute: number; experiencePerMinute: number; level: number; networth: number; heroDamage: number | null; towerDamage: number | null; heroHealing: number | null;
  stats?: { lastHitsPerMinute?: number[] | null; deniesPerMinute?: number[] | null; experiencePerMinute?: number[] | null; networthPerMinute?: number[] | null;
    heroDamagePerMinute?: number[] | null; campStack?: number[] | null; level?: number[] | null; deathEvents?: { time: number; attacker: number | null; assist: number[] | null; positionX: number; positionY: number; goldLost: number | null; timeDead: number | null }[] | null;
    killEvents?: { time: number; target: number | null; isSolo: boolean | null; isSmoke: boolean | null; positionX: number; positionY: number }[] | null; assistEvents?: { time: number; target: number | null }[] | null;
    wards?: { time: number }[] | null; wardDestruction?: { time: number; isWard: boolean | null }[] | null; runes?: { time: number; rune: string; action: string }[] | null } | null };

function cached(id: number): MatchData | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), "utf8")) as MatchData;
    return m.v === V && (m.parsed || Date.now() / 1000 - m.at < UNPARSED_TTL) ? m : null;
  } catch { return null; }
}

export async function fetchMatchData(id: number, opts: { fresh?: boolean } = {}): Promise<MatchData | null> {
  if (!opts.fresh) { const hit = cached(id); if (hit) return hit; }
  const { stratzToken } = readConfig();
  if (!stratzToken) return null;
  try {
    const r = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${stratzToken}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query: Q(id) }) });
    const j = await r.json();
    const m = j?.data?.match;
    if (!m || !Array.isArray(m.players) || !m.players.length) return null;
    // Stratz пишет в смерти героя и смерти его юнитов (варды Веномансера: 294 «смерти» при 12 настоящих). Настоящая
    // смерть та, после которой герой лежит, и новая не раньше, чем он воскрес; убийство и помощь засчитываются, если
    // цель в ту же секунду по-настоящему умерла.
    const realDeaths = new Map<number, Set<number>>();
    for (const p of m.players as SP[]) {
      const kept: { time: number; timeDead: number }[] = [];
      for (const d of [...(p.stats?.deathEvents ?? [])].filter((d) => (d.timeDead ?? 0) > 0).sort((a, b) => a.time - b.time)) {
        const last = kept[kept.length - 1];
        if (!last || d.time >= last.time + last.timeDead) kept.push({ time: d.time, timeDead: d.timeDead ?? 0 });
      }
      realDeaths.set(p.heroId, new Set(kept.map((d) => d.time)));
    }
    const isReal = (target: number | null, t: number) => { const ds = target ? realDeaths.get(target) : undefined; return !!ds && (ds.has(t) || ds.has(t - 1) || ds.has(t + 1)); };
    const players: MPlayer[] = (m.players as SP[]).map((p) => {
      const s = p.stats ?? {};
      const mine = realDeaths.get(p.heroId)!;
      return {
        steamAccountId: p.steamAccountId, heroId: p.heroId, isRadiant: p.isRadiant, isVictory: p.isVictory,
        lane: p.lane ? LANE[p.lane] ?? null : null, position: p.position ? Number(p.position.replace("POSITION_", "")) || null : null,
        kills: p.kills, deaths: p.deaths, assists: p.assists, lastHits: p.numLastHits, denies: p.numDenies, gpm: p.goldPerMinute, xpm: p.experiencePerMinute, level: p.level, networth: p.networth,
        lh: s.lastHitsPerMinute ?? [], dn: s.deniesPerMinute ?? [], xp: s.experiencePerMinute ?? [], nw: s.networthPerMinute ?? [],
        dmg: s.heroDamagePerMinute ?? [], stacks: s.campStack ?? [], lvlAt: s.level ?? [],
        deathsAt: (s.deathEvents ?? []).filter((d) => mine.has(d.time)).filter((d, i, a) => a.findIndex((x) => x.time === d.time) === i).map((d) => ({ t: d.time, attacker: d.attacker ?? null, assist: d.assist ?? [], x: d.positionX, y: d.positionY, goldLost: d.goldLost ?? 0, timeDead: d.timeDead ?? 0 })),
        killsAt: (s.killEvents ?? []).filter((k) => isReal(k.target, k.time)).map((k) => k.time), assistsAt: (s.assistEvents ?? []).filter((k) => isReal(k.target, k.time)).map((k) => k.time),
        kills2: (s.killEvents ?? []).filter((k) => isReal(k.target, k.time)).map((k) => ({ t: k.time, target: k.target!, solo: !!k.isSolo, smoke: !!k.isSmoke, x: k.positionX, y: k.positionY })),
        heroDamage: p.heroDamage ?? 0, towerDamage: p.towerDamage ?? 0, heroHealing: p.heroHealing ?? 0,
        wardsPlaced: (s.wards ?? []).length, wardsKilled: (s.wardDestruction ?? []).filter((w) => w.isWard).length,
        runes: (s.runes ?? []).filter((r) => r.action === "PICKUP" || r.action === "BOTTLE").map((r) => ({ t: r.time, rune: r.rune })),
      };
    });
    // неразобранный матч приходит без stats: только итог (KDA, золото, добивания за игру)
    const parsed = players.some((p) => p.lh.length > 0);
    const data: MatchData = {
      id: m.id, startDateTime: m.startDateTime, durationSeconds: m.durationSeconds, didRadiantWin: m.didRadiantWin, lobbyType: m.lobbyType ?? null,
      parsed, winRates: Array.isArray(m.winRates) && m.winRates.length ? m.winRates : null,
      laneOutcome: { top: m.topLaneOutcome ?? null, mid: m.midLaneOutcome ?? null, bottom: m.bottomLaneOutcome ?? null },
      players, at: Math.floor(Date.now() / 1000), v: V,
      towers: (Array.isArray(m.towerDeaths) ? m.towerDeaths : []).map((t: { time: number; isRadiant: boolean; attacker: number | null }) => ({ t: t.time, attacker: t.attacker ?? null, radiant: t.isRadiant })),
    };
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(data));
    return data;
  } catch { return null; }
}
