import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminVisitorsPage } from "@/features/admin/community";

export const metadata: Metadata = { title: "Visitors" };

export default function Page() {
  return (
    <Suspense>
      <AdminVisitorsPage />
    </Suspense>
  );
}
