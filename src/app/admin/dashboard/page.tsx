import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminDashboard } from "@/features/admin/admin-overview";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return (
    <Suspense>
      <AdminDashboard />
    </Suspense>
  );
}
