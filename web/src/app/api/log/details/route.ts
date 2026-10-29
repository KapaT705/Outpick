import { NextResponse } from "next/server";
import { readLog, writeLog } from "@/lib/log";
import { readConfig } from "@/lib/config";
import { attachDetails } from "@/lib/sync";

export const dynamic = "force-dynamic";

/** Разбор матча для старой записи (у новых он появляется при синхронизации). */
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const items = readLog();
  const rec = items.find((x) => x.id === id);
  if (!rec) return NextResponse.json({ error: "нет такой записи" }, { status: 404 });
  if (!rec.matchId) return NextResponse.json({ error: "у записи ещё нет результата" }, { status: 400 });
  const ME = rec.accountId ?? readConfig().steamAccountId ?? 0;
  rec.details = undefined;
  await attachDetails(rec, ME);
  writeLog(items);
  return NextResponse.json({ ok: true, item: rec });
}
