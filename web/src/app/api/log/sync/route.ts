import { NextResponse } from "next/server";
import { readLog, writeLog } from "@/lib/log";
import { readConfig } from "@/lib/config";
import { saveLabels } from "@/lib/labels";

type M = { id: number; startDateTime: number; durationSeconds: number; didRadiantWin: boolean; lobbyType: string; players: { steamAccountId: number; heroId: number; isRadiant: boolean; isVictory: boolean; playerSlot: number }[] };

/** Подтягивает результаты матчей для записей журнала без результата. */
export async function POST() {
  const { stratzToken: TOKEN, steamAccountId: ME } = readConfig();
  if (!TOKEN || !ME) return NextResponse.json({ error: "Укажи токен Stratz и Steam ID в настройках" }, { status: 400 });
  const items = readLog();
  const pending = items.filter((x) => x.matchId == null && !x.noMatch);
  if (pending.length === 0) return NextResponse.json({ ok: true, updated: 0, pending: 0 });
  const oldest = Math.min(...pending.map((x) => x.createdAt));

  const matches: M[] = [];
  for (let skip = 0; skip < 500; skip += 50) {
    const res = await fetch("https://api.stratz.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" },
      body: JSON.stringify({ query: `{ player(steamAccountId: ${ME}) { matches(request: {take: 50, skip: ${skip}}) { id startDateTime durationSeconds didRadiantWin lobbyType players { steamAccountId heroId isRadiant isVictory playerSlot } } } }` }),
    });
    const j = await res.json();
    const page: M[] = j?.data?.player?.matches ?? [];
    matches.push(...page);
    if (page.length < 50 || Math.min(...page.map((m) => m.startDateTime)) < oldest - 3600) break;
  }

  let updated = 0;
  const now = Math.floor(Date.now() / 1000);
  const labels: Parameters<typeof saveLabels>[0] = [];
  for (const rec of pending) {
    // матч должен начаться не раньше чем за 15 минут до сохранения драфта и не позже чем через 40 минут после
    const cands = matches.filter((m) => m.startDateTime >= rec.createdAt - 15 * 60 && m.startDateTime <= rec.createdAt + 40 * 60);
    const byId = rec.gsiMatchId ? matches.find((m) => String(m.id) === rec.gsiMatchId) : undefined;
    const hit = byId ?? cands.find((m) => {
      const me = m.players.find((p) => p.steamAccountId === ME);
      if (!me || me.heroId !== rec.chosenHeroId) return false;
      const enemyIds = m.players.filter((p) => p.isRadiant !== me.isRadiant).map((p) => p.heroId);
      const overlap = rec.enemies.filter((e) => enemyIds.includes(e.id)).length;
      return rec.enemies.length === 0 || overlap >= Math.min(2, rec.enemies.length);
    });
    if (hit) {
      const me = hit.players.find((p) => p.steamAccountId === ME)!;
      rec.matchId = hit.id; rec.won = me.isVictory; rec.durationSeconds = hit.durationSeconds; rec.syncedAt = now;
      updated++;
      // разметка слотов для самообучения портретов: порядок игроков в верхней панели = playerSlot
      const bySlot = (radiant: boolean) => hit.players.filter((p) => p.isRadiant === radiant).sort((a, b) => a.playerSlot - b.playerSlot).map((p) => p.heroId);
      labels.push({ matchId: String(hit.id), radiant: bySlot(true), dire: bySlot(false), at: now });
    } else if (now - rec.createdAt > 6 * 3600 && matches.some((m) => m.startDateTime > rec.createdAt + 40 * 60)) {
      // прошло много времени и есть более поздние матчи, а подходящего нет: игра не состоялась
      rec.noMatch = true; rec.syncedAt = now;
    }
  }
  writeLog(items);
  if (labels.length) saveLabels(labels);
  return NextResponse.json({ ok: true, updated, pending: pending.length - updated, fetched: matches.length });
}
