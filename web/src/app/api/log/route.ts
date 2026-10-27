import { NextResponse } from "next/server";
import { evaluateDraft } from "@/lib/draft";
import { appendLog, readLog, writeLog, type DraftLog, type LogRec } from "@/lib/log";
import type { DraftInput, Pick, PoolOverride, Role } from "@/lib/types";

const ids = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
const picks = (v: unknown): Pick[] =>
  Array.isArray(v)
    ? v.map((x) => ({ id: Number(x?.id), role: [1, 2, 3, 4, 5].includes(Number(x?.role)) ? (Number(x.role) as Role) : null })).filter((p) => p.id > 0).slice(0, 5)
    : [];

export async function GET() {
  const items = readLog().sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ items });
}

/** Сохранить драфт и выбранного героя. Оценки пересчитываются на сервере, чтобы в журнале была честная версия. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<DraftInput> & { chosenHeroId?: number; gsiMatchId?: string };
  const chosenHeroId = Number(body.chosenHeroId);
  if (!Number.isInteger(chosenHeroId) || chosenHeroId <= 0) return NextResponse.json({ error: "chosenHeroId required" }, { status: 400 });
  const po = body.pool as Partial<PoolOverride> | undefined;
  const role = [1, 2, 3, 4, 5].includes(Number(body.role)) ? (Number(body.role) as Role) : 2;
  const input: DraftInput = { bans: ids(body.bans), enemies: picks(body.enemies), allies: picks(body.allies), pool: { add: ids(po?.add), remove: ids(po?.remove) }, role };
  const { candidates, enemyRoles } = evaluateDraft(input);
  const rec = (i: number): LogRec => ({ heroId: candidates[i].heroId, name: candidates[i].name, finalScore: candidates[i].finalScore, draftScore: candidates[i].draftScore, rank: i + 1, poolStatus: candidates[i].poolStatus });
  const idx = candidates.findIndex((c) => c.heroId === chosenHeroId);
  const item: DraftLog = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Math.floor(Date.now() / 1000),
    bans: input.bans, enemies: input.enemies, allies: input.allies,
    enemyRoles: enemyRoles.map((g) => ({ id: g.id, role: g.role, locked: g.locked })),
    chosenHeroId,
    role,
    gsiMatchId: typeof body.gsiMatchId === "string" && /^\d+$/.test(body.gsiMatchId) ? body.gsiMatchId : undefined,
    chosen: idx >= 0 ? rec(idx) : null,
    topPool: candidates.map((c, i) => ({ c, i })).filter((x) => x.c.poolStatus !== "outside").slice(0, 5).map((x) => rec(x.i)),
    topAll: candidates.slice(0, 5).map((_, i) => rec(i)),
  };
  // Один матч — одна запись. Автозапись (по номеру матча из Доты) и ручное «взять» в том же матче сливаются:
  // запись с тем же номером матча или свежая (до 20 минут) с тем же героем заменяется, причём состав берётся
  // более полный, а номер матча и время первой записи сохраняются.
  const items = readLog();
  const dupIdx = items.findIndex((x) => (item.gsiMatchId && x.gsiMatchId === item.gsiMatchId) || (x.matchId == null && x.chosenHeroId === item.chosenHeroId && item.createdAt - x.createdAt < 20 * 60));
  if (dupIdx >= 0) {
    const old = items[dupIdx];
    const richer = <T,>(a: T[], b: T[]) => (b.length >= a.length ? b : a);
    items[dupIdx] = { ...item, id: old.id, createdAt: old.createdAt, gsiMatchId: item.gsiMatchId ?? old.gsiMatchId, enemies: richer(old.enemies, item.enemies), allies: richer(old.allies, item.allies), bans: richer(old.bans, item.bans) };
    writeLog(items);
    return NextResponse.json({ ok: true, item: items[dupIdx], replaced: true });
  }
  appendLog(item);
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const items = readLog().filter((x) => x.id !== id);
  writeLog(items);
  return NextResponse.json({ ok: true });
}
