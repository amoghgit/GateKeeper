"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { MeResponse } from "@/shared/types";
import { api, errorMessage } from "./api-client";

export const queryKeys = {
  me: ["me"] as const,
  invitations: (scope: string, params?: unknown) => ["invitations", scope, params] as const,
  invitation: (id: string) => ["invitation", id] as const,
  notifications: (params?: unknown) => ["notifications", params] as const,
};

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<MeResponse>("/me"),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

/**
 * Cursor pagination with a back-stack so tables can offer Previous / Next.
 * Resets whenever the filter key changes.
 */
export function useCursorPager(resetKey: string) {
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setStack([undefined]);
  }
  const cursor = stack[stack.length - 1];
  const next = useCallback((c: string | null) => c && setStack((s) => [...s, c]), []);
  const prev = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  return { cursor, page: stack.length, next, prev, hasPrev: stack.length > 1 };
}

/** Mutation with toast feedback and cache invalidation. */
export function useAction<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string); invalidate?: QueryKey[]; onSuccess?: (r: TResult) => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(result) : opts.success);
      await Promise.all((opts.invalidate ?? []).map((key) => qc.invalidateQueries({ queryKey: key })));
      opts.onSuccess?.(result);
    },
    onError: (err) => {
      if (!opts.silentError) toast.error(errorMessage(err));
    },
  });
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Ticks every `ms` so relative times and durations stay fresh. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
