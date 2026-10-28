import { NextResponse } from "next/server";
import { dataUpdatedAt } from "@/lib/refresh";
import { currentAccount } from "@/lib/accounts";
import { refreshState, startRefresh } from "@/lib/refreshState";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...refreshState(), updatedAt: dataUpdatedAt() });
}

/** Обновить общие данные меты и пул текущего аккаунта. */
export async function POST() {
  const r = startRefresh({ accountId: currentAccount().id, general: true });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.error === "уже идёт" ? 409 : 400 });
  return NextResponse.json({ ok: true });
}
