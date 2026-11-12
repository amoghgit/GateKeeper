import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityLog } from "@/features/security/security-pages";

export const metadata: Metadata = { title: "Activity log" };

export default function Page() {
  return (
    <Suspense>
      <ActivityLog />
    </Suspense>
  );
}
