import type { Metadata } from "next";
import { Suspense } from "react";
import { ManualEntry } from "@/features/security/manual-entry";

export const metadata: Metadata = { title: "Manual entry" };

export default function Page() {
  return (
    <Suspense>
      <ManualEntry />
    </Suspense>
  );
}
