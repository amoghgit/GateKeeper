import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileForm } from "@/features/resident/profile-form";

export const metadata: Metadata = { title: "Profile" };

export default function Page() {
  return (
    <Suspense>
      <ProfileForm />
    </Suspense>
  );
}
