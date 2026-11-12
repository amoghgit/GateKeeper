import type { Metadata } from "next";
import { Suspense } from "react";
import { SecurityDashboard } from "@/features/security/security-pages";

export const metadata: Metadata = { title: "Gate overview" };

export default function Page() {
  return (
    <Suspense>
      <SecurityDashboard />
    </Suspense>
  );
}
