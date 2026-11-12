"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";
import { ApiClientError } from "@/lib/api-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiClientError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          classNames: {
            toast: "!rounded-xl !border !border-border !bg-surface !text-foreground !shadow-[var(--shadow-raised)] !font-sans",
            description: "!text-muted-foreground",
          },
        }}
      />
    </QueryClientProvider>
  );
}
