import { NextResponse } from "next/server";
import { snapshot } from "@/lib/gsi";
import { ensureAutoSync } from "@/lib/sync";

export const dynamic = "force-dynamic";
export async function GET() { ensureAutoSync(); return NextResponse.json(snapshot()); }
