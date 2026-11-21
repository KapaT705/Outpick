import { NextResponse, type NextRequest } from "next/server";

// Сервер программы слушает 127.0.0.1, и любая страница, открытая в браузере, может отправить ему запрос. Меняющие
// запросы (POST, DELETE и т. п.) принимаем только от самой программы: заголовка Origin нет (так шлёт Дота по GSI)
// или он указывает на 127.0.0.1 / localhost. Иначе чужой сайт мог бы поменять токен Stratz, аккаунты, историю
// или записать файл в папку Доты.
const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function proxy(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return NextResponse.next();
  const origin = req.headers.get("origin");
  if (!origin) return NextResponse.next();
  let host = "";
  try { host = new URL(origin).hostname; } catch {}
  if (LOCAL.has(host)) return NextResponse.next();
  return NextResponse.json({ ok: false, error: "запрос не от программы" }, { status: 403 });
}

export const config = { matcher: "/api/:path*" };
