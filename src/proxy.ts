import { NextResponse, type NextRequest } from "next/server";

/**
 * Coarse route protection: dashboard pages require a session cookie. This is a
 * UX guard only — every API call is authenticated and authorized server-side,
 * and role layouts redirect users who open another role's area.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("gk_at") || request.cookies.has("gk_rt");
  if (!hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/resident/:path*", "/security/:path*", "/admin/:path*", "/pending"],
};
