/**
 * Test harness: a fully wired LOCAL_DEMO runtime backed by an in-memory table,
 * a controllable clock, and helpers to call the real API router as any user.
 */
import { randomUUID } from "node:crypto";
import { handleApiRequest } from "@/server/api/router";
import { DemoTokenService } from "@/server/auth/tokens";
import { buildDemoRuntime, type Runtime } from "@/server/runtime";
import { DEMO_ACCOUNTS } from "@/server/demo/seed";

export interface Harness {
  runtime: Runtime;
  clock: { now: Date; advance(minutes: number): void };
  tokenFor(email: string): Promise<string>;
  call<T = unknown>(
    email: string | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T; error?: { code: string; message: string; details?: Record<string, string[]> } }>;
}

export async function createHarness(options: { seed?: boolean; start?: Date } = {}): Promise<Harness> {
  const clock = {
    now: options.start ?? new Date(),
    advance(minutes: number) {
      this.now = new Date(this.now.getTime() + minutes * 60_000);
    },
  };
  const secret = "test-secret-test-secret-test-secret";
  const runtime = await buildDemoRuntime(
    { mode: "LOCAL_DEMO", dataFile: null, sessionSecret: secret, qrPepper: "test-pepper", encryptionKey: "test-key" },
    { seed: options.seed ?? true, clock: () => clock.now },
  );
  const tokens = new DemoTokenService(secret);
  const tokenFor = async (email: string) => {
    const user = await runtime.deps.table.get({ PK: `DEMOAUTH#${email}`, SK: "CREDENTIAL" });
    if (!user) throw new Error(`No demo credential for ${email}`);
    return tokens.issue(user.sub as string, user.groups as never, "access", 3600);
  };
  const call: Harness["call"] = async (email, method, path, body) => {
    const [p, qs] = path.split("?");
    const res = await handleApiRequest(runtime, {
      method,
      path: p!,
      query: new URLSearchParams(qs ?? ""),
      headers: email ? { authorization: `Bearer ${await tokenFor(email)}` } : {},
      body: body === undefined ? null : JSON.stringify(body),
      ip: "test",
      requestId: randomUUID(),
    });
    const parsed = res.headers["Content-Type"]?.startsWith("text/csv") ? { data: res.body } : JSON.parse(res.body);
    return { status: res.status, data: parsed.data, error: parsed.error };
  };
  return { runtime, clock, tokenFor, call };
}

export { DEMO_ACCOUNTS };

export function isoIn(clockNow: Date, minutes: number) {
  return new Date(clockNow.getTime() + minutes * 60_000).toISOString();
}
