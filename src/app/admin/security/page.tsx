import type { Metadata } from "next";
import { Suspense } from "react";
import { GuardsPage } from "@/features/admin/people";

export const metadata: Metadata = { title: "Security staff" };

export default function Page() {
  return (
    <Suspense>
      <GuardsPage />
    </Suspense>
  );
}
