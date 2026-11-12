import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminAnalyticsPage } from "@/features/admin/admin-overview";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return (
    <Suspense>
      <AdminAnalyticsPage />
    </Suspense>
  );
}
