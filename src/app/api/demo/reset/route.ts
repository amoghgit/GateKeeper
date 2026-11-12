import { NextResponse } from "next/server";
import { resolveMode } from "@/server/config";
import { resetDemoRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

/**
 * Restores the seeded demo dataset. Exists only in LOCAL_DEMO and only when
 * DEMO_ALLOW_RESET=true (set by the Playwright configuration).
 */
export async function POST() {
  if (resolveMode() !== "LOCAL_DEMO" || process.env.DEMO_ALLOW_RESET !== "true") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  try {
    await resetDemoRuntime();
    return NextResponse.json({ data: { reset: true } });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "demo.reset_failed", error: (err as Error).name }));
    return NextResponse.json({ error: { code: "RESET_FAILED", message: "Demo reset failed." } }, { status: 500 });
  }
}
