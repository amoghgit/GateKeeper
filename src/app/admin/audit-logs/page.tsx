import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditLogPage } from "@/features/admin/community";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return (
    <Suspense>
      <AuditLogPage />
    </Suspense>
  );
}
