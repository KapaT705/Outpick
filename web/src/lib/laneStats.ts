// Исходы линий из Stratz (heroStats.laneOutcome): для героя на позиции, против какого героя на какой позиции
// сколько линий выиграно, проиграно и сыграно вничью у Divine/Immortal. По ним прогноз «твоя линия» до игры:
// это настоящие исходы линий, а не общий матчап героев. Кэш в USER_DIR/data/lanes/<hero>-<pos>.json на 14 дней.
import fs from "node:fs";
import path from "node:path";
import { USER_DIR } from "./paths";
import { readConfig } from "./config";

/** Линии героя (на своей позиции) против героя h на позиции pos: n линий, w выиграно, l проиграно, d вничью. */
export type LaneRow = { h: number; pos: number; n: number; w: number; l: number; d: number };
type Store = { heroId: number; position: number; rows: LaneRow[]; at: number };

const DIR = path.join(USER_DIR, "data", "lanes");
const TTL = 14 * 86400;
const SHRINK = 100; // линий, после которых исход пары весит как половина правды

function cached(heroId: number, position: number): LaneRow[] | null {
  try { const s = JSON.parse(fs.readFileSync(path.join(DIR, `${heroId}-${position}.json`), "utf8")) as Store; return Date.now() / 1000 - s.at < TTL ? s.rows : null; } catch { return null; }
}

/** Исходы линий героя на позиции против всех героев. Пустой список, если Stratz не ответил. */
export async function fetchLaneOutcomes(heroId: number, position: number): Promise<LaneRow[]> {
  const hit = cached(heroId, position);
  if (hit) return hit;
  const { stratzToken } = readConfig();
  if (!stratzToken || position < 1 || position > 5) return [];
  const q = `{ heroStats { laneOutcome(heroId: ${heroId}, isWith: false, bracketBasicIds: [DIVINE_IMMORTAL], positionIds: [POSITION_${position}]) { heroId2 position matchCount winCount lossCount drawCount } } }`;
  try {
    const r = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${stratzToken}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query: q }) });
    const j = await r.json();
    const raw: { heroId2: number; position: string | null; matchCount: number; winCount: number; lossCount: number; drawCount: number }[] = j?.data?.heroStats?.laneOutcome ?? [];
    if (!Array.isArray(raw) || !raw.length) return [];
    const rows: LaneRow[] = raw.map((x) => ({ h: x.heroId2, pos: Number(x.position?.replace("POSITION_", "")) || 0, n: x.matchCount, w: x.winCount, l: x.lossCount, d: x.drawCount }));
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, `${heroId}-${position}.json`), JSON.stringify({ heroId, position, rows, at: Math.floor(Date.now() / 1000) } as Store));
    return rows;
  } catch { return []; }
}

/** Доля выигранных линий против героя h на позиции pos (ничья за половину), прижатая к 0.5 при малом числе линий.
 *  Если на этой позиции данных нет, берутся линии против него на любой позиции. */
export function laneRate(rows: LaneRow[], h: number, pos: number): { rate: number; n: number } | null {
  const exact = rows.find((r) => r.h === h && r.pos === pos);
  const any = exact ?? rows.filter((r) => r.h === h).reduce<LaneRow | null>((a, r) => (a ? { ...a, n: a.n + r.n, w: a.w + r.w, l: a.l + r.l, d: a.d + r.d } : { ...r }), null);
  if (!any || any.n === 0) return null;
  const raw = (any.w + 0.5 * any.d) / any.n;
  return { rate: 0.5 + (raw - 0.5) * (any.n / (any.n + SHRINK)), n: any.n };
}
