import type { Metadata } from "next";
import { Suspense } from "react";
import { ResidentNotifications } from "@/features/resident/resident-pages";

export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return (
    <Suspense>
      <ResidentNotifications />
    </Suspense>
  );
}
