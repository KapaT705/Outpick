import { NextResponse } from "next/server";
import { receive, GSI_TOKEN, type GsiPayload } from "@/lib/gsi";

// Сюда шлёт Дота. Ответ должен быть быстрым и пустым.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as GsiPayload | null;
  if (!body) return new NextResponse(null, { status: 400 });
  if (body.auth?.token && body.auth.token !== GSI_TOKEN) return new NextResponse(null, { status: 403 });
  receive(body);
  return new NextResponse(null, { status: 200 });
}
