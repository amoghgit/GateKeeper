import type { Metadata } from "next";
import { Suspense } from "react";
import { ResidentsPage } from "@/features/admin/people";

export const metadata: Metadata = { title: "Residents" };

export default function Page() {
  return (
    <Suspense>
      <ResidentsPage />
    </Suspense>
  );
}
