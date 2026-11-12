import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { dashboardFor } from "@/shared/domain";
import { forgotPasswordSchema, loginSchema, newPasswordChallengeSchema, registerSchema, resetPasswordSchema, verifyEmailSchema } from "@/shared/schemas";
import type { MeResponse } from "@/shared/types";
import { errorResponse, RateLimiter } from "@/server/api/http";
import { clearSession, clientIp, COOKIE, getBff, isSameOrigin, writeSession } from "@/server/bff";
import { AppError, notFound } from "@/server/errors";
import { jsonLogger } from "@/server/ports";
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const limiter = new RateLimiter();
const LIMITS: Record<string, number> = {
  login: 10,
  "new-password": 10,
  register: 5,
  "verify-email": 10,
  "resend-code": 3,
  "forgot-password": 5,
  "reset-password": 10,
  logout: 30,
};

const ok = (data: unknown) => NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });

/**
 * LOCAL_DEMO only: no e-mail leaves the machine, so the simulated code from the
 * demo outbox is returned to the UI (labelled as such). Never in production.
 */
async function demoCodeFor(mode: string, email: string): Promise<string | null> {
  if (mode !== "LOCAL_DEMO") return null;
  const runtime = await getRuntime();
  const entry = (await runtime.demo?.outbox.list(20))?.find((e) => e.channel === "AUTH" && e.to === email);
  return entry ? (/\b(\d{6})\b/.exec(entry.body)?.[1] ?? null) : null;
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/auth/[action]">) {
  const requestId = randomUUID();
  try {
    const { action } = await ctx.params;
    if (!(action in LIMITS)) throw notFound("Endpoint");
    if (!isSameOrigin(request)) throw new AppError(403, "CSRF_REJECTED", "Cross-site request rejected.");
    const body: unknown = await request.json().catch(() => ({}));
    const email = typeof (body as { email?: unknown }).email === "string" ? (body as { email: string }).email.toLowerCase() : "";
    // Two independent budgets: per account (stops targeted guessing from many IPs)
    // and per client IP (stops one client spraying many accounts).
    if (email) limiter.check(`acct:${action}:${email}`, LIMITS[action]!);
    limiter.check(`ip:${action}:${clientIp(request)}`, LIMITS[action]! * 5);

    const bff = await getBff();
    const jar = await cookies();

    const finishSignIn = async (tokens: Parameters<typeof writeSession>[1]) => {
      writeSession(jar, tokens);
      const me = await bff.call({ method: "GET", path: "/me", token: tokens.accessToken, ip: clientIp(request) });
      if (me.status !== 200) {
        clearSession(jar);
        const parsed = JSON.parse(me.body) as { error?: { code: string; message: string } };
        throw new AppError(me.status, parsed.error?.code ?? "SIGN_IN_FAILED", parsed.error?.message ?? "Sign-in failed.");
      }
      const { data } = JSON.parse(me.body) as { data: MeResponse };
      return ok({
        status: "SIGNED_IN",
        role: data.profile.role,
        accountStatus: data.profile.status,
        redirectTo: dashboardFor(data.profile.status === "ACTIVE" ? data.profile.role : null),
      });
    };

    switch (action) {
      case "login": {
        const input = loginSchema.parse(body);
        const result = await bff.auth.login(input.email, input.password);
        if (result.kind === "newPasswordRequired") return ok({ status: "NEW_PASSWORD_REQUIRED", session: result.session });
        return await finishSignIn(result.tokens);
      }
      case "new-password": {
        const input = newPasswordChallengeSchema.parse(body);
        return await finishSignIn(await bff.auth.completeNewPassword(input.email, input.session, input.newPassword));
      }
      case "register": {
        const input = registerSchema.parse(body);
        await bff.auth.signUp(input);
        return ok({ status: "VERIFICATION_REQUIRED", demoCode: await demoCodeFor(bff.mode, input.email) });
      }
      case "verify-email": {
        const input = verifyEmailSchema.parse(body);
        await bff.auth.confirmSignUp(input.email, input.code);
        return ok({ status: "VERIFIED" });
      }
      case "resend-code": {
        const input = forgotPasswordSchema.parse(body);
        await bff.auth.resendCode(input.email);
        return ok({ status: "SENT", demoCode: await demoCodeFor(bff.mode, input.email) });
      }
      case "forgot-password": {
        const input = forgotPasswordSchema.parse(body);
        await bff.auth.forgotPassword(input.email);
        // Same response whether or not the account exists.
        return ok({ status: "CODE_SENT_IF_ACCOUNT_EXISTS", demoCode: await demoCodeFor(bff.mode, input.email) });
      }
      case "reset-password": {
        const input = resetPasswordSchema.parse(body);
        await bff.auth.confirmForgotPassword(input.email, input.code, input.password);
        return ok({ status: "PASSWORD_RESET" });
      }
      case "logout": {
        const token = jar.get(COOKIE.access)?.value;
        if (token) await bff.auth.logout(token);
        clearSession(jar);
        return ok({ status: "SIGNED_OUT" });
      }
    }
    throw notFound("Endpoint");
  } catch (err) {
    const res = errorResponse(err, requestId, (meta) => jsonLogger.error("auth.unhandled", { requestId, ...meta }));
    return new NextResponse(res.body, { status: res.status, headers: res.headers });
  }
}
