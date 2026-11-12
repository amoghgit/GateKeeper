"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/shared/brand";
import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <LogoMark className="mb-6 size-10" />
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground mt-2 max-w-md text-sm">An unexpected error occurred while rendering this page. The issue has been logged.</p>
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>
          <RefreshCw /> Try again
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
