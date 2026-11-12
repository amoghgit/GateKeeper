import { connection } from "next/server";
import { resolveMode } from "./config";

/**
 * Whether demo-only UI (banner, demo credentials, demo tools) should render.
 * Awaiting connection() forces request-time evaluation, so the decision follows
 * the deployed environment rather than whatever was set during `next build`.
 * A misconfigured environment is treated as "not demo" — never the reverse.
 */
export async function isDemoDisplay(): Promise<boolean> {
  await connection();
  try {
    return resolveMode() === "LOCAL_DEMO";
  } catch {
    return false;
  }
}
