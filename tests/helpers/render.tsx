import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";

/** Replaces global fetch with a router of `METHOD path` → JSON body handlers; records calls. */
export function mockFetch(routes: Record<string, (body: unknown, url: URL) => unknown>) {
  const calls: { method: string; path: string; body: unknown; url: URL }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body, url });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: `No mock for ${method} ${url.pathname}` } }), { status: 404 });
    const result = handler(body, url);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify({ data: result }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

export function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
