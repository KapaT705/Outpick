import { NextResponse } from "next/server";
import { readConfig, writeConfig } from "@/lib/config";

export async function GET() {
  const c = readConfig();
  return NextResponse.json({ steamAccountId: c.steamAccountId, hasToken: !!c.stratzToken, tokenTail: c.stratzToken ? c.stratzToken.slice(-6) : "" });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { stratzToken?: string; steamAccountId?: string | number };
  const cur = readConfig();
  const token = typeof body.stratzToken === "string" && body.stratzToken.trim() ? body.stratzToken.trim() : cur.stratzToken;
  const idRaw = String(body.steamAccountId ?? "").trim();
  let steamAccountId = cur.steamAccountId;
  if (idRaw) {
    const n = Number(idRaw);
    if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "Steam ID должен быть числом (32-битный id из ссылки Dotabuff/Stratz)" }, { status: 400 });
    steamAccountId = n > 76561197960265728 ? n - 76561197960265728 : n; // принимаем и 64-битный id
  }
  // проверим токен запросом к Stratz
  if (token) {
    const r = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query: "{ constants { gameVersions { id } } }" }) }).catch(() => null);
    if (!r || r.status !== 200) return NextResponse.json({ error: `Stratz не принял токен (HTTP ${r?.status ?? "нет ответа"})` }, { status: 400 });
  }
  writeConfig({ stratzToken: token, steamAccountId });
  return NextResponse.json({ ok: true, steamAccountId, hasToken: !!token });
}
