import type { Metadata } from "next";
import { Suspense } from "react";
import { BuildingsPage } from "@/features/admin/property";

export const metadata: Metadata = { title: "Buildings" };

export default function Page() {
  return (
    <Suspense>
      <BuildingsPage />
    </Suspense>
  );
}
