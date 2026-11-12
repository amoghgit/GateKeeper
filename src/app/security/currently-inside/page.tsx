import type { Metadata } from "next";
import { Suspense } from "react";
import { CurrentlyInside } from "@/features/security/security-pages";

export const metadata: Metadata = { title: "Currently inside" };

export default function Page() {
  return (
    <Suspense>
      <CurrentlyInside />
    </Suspense>
  );
}
