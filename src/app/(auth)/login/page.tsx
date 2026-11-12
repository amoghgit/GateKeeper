import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/login-form";
import { isDemoDisplay } from "@/server/display-mode";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const demo = await isDemoDisplay();
  return (
    <Suspense>
      <LoginForm demo={demo} />
    </Suspense>
  );
}
