import type { Metadata } from "next";
import { Suspense } from "react";
import { ResidentInvitations } from "@/features/resident/resident-pages";

export const metadata: Metadata = { title: "Invitations" };

export default function Page() {
  return (
    <Suspense>
      <ResidentInvitations />
    </Suspense>
  );
}
