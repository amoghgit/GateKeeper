import type { Metadata } from "next";
import { Suspense } from "react";
import { AnnouncementsPage } from "@/features/admin/community";

export const metadata: Metadata = { title: "Announcements" };

export default function Page() {
  return (
    <Suspense>
      <AnnouncementsPage />
    </Suspense>
  );
}
