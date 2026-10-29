import { NextResponse } from "next/server";
import { banAdvice } from "@/lib/draft";
import { loadData } from "@/lib/data";
import type { PoolOverride, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Совет по личному бан-листу для роли и пула (пул: автоматический по играм плюс ручные правки). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { role?: number; pool?: Partial<PoolOverride> };
  const role = [1, 2, 3, 4, 5].includes(Number(body.role)) ? (Number(body.role) as Role) : 2;
  const { pool } = loadData();
  const games = (p: { midGames: number; byRole?: Record<string, { games: number }> }) => p.byRole?.[String(role)]?.games ?? (role === 2 ? p.midGames : 0);
  const add = Array.isArray(body.pool?.add) ? body.pool!.add!.map(Number) : [], remove = Array.isArray(body.pool?.remove) ? body.pool!.remove!.map(Number) : [];
  const ids = [...new Set([...[...pool.values()].filter((p) => games(p) >= 10).map((p) => p.heroId), ...add])].filter((id) => !remove.includes(id));
  return NextResponse.json({ items: banAdvice(role, ids), poolSize: ids.length });
}
