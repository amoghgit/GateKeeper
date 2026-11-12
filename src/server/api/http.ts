import { z } from "zod";
import type { Role } from "@/shared/domain";
import type { Actor } from "../auth/actor";
import { AppError, isConditionFailed, tooManyRequests, validationError } from "../errors";
import { InvalidCursorError } from "../db/table";
import type { Runtime } from "../runtime";
import type { StoredUser } from "../repositories/user-repo";

export interface ApiRequest {
  method: string;
  /** Path relative to the API root, e.g. "/invitations/inv_123/approve". */
  path: string;
  query: URLSearchParams;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
  body: string | null;
  ip: string;
  requestId: string;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface RouteContext {
  runtime: Runtime;
  req: ApiRequest;
  params: Record<string, string>;
  /** Present for routes that require an ACTIVE account. */
  actor: Actor;
  user: StoredUser;
}

export type RouteResult = { status?: number; data: unknown } | { csv: string; filename: string };

export type Access = "authenticated" | "active" | Role[];

export interface RouteDef {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  access: Access;
  /** Requests per minute per user for this route (defaults to 120). */
  rateLimit?: number;
  demoOnly?: boolean;
  handler: (ctx: RouteContext) => Promise<RouteResult>;
}

const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function json(status: number, payload: unknown, requestId: string): ApiResponse {
  return { status, headers: { ...BASE_HEADERS, "X-Request-Id": requestId }, body: JSON.stringify(payload) };
}

export function errorResponse(err: unknown, requestId: string, log: (meta: Record<string, unknown>) => void): ApiResponse {
  if (err instanceof AppError) {
    return json(err.status, { error: { code: err.code, message: err.message, requestId, ...(err.details ? { details: err.details } : {}) } }, requestId);
  }
  if (err instanceof z.ZodError) {
    const flat = z.flattenError(err);
    const details: Record<string, string[]> = { ...flat.fieldErrors } as Record<string, string[]>;
    if (flat.formErrors.length) details._form = flat.formErrors;
    return errorResponse(validationError(details), requestId, log);
  }
  if (err instanceof InvalidCursorError) {
    return json(400, { error: { code: "BAD_CURSOR", message: "Invalid pagination cursor.", requestId } }, requestId);
  }
  if (isConditionFailed(err)) {
    return json(409, { error: { code: "CONFLICT", message: "The record changed. Refresh and try again.", requestId } }, requestId);
  }
  // Unknown failure: log internally, never leak details or stack traces.
  log({ errorName: (err as Error)?.name, errorMessage: (err as Error)?.message, stack: (err as Error)?.stack });
  return json(500, { error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again.", requestId } }, requestId);
}

export function parseWith<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const res = schema.safeParse(input);
  if (!res.success) throw res.error;
  return res.data;
}

export function readJson(req: ApiRequest): unknown {
  if (!req.body) return {};
  if (req.body.length > 64 * 1024) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  try {
    return JSON.parse(req.body);
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

export function queryObject(q: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  q.forEach((v, k) => {
    if (v !== "") out[k] = v;
  });
  return out;
}

/** Fixed-window limiter. Per-instance; API Gateway stage throttling covers the fleet. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  check(key: string, limit: number, windowMs = 60_000) {
    const now = Date.now();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (w.resetAt < now) this.windows.delete(k);
    }
    const w = this.windows.get(key);
    if (!w || w.resetAt < now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    w.count++;
    if (w.count > limit) throw tooManyRequests();
  }
}
