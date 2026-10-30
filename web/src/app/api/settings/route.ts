import { NextResponse } from "next/server";
import { readConfig, toSteam32, writeConfig } from "@/lib/config";
import { addAccount, currentAccount, listAccounts } from "@/lib/accounts";

export async function GET() {
  const c = readConfig();
  return NextResponse.json({ steamAccountId: c.steamAccountId, accounts: listAccounts(), current: currentAccount(), hasToken: !!c.stratzToken, tokenTail: c.stratzToken ? c.stratzToken.slice(-6) : "", hasGithubToken: !!c.githubToken, screenCapture: c.screenCapture !== false, onboardingDone: c.onboardingDone === true });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { stratzToken?: string; steamAccountId?: string | number; githubToken?: string; screenCapture?: boolean; onboardingDone?: boolean };
  const cur = readConfig();
  const token = typeof body.stratzToken === "string" && body.stratzToken.trim() ? body.stratzToken.trim() : cur.stratzToken;
  const idRaw = String(body.steamAccountId ?? "").trim();
  let steamAccountId = cur.steamAccountId;
  if (idRaw) {
    const n = toSteam32(idRaw);
    if (!n) return NextResponse.json({ error: "Steam ID должен быть числом (32-битный id из ссылки Dotabuff/Stratz)" }, { status: 400 });
    steamAccountId = n;
  }
  // новый токен проверяем запросом к Stratz; уже сохранённый не перепроверяем, иначе без интернета
  // не сохранить даже галочку чтения экрана
  const newToken = typeof body.stratzToken === "string" && body.stratzToken.trim() ? body.stratzToken.trim() : null;
  if (newToken) {
    const r = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${newToken}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query: "{ constants { gameVersions { id } } }" }) }).catch(() => null);
    if (!r) return NextResponse.json({ error: "Stratz не отвечает: проверь интернет и попробуй ещё раз" }, { status: 400 });
    if (r.status === 401 || r.status === 403) return NextResponse.json({ error: "Stratz не принял токен: проверь, что скопирован целиком со страницы stratz.com/api" }, { status: 400 });
    if (r.status !== 200) return NextResponse.json({ error: `Stratz ответил ошибкой HTTP ${r.status}, попробуй позже` }, { status: 400 });
  }
  const githubToken = typeof body.githubToken === "string" && body.githubToken.trim() ? body.githubToken.trim() : cur.githubToken;
  const screenCapture = typeof body.screenCapture === "boolean" ? body.screenCapture : cur.screenCapture !== false;
  const onboardingDone = typeof body.onboardingDone === "boolean" ? body.onboardingDone : cur.onboardingDone;
  writeConfig({ ...cur, stratzToken: token, steamAccountId, githubToken, screenCapture, onboardingDone });
  // новый Steam ID из поля настроек: это аккаунт по умолчанию и первый в списке
  if (steamAccountId && idRaw) addAccount(steamAccountId, undefined, true);
  return NextResponse.json({ ok: true, steamAccountId, accounts: listAccounts(), current: currentAccount(), hasToken: !!token, hasGithubToken: !!githubToken, screenCapture });
}
