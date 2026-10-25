import { NextResponse } from "next/server";
import { evaluateDraft } from "@/lib/draft";
import type { DraftInput, Pick, PoolOverride, Role } from "@/lib/types";

const ids = (v: unknown): number[] =>
  Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 60) : [];
const picks = (v: unknown): Pick[] =>
  Array.isArray(v)
    ? v
        .map((x) => (typeof x === "number" ? { id: x, role: null } : { id: Number(x?.id), role: [1, 2, 3, 4, 5].includes(Number(x?.role)) ? (Number(x.role) as Role) : null }))
        .filter((p) => Number.isInteger(p.id) && p.id > 0)
        .slice(0, 5)
    : [];

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<DraftInput>;
  const po = body.pool as Partial<PoolOverride> | undefined;
  const pool: PoolOverride = { add: ids(po?.add).slice(0, 60), remove: ids(po?.remove).slice(0, 60) };
  const role = [1, 2, 3, 4, 5].includes(Number(body.role)) ? (Number(body.role) as Role) : 2;
  const input: DraftInput = { bans: ids(body.bans), enemies: picks(body.enemies), allies: picks(body.allies), pool, role };
  return NextResponse.json(evaluateDraft(input));
}
