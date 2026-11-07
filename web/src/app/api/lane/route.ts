import { NextResponse } from "next/server";
import { fetchLaneOutcomes, laneRate } from "@/lib/laneStats";
import { loadData } from "@/lib/data";

export const dynamic = "force-dynamic";

// Кто хорошо стоит на линии против соперников: по исходам линий Stratz у Divine/Immortal (lib/laneStats, кэш 14 дней).
// Stratz отдаёт линии соперника на его позиции против каждого героя, с которым тот стоял на линии; позицию этого героя
// данные не знают (поле position всегда POSITION_1, проверено 2026-11-07), поэтому на твою роль отбираем героев, которых
// на ней играют не реже ROLE_SHARE (доля позиций за 4 недели, как в остальном пикере). Для каждого берётся доля линий,
// проигранных ему соперником, и усредняется по соперникам линии (на миде один, на краях пара). Нужно минимум MIN_LANES
// линий против каждого соперника, иначе данных мало.
const MIN_LANES = 60;
const ROLE_SHARE = 0.15;
const role = (v: unknown) => ([1, 2, 3, 4, 5].includes(Number(v)) ? Number(v) : 0);

/** {pos: твоя позиция, vs: [{id, pos}] соперники линии} -> {ok, counters: [{heroId, rate, n}]} по убыванию rate. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { pos?: unknown; vs?: unknown };
  const pos = role(b.pos);
  const vs = (Array.isArray(b.vs) ? b.vs : []).map((x) => ({ id: Number(x?.id), pos: role(x?.pos) })).filter((x) => Number.isInteger(x.id) && x.id > 0 && x.pos).slice(0, 2);
  if (!pos || vs.length === 0) return NextResponse.json({ ok: false, error: "нет соперников по линии" }, { status: 400 });
  const tables = await Promise.all(vs.map((v) => fetchLaneOutcomes(v.id, v.pos)));
  if (tables.some((t) => t.length === 0)) return NextResponse.json({ ok: false, error: "Stratz не ответил" });
  const { positions } = loadData();
  const onRole = (h: number) => (positions.get(h)?.p?.[String(pos) as "1"] ?? 0) >= ROLE_SHARE;
  const ids = new Set(tables[0].filter((r) => r.n >= MIN_LANES && onRole(r.h)).map((r) => r.h));
  const counters: { heroId: number; rate: number; n: number }[] = [];
  for (const h of ids) {
    if (vs.some((v) => v.id === h)) continue;
    const rows = tables.map((t) => t.find((r) => r.h === h && r.n >= MIN_LANES) ?? null);
    if (rows.some((r) => !r)) continue;
    const rates = tables.map((t) => laneRate(t, h, 1)!);
    const avg = rates.reduce((a, r) => a + r.rate, 0) / rates.length;
    counters.push({ heroId: h, rate: +(1 - avg).toFixed(3), n: Math.min(...rates.map((r) => r.n)) });
  }
  counters.sort((a, b) => b.rate - a.rate);
  return NextResponse.json({ ok: true, counters: counters.slice(0, 30) });
}
