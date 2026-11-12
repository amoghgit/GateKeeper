import type { Metadata } from "next";
import { Suspense } from "react";
import { ApartmentsPage } from "@/features/admin/property";

export const metadata: Metadata = { title: "Apartments" };

export default function Page() {
  return (
    <Suspense>
      <ApartmentsPage />
    </Suspense>
  );
}
