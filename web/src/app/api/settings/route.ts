import { NextResponse } from "next/server";
import { readConfig, toSteam32, writeConfig } from "@/lib/config";
import { addAccount, currentAccount, listAccounts } from "@/lib/accounts";

export async function GET() {
  const c = readConfig();
  return NextResponse.json({ steamAccountId: c.steamAccountId, accounts: listAccounts(), current: currentAccount(), hasToken: !!c.stratzToken, tokenTail: c.stratzToken ? c.stratzToken.slice(-6) : "", hasGithubToken: !!c.githubToken, screenCapture: c.screenCapture !== false });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { stratzToken?: string; steamAccountId?: string | number; githubToken?: string; screenCapture?: boolean };
  const cur = readConfig();
  const token = typeof body.stratzToken === "string" && body.stratzToken.trim() ? body.stratzToken.trim() : cur.stratzToken;
  const idRaw = String(body.steamAccountId ?? "").trim();
  let steamAccountId = cur.steamAccountId;
  if (idRaw) {
    const n = toSteam32(idRaw);
    if (!n) return NextResponse.json({ error: "Steam ID должен быть числом (32-битный id из ссылки Dotabuff/Stratz)" }, { status: 400 });
    steamAccountId = n;
  }
  // проверим токен запросом к Stratz
  if (token) {
    const r = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query: "{ constants { gameVersions { id } } }" }) }).catch(() => null);
    if (!r || r.status !== 200) return NextResponse.json({ error: `Stratz не принял токен (HTTP ${r?.status ?? "нет ответа"})` }, { status: 400 });
  }
  const githubToken = typeof body.githubToken === "string" && body.githubToken.trim() ? body.githubToken.trim() : cur.githubToken;
  const screenCapture = typeof body.screenCapture === "boolean" ? body.screenCapture : cur.screenCapture !== false;
  writeConfig({ ...cur, stratzToken: token, steamAccountId, githubToken, screenCapture });
  // новый Steam ID из поля настроек: это аккаунт по умолчанию и первый в списке
  if (steamAccountId && idRaw) addAccount(steamAccountId, undefined, true);
  return NextResponse.json({ ok: true, steamAccountId, accounts: listAccounts(), current: currentAccount(), hasToken: !!token, hasGithubToken: !!githubToken, screenCapture });
}
