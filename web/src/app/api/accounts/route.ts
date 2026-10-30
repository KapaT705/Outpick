import { NextResponse } from "next/server";
import { readConfig, toSteam32 } from "@/lib/config";
import { addAccount, currentAccount, listAccounts, removeAccount, setDefaultAccount } from "@/lib/accounts";
import { loadData } from "@/lib/data";
import { startRefresh } from "@/lib/refreshState";

export const dynamic = "force-dynamic";

/** Пул текущего аккаунта по ролям для пикера: «в пуле» от 10 игр на роли, «знакомый» от 3. */
function poolSummary(accountId: number | null) {
  const { pool } = loadData(accountId);
  const games = (p: { midGames: number; byRole?: Record<string, { games: number }> }, r: number) => p.byRole?.[String(r)]?.games ?? (r === 2 ? p.midGames : 0);
  const wins = (p: { midWins: number; byRole?: Record<string, { wins: number }> }, r: number) => p.byRole?.[String(r)]?.wins ?? (r === 2 ? p.midWins : 0);
  const poolByRole: Record<number, number[]> = {}, familiarByRole: Record<number, number[]> = {};
  // счёт по героям на роли за год: окно «Мой пул» показывает, почему герой в пуле (10+ игр) и как на нём идёт
  const recordByRole: Record<number, Record<number, { games: number; wins: number }>> = {};
  for (const r of [1, 2, 3, 4, 5]) {
    poolByRole[r] = [...pool.values()].filter((p) => games(p, r) >= 10).map((p) => p.heroId);
    familiarByRole[r] = [...pool.values()].filter((p) => games(p, r) >= 3 && games(p, r) < 10).map((p) => p.heroId);
    recordByRole[r] = Object.fromEntries([...pool.values()].filter((p) => games(p, r) > 0).map((p) => [p.heroId, { games: games(p, r), wins: wins(p, r) }]));
  }
  return { poolByRole, familiarByRole, recordByRole };
}

/** Кто играет сейчас, список аккаунтов и пул текущего. */
export async function GET() {
  const current = currentAccount();
  return NextResponse.json({ current, accounts: listAccounts(), ...poolSummary(current.id) });
}

/**
 * Действия: add (добавить аккаунт и загрузить его историю из Stratz), load (загрузить историю известного),
 * default (сделать аккаунтом по умолчанию), remove (убрать из списка вместе с данными).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string | number };
  const id = toSteam32(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Steam ID должен быть числом" }, { status: 400 });
  const { stratzToken } = readConfig();
  switch (body.action) {
    case "add":
    case "load": {
      if (!stratzToken) return NextResponse.json({ error: "Сначала укажи токен Stratz" }, { status: 400 });
      addAccount(id);
      const r = startRefresh({ accountId: id, general: false });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
      return NextResponse.json({ ok: true, accounts: listAccounts(), current: currentAccount() });
    }
    case "default":
      if (!setDefaultAccount(id)) return NextResponse.json({ error: "Такого аккаунта нет в списке" }, { status: 404 });
      return NextResponse.json({ ok: true, accounts: listAccounts(), current: currentAccount() });
    case "remove":
      removeAccount(id);
      return NextResponse.json({ ok: true, accounts: listAccounts(), current: currentAccount() });
    default:
      return NextResponse.json({ error: "неизвестное действие" }, { status: 400 });
  }
}
