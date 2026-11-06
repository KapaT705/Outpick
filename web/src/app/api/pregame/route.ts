import { NextResponse } from "next/server";
import { buildPregame } from "@/lib/pregame";
import { currentAccount } from "@/lib/accounts";
import type { DraftInput, Pick, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const picks = (v: unknown): Pick[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "number" ? { id: x, role: null } : { id: Number(x?.id), role: [1, 2, 3, 4, 5].includes(Number(x?.role)) ? (Number(x.role) as Role) : null, slot: Number.isInteger(x?.slot) && x.slot >= 0 ? Number(x.slot) : undefined })).filter((p) => Number.isInteger(p.id) && p.id > 0).slice(0, 5) : [];

/** Прогноз на игру по полному драфту: {enemies, allies, chosenHeroId, role, team}. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<DraftInput> & { chosenHeroId?: number };
  const chosenHeroId = Number(body.chosenHeroId);
  if (!Number.isInteger(chosenHeroId) || chosenHeroId <= 0) return NextResponse.json({ ok: false, error: "нет твоего героя" }, { status: 400 });
  const role = [1, 2, 3, 4, 5].includes(Number(body.role)) ? (Number(body.role) as Role) : 2;
  const team = body.team === "radiant" || body.team === "dire" ? body.team : null;
  const input: DraftInput = { bans: [], enemies: picks(body.enemies), allies: picks(body.allies), role, team };
  const p = await buildPregame(input, chosenHeroId, currentAccount().id);
  return NextResponse.json({ ok: true, pregame: p });
}
