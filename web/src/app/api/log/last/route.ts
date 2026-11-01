import { NextResponse } from "next/server";
import { readLog } from "@/lib/log";
import { readConfig } from "@/lib/config";
import { loadData } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Последний драфт с подтянутым результатом: для плашки «Разбор последнего матча готов» в пикере. */
export async function GET() {
  const cfg = readConfig();
  const x = readLog().filter((d) => d.won !== undefined && d.matchId).sort((a, b) => (b.syncedAt ?? b.createdAt) - (a.syncedAt ?? a.createdAt))[0];
  if (!x) return NextResponse.json({ ok: true, item: null });
  const acc = x.accountId ?? cfg.steamAccountId;
  const anonymous = !!cfg.accounts.find((a) => a.id === acc)?.anonymous; // у закрытого профиля Stratz матч не видит, разбора нет
  const { heroById } = loadData(null);
  return NextResponse.json({ ok: true, item: { id: x.id, matchId: x.matchId, heroId: x.chosenHeroId, heroName: heroById.get(x.chosenHeroId)?.name ?? null, won: x.won, accountId: acc, syncedAt: x.syncedAt ?? x.createdAt, canReport: !anonymous } });
}
