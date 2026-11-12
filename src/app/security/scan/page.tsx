import type { Metadata } from "next";
import { Suspense } from "react";
import { ScanPage } from "@/features/security/scan-page";

export const metadata: Metadata = { title: "Scan pass" };

export default function Page() {
  return (
    <Suspense>
      <ScanPage />
    </Suspense>
  );
}
