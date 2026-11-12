"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Building2, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { loginSchema, passwordSchema, type LoginInput } from "@/shared/schemas";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/primitives";
import { Input } from "@/components/ui/primitives";
import { authApi, errorMessage } from "@/lib/api-client";
import { AuthHeading, FormAlert, PasswordInput } from "./password-input";

type LoginResponse = { status: "SIGNED_IN"; redirectTo: string } | { status: "NEW_PASSWORD_REQUIRED"; session: string };

export const DEMO_LOGINS = [
  { email: "resident@gatekeeper.demo", label: "Resident", detail: "Ananya · Tower A 1204", icon: UserRound },
  { email: "security@gatekeeper.demo", label: "Security", detail: "Ravi · Main gate", icon: ShieldCheck },
  { email: "admin@gatekeeper.demo", label: "Admin", detail: "Priya · Association office", icon: Building2 },
];
const DEMO_PASSWORD = "GateKeeper@2026";

const newPasswordForm = z
  .object({ newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(params.get("expired") ? "Your session expired. Please sign in again." : null);
  const [challenge, setChallenge] = useState<{ email: string; session: string } | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const pwForm = useForm<z.infer<typeof newPasswordForm>>({ resolver: zodResolver(newPasswordForm), defaultValues: { newPassword: "", confirm: "" } });

  const go = (redirectTo: string) => {
    const next = params.get("next");
    // Only same-site relative paths, and only into the area the server chose.
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") && next.split("/")[1] === redirectTo.split("/")[1] ? next : null;
    router.replace(safeNext ?? redirectTo);
    router.refresh();
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await authApi.post<LoginResponse>("login", values);
      if (res.status === "NEW_PASSWORD_REQUIRED") setChallenge({ email: values.email, session: res.session });
      else go(res.redirectTo);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const onNewPassword = pwForm.handleSubmit(async (values) => {
    if (!challenge) return;
    setError(null);
    try {
      const res = await authApi.post<{ redirectTo: string }>("new-password", { ...challenge, newPassword: values.newPassword });
      go(res.redirectTo);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  if (challenge) {
    return (
      <>
        <AuthHeading title="Choose a new password" description="Your administrator created this account with a temporary password. Set your own to continue." />
        <form onSubmit={onNewPassword} className="space-y-4" noValidate>
          <FormAlert message={error} />
          <Field
            label="New password"
            htmlFor="newPassword"
            error={pwForm.formState.errors.newPassword?.message}
            hint="At least 10 characters with upper and lower case letters and a number."
          >
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              aria-invalid={!!pwForm.formState.errors.newPassword}
              {...pwForm.register("newPassword")}
            />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={pwForm.formState.errors.confirm?.message}>
            <PasswordInput id="confirm" autoComplete="new-password" aria-invalid={!!pwForm.formState.errors.confirm} {...pwForm.register("confirm")} />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={pwForm.formState.isSubmitting}>
            Save password and continue
          </Button>
        </form>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title="Welcome back"
        description={
          <>
            Sign in to your community. New resident?{" "}
            <Link href="/register" className="text-primary font-medium hover:underline">
              Create an account
            </Link>
          </>
        }
      />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormAlert message={error} />
        <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={!!form.formState.errors.email}
            {...form.register("email")}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
          <PasswordInput id="password" autoComplete="current-password" aria-invalid={!!form.formState.errors.password} {...form.register("password")} />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-primary text-[13px] font-medium hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
          Sign in <ArrowRight />
        </Button>
      </form>

      {demo && (
        <div className="border-border-strong bg-surface mt-8 rounded-xl border border-dashed p-4">
          <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">Demo accounts · local only</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Password for all: <code className="bg-surface-muted text-foreground rounded px-1 py-0.5 font-mono">{DEMO_PASSWORD}</code>
          </p>
          <div className="mt-3 grid gap-2">
            {DEMO_LOGINS.map((d) => (
              <button
                key={d.email}
                type="button"
                aria-label={`Use the demo ${d.label.toLowerCase()} account`}
                onClick={() => {
                  form.setValue("email", d.email, { shouldValidate: true });
                  form.setValue("password", DEMO_PASSWORD, { shouldValidate: true });
                }}
                className="border-border hover:border-primary/40 hover:bg-primary-softer flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors"
              >
                <d.icon className="text-primary size-4" aria-hidden />
                <span className="flex-1">
                  <span className="block text-[13px] font-medium">{d.label}</span>
                  <span className="text-muted-foreground block text-xs">{d.email}</span>
                </span>
                <span className="text-muted-foreground text-xs">{d.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
