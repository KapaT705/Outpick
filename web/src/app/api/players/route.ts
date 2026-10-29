import { NextResponse } from "next/server";
import { currentLobby, fetchPlayerStats } from "@/lib/players";
import { currentAccount } from "@/lib/accounts";

export const dynamic = "force-dynamic";

/** Игроки текущего матча (из server_log.txt Доты) со статистикой Stratz; свой слот по аккаунту. */
export async function GET() {
  const lobby = currentLobby();
  if (!lobby) return NextResponse.json({ lobby: null, players: [] });
  const stats = await fetchPlayerStats(lobby.players.map((p) => p.accountId));
  const me = currentAccount().id;
  const players = lobby.players.map((p) => ({ ...p, own: p.accountId === me, stats: stats.get(p.accountId) ?? null }));
  return NextResponse.json({ lobby: { lobbyId: lobby.lobbyId, mode: lobby.mode, at: lobby.at }, players });
}
