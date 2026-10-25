import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { refreshData, dataUpdatedAt } from "@/lib/refresh";

// Состояние обновления держим в памяти процесса: одно обновление за раз.
const state: { running: boolean; message: string; error: string | null; finishedAt: number | null } = { running: false, message: "", error: null, finishedAt: null };

export async function GET() {
  return NextResponse.json({ ...state, updatedAt: dataUpdatedAt() });
}

export async function POST() {
  if (state.running) return NextResponse.json({ ok: false, error: "уже идёт" }, { status: 409 });
  const { stratzToken, steamAccountId } = readConfig();
  if (!stratzToken) return NextResponse.json({ ok: false, error: "Сначала укажи токен Stratz в настройках" }, { status: 400 });
  state.running = true; state.error = null; state.message = "старт";
  refreshData(stratzToken, steamAccountId, (m) => { state.message = m; })
    .catch((e) => { state.error = String(e?.message ?? e); })
    .finally(() => { state.running = false; state.finishedAt = Math.floor(Date.now() / 1000); });
  return NextResponse.json({ ok: true });
}
