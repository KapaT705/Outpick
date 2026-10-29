import { NextResponse } from "next/server";
import { snapshot } from "@/lib/gsi";
import { ensureAutoSync } from "@/lib/sync";
import { ensureAutoRefresh } from "@/lib/autoRefresh";
import { currentAccount } from "@/lib/accounts";

export const dynamic = "force-dynamic";
export async function GET() { ensureAutoSync(); ensureAutoRefresh(); return NextResponse.json({ ...snapshot(), account: currentAccount() }); }
