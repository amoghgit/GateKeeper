import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { clearSession, clientIp, COOKIE, getBff, isSameOrigin, writeSession } from "@/server/bff";

export const dynamic = "force-dynamic";

async function handle(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: { code: "CSRF_REJECTED", message: "Cross-site request rejected." } }, { status: 403 });
  }
  const bff = await getBff();
  const jar = await cookies();
  let token = jar.get(COOKIE.access)?.value ?? null;
  const refresh = jar.get(COOKIE.refresh)?.value;
  const expiresAt = Number(jar.get(COOKIE.expires)?.value ?? 0);

  // Transparent token refresh shortly before expiry.
  let refreshed = false;
  if (refresh && (!token || expiresAt - Date.now() < 60_000)) {
    try {
      const tokens = await bff.auth.refresh(refresh);
      writeSession(jar, tokens);
      token = tokens.accessToken;
      refreshed = true;
    } catch {
      clearSession(jar);
      token = null;
    }
  }

  const path = request.nextUrl.pathname.replace(/^\/api\/v1/, "") || "/";
  const body = ["GET", "HEAD"].includes(request.method) ? null : await request.text();
  const call = (t: string | null) =>
    bff.call({ method: request.method, path, query: request.nextUrl.searchParams.toString(), token: t, body, ip: clientIp(request) });

  let res = await call(token);
  // A role change (e.g. registration approved) only appears in a refreshed token.
  if (res.status === 403 && !refreshed && refresh && res.body.includes("ROLE_MISMATCH")) {
    try {
      const tokens = await bff.auth.refresh(refresh);
      writeSession(jar, tokens);
      res = await call(tokens.accessToken);
    } catch {
      /* fall through with the original response */
    }
  }
  if (res.status === 401) clearSession(jar);
  return new NextResponse(res.body, { status: res.status, headers: res.headers });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
