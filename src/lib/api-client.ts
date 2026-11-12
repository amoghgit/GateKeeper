/**
 * Browser API client. All calls go to same-origin /api/* routes; tokens are
 * held in httpOnly cookies and attached server-side.
 */
import type { ApiErrorBody } from "@/shared/types";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function toQuery(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function request<T>(base: string, method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}${toQuery(query)}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(0, "NETWORK", "Can't reach GateKeeper. Check your connection and try again.");
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = (parsed as ApiErrorBody | null)?.error;
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/login")) {
      const next = encodeURIComponent(window.location.pathname);
      // A hard navigation is intentional: it drops all cached client state after the session ends.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (!window.location.pathname.startsWith("/login")) window.location.assign(`/login?next=${next}&expired=1`);
    }
    throw new ApiClientError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? "Something went wrong.", err?.details);
  }
  return (parsed as { data: T }).data;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("/api/v1", "GET", path, undefined, query),
  post: <T>(path: string, body: unknown = {}) => request<T>("/api/v1", "POST", path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>("/api/v1", "PATCH", path, body),
  delete: <T>(path: string) => request<T>("/api/v1", "DELETE", path),
};

export const authApi = {
  post: <T>(action: string, body: unknown = {}) => request<T>("/api/auth", "POST", `/${action}`, body),
};

/** Downloads a CSV export through the authenticated proxy. */
export async function downloadFile(path: string, query: Query, fallbackName: string) {
  const res = await fetch(`/api/v1${path}${toQuery(query)}`, { credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiClientError(res.status, body?.error.code ?? "HTTP_ERROR", body?.error.message ?? "Export failed.");
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return "Something went wrong. Please try again.";
}

/** Maps server-side field errors onto react-hook-form fields. */
export function applyFieldErrors(err: unknown, setError: (name: never, e: { message: string }) => void, fieldMap: Record<string, string> = {}) {
  if (!(err instanceof ApiClientError) || !err.details) return false;
  let applied = false;
  for (const [key, messages] of Object.entries(err.details)) {
    const name = fieldMap[key] ?? key;
    if (messages[0] && name !== "_form") {
      setError(name as never, { message: messages[0] });
      applied = true;
    }
  }
  return applied;
}
