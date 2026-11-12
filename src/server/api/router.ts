/**
 * Framework-agnostic API router. The same function serves:
 *  - Next.js route handlers in LOCAL_DEMO (src/app/api/v1/[...path]/route.ts)
 *  - AWS Lambda behind API Gateway in AWS_PRODUCTION (src/lambda/api.ts)
 * so authorization, validation and business rules exist exactly once.
 */
import type { Actor } from "../auth/actor";
import { AppError, forbidden, notFound, unauthorized } from "../errors";
import type { Runtime } from "../runtime";
import { type ApiRequest, type ApiResponse, errorResponse, json, RateLimiter, type RouteDef } from "./http";
import { routes } from "./routes";

interface CompiledRoute {
  def: RouteDef;
  regex: RegExp;
  keys: string[];
}

const compiled: CompiledRoute[] = routes.map((def) => {
  const keys: string[] = [];
  const pattern = def.path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { def, keys, regex: new RegExp(`^${pattern}/?$`) };
});

const limiter = new RateLimiter();

function match(method: string, path: string) {
  let pathMatched = false;
  for (const r of compiled) {
    const m = r.regex.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.def.method !== method) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
    return { route: r.def, params };
  }
  if (pathMatched) throw new AppError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");
  throw notFound("Endpoint");
}

export interface RouterOptions {
  /** Restricts which route prefixes this deployment serves (per-Lambda least privilege). */
  allowedPrefixes?: string[];
}

export async function handleApiRequest(runtime: Runtime, req: ApiRequest, options: RouterOptions = {}): Promise<ApiResponse> {
  try {
    const { route, params } = match(req.method.toUpperCase(), req.path);
    if (options.allowedPrefixes && !options.allowedPrefixes.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
      throw notFound("Endpoint");
    }
    if (route.demoOnly && !runtime.demo) throw notFound("Endpoint");

    // 1. Authenticate: verify the bearer token's signature, expiry and audience.
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw unauthorized();
    const identity = await runtime.verifier.verify(token);

    // 2. Resolve the tenant and role from our own records, keyed by the verified subject.
    const user = await runtime.services.users.users.getBySub(identity.sub);
    if (!user) throw forbidden("Your account is not provisioned in GateKeeper.");

    limiter.check(`${user.userId}:${route.method}:${route.path}`, route.rateLimit ?? 120);

    let actor: Actor | null = null;
    if (user.status === "ACTIVE" && user.role) {
      // The role must be asserted by BOTH the identity provider group and our record.
      if (!identity.groups.includes(user.role)) {
        throw new AppError(403, "ROLE_MISMATCH", "Your session's role does not match your account. Sign in again.");
      }
      actor = {
        userId: user.userId,
        communityId: user.communityId,
        role: user.role,
        fullName: user.fullName,
        email: user.email,
        apartmentId: user.apartmentId,
        apartmentLabel: user.apartmentLabel,
      };
    }

    // 3. Authorize the route.
    if (route.access !== "authenticated") {
      if (!actor) {
        throw new AppError(
          403,
          user.status === "PENDING" ? "ACCOUNT_PENDING" : "ACCOUNT_INACTIVE",
          user.status === "PENDING" ? "Your registration is awaiting administrator approval." : "This account is not active.",
        );
      }
      if (Array.isArray(route.access) && !route.access.includes(actor.role)) throw forbidden();
    }

    const result = await route.handler({ runtime, req, params, user, actor: actor as Actor });
    if ("csv" in result) {
      return {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": req.requestId,
        },
        body: result.csv,
      };
    }
    return json(result.status ?? 200, { data: result.data }, req.requestId);
  } catch (err) {
    return errorResponse(err, req.requestId, (meta) => runtime.deps.logger.error("api.unhandled", { requestId: req.requestId, path: req.path, ...meta }));
  }
}
