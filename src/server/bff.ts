/**
 * Backend-for-frontend helpers used only by Next.js route handlers.
 *
 * Tokens never reach browser JavaScript: they live in httpOnly cookies, and
 * every data call goes through /api/v1/* where the access token is attached
 * server-side. In LOCAL_DEMO the call is served in-process by the shared
 * router; in AWS_PRODUCTION it is forwarded to API Gateway (+ Lambda), which
 * verifies the Cognito token again.
 */
import { randomUUID } from "node:crypto";
import { handleApiRequest } from "./api/router";
import { type AuthGateway, type AuthTokens, CognitoAuthGateway } from "./auth/gateway";
import { ConfigurationError, resolveMode } from "./config";
import { getRuntime } from "./runtime";

export const COOKIE = {
  access: "gk_at",
  refresh: "gk_rt",
  expires: "gk_exp",
} as const;

export interface BffContext {
  mode: "LOCAL_DEMO" | "AWS_PRODUCTION";
  auth: AuthGateway;
  call(input: {
    method: string;
    path: string;
    query?: string;
    token: string | null;
    body?: string | null;
    ip: string;
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

let prodContext: BffContext | null = null;

export async function getBff(): Promise<BffContext> {
  const mode = resolveMode();
  if (mode === "LOCAL_DEMO") {
    const runtime = await getRuntime();
    return {
      mode,
      auth: runtime.auth,
      call: async ({ method, path, query, token, body, ip }) =>
        handleApiRequest(runtime, {
          method,
          path,
          query: new URLSearchParams(query ?? ""),
          headers: token ? { authorization: `Bearer ${token}` } : {},
          body: body ?? null,
          ip,
          requestId: randomUUID(),
        }),
    };
  }
  if (!prodContext) {
    const clientId = process.env.COGNITO_CLIENT_ID;
    const apiBase = process.env.API_BASE_URL;
    if (!clientId || !apiBase || !process.env.AWS_REGION) {
      throw new ConfigurationError("AWS_PRODUCTION web tier requires COGNITO_CLIENT_ID, API_BASE_URL and AWS_REGION");
    }
    prodContext = {
      mode,
      auth: new CognitoAuthGateway(clientId),
      call: async ({ method, path, query, token, body }) => {
        const res = await fetch(`${apiBase.replace(/\/$/, "")}/v1${path}${query ? `?${query}` : ""}`, {
          method,
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ?? undefined,
          cache: "no-store",
        });
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          if (["content-type", "content-disposition", "x-request-id", "cache-control"].includes(k)) headers[k] = v;
        });
        return { status: res.status, headers, body: await res.text() };
      },
    };
  }
  return prodContext;
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.GATEKEEPER_INSECURE_COOKIES !== "true",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export interface CookieWriter {
  set(name: string, value: string, options: ReturnType<typeof cookieOptions>): void;
}

export function writeSession(cookies: CookieWriter, tokens: AuthTokens) {
  const accessAge = Math.max(60, Math.floor((tokens.expiresAt - Date.now()) / 1000));
  cookies.set(COOKIE.access, tokens.accessToken, cookieOptions(accessAge));
  cookies.set(COOKIE.expires, String(tokens.expiresAt), cookieOptions(accessAge));
  if (tokens.refreshToken) cookies.set(COOKIE.refresh, tokens.refreshToken, cookieOptions(30 * 24 * 3600));
}

export function clearSession(cookies: CookieWriter) {
  for (const name of Object.values(COOKIE)) cookies.set(name, "", cookieOptions(0));
}

/** Rejects cross-site state-changing requests (CSRF defence in depth on top of SameSite=Lax). */
export function isSameOrigin(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Client IP for rate limiting. X-Forwarded-For is a list each proxy appends to,
 * so only entries added by *our* proxies can be trusted: the left-most value is
 * whatever the client chose to send. TRUSTED_PROXY_COUNT is the number of
 * proxies in front of the app (1 for a single load balancer / CDN; 0 when the
 * app is reached directly, in which case XFF is ignored entirely).
 */
export function clientIp(request: Request, trustedProxies = Number(process.env.TRUSTED_PROXY_COUNT ?? "1")): string {
  const hops = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (trustedProxies <= 0 || hops.length === 0) return "direct";
  return hops[Math.max(0, hops.length - trustedProxies)] ?? "direct";
}
