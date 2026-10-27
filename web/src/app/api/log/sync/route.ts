import { NextResponse } from "next/server";
import { syncResults } from "@/lib/sync";

/** Подтягивает результаты матчей для записей журнала без результата (логика в lib/sync, та же работает по таймеру). */
export async function POST() {
  const r = await syncResults();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
