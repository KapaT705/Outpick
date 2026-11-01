import { NextResponse } from "next/server";
import { accountMatches, matchNorms } from "@/lib/accountMatches";

export const dynamic = "force-dynamic";

/** Рейтинговые матчи аккаунта из Stratz и нормы героев для сводок: ?acc=<steam32>&force=1. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const acc = Number(q.get("acc"));
  if (!Number.isInteger(acc) || acc <= 0) return NextResponse.json({ ok: false, error: "нет аккаунта" }, { status: 400 });
  const r = await accountMatches(acc, q.get("force") === "1");
  const norms = await matchNorms(r.items);
  return NextResponse.json({ ok: true, acc, items: r.items, at: r.at, error: r.error ?? null, norms });
}
