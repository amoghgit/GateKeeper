import type { Metadata } from "next";
import { Suspense } from "react";
import { ResidentVisitors } from "@/features/resident/resident-pages";

export const metadata: Metadata = { title: "Visitor history" };

export default function Page() {
  return (
    <Suspense>
      <ResidentVisitors />
    </Suspense>
  );
}
