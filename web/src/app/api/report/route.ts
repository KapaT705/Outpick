import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { loadData } from "@/lib/data";
import { fetchMatchData } from "@/lib/matchData";
import { fetchBench } from "@/lib/bench";
import { buildReport, findMe, guessPosition } from "@/lib/report";

export const dynamic = "force-dynamic";

/** Отчёт по матчу: ?match=<id>&me=<steam32>&hero=<id на случай закрытого профиля>&fresh=1 (перезапросить Stratz). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = Number(q.get("match"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "нет номера матча" }, { status: 400 });
  const cfg = readConfig();
  if (!cfg.stratzToken) return NextResponse.json({ ok: false, error: "Укажи токен Stratz в настройках" });
  const m = await fetchMatchData(id, { fresh: q.get("fresh") === "1" });
  if (!m) return NextResponse.json({ ok: false, error: "Stratz не знает этот матч: возможно, все игроки скрыли профили или он ещё не подтянулся" });
  // кто «я»: аккаунт из ссылки, иначе любой свой аккаунт из настроек, который был в матче
  const asked = Number(q.get("me")) || null;
  const known = cfg.accounts.map((a) => a.id);
  const me = findMe(m, asked, Number(q.get("hero")) || null) ?? m.players.find((p) => p.steamAccountId && known.includes(p.steamAccountId)) ?? null;
  if (!me) return NextResponse.json({ ok: false, error: "В этом матче нет твоего аккаунта" });
  const { heroById } = loadData(null);
  const pos = guessPosition(me, heroById.get(me.heroId));
  const bench = pos ? await fetchBench(me.heroId, pos) : null;
  return NextResponse.json({ ok: true, report: buildReport(m, me, bench, heroById) });
}
