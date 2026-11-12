import type { Metadata } from "next";
import { Suspense } from "react";
import { ResidentDashboard } from "@/features/resident/resident-dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return (
    <Suspense>
      <ResidentDashboard />
    </Suspense>
  );
}
