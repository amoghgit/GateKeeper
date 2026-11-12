import type { Metadata } from "next";
import { Suspense } from "react";
import { InviteForm } from "@/features/resident/invite-form";

export const metadata: Metadata = { title: "Invite a visitor" };

export default function Page() {
  return (
    <Suspense>
      <InviteForm />
    </Suspense>
  );
}
