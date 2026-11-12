"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { forgotPasswordSchema, resetPasswordSchema } from "@/shared/schemas";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { applyFieldErrors, authApi, errorMessage } from "@/lib/api-client";
import { AuthHeading, FormAlert, PasswordInput } from "./password-input";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      const res = await authApi.post<{ demoCode?: string | null }>("forgot-password", { email });
      const qs = new URLSearchParams({ email });
      if (res.demoCode) qs.set("demo", res.demoCode);
      router.push(`/reset-password?${qs.toString()}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <>
      <AuthHeading title="Reset your password" description="Enter the e-mail on your account. If it exists, we'll send a 6-digit reset code." />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormAlert message={error} />
        <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          <KeyRound /> Send reset code
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/login">
            <ArrowLeft /> Back to sign in
          </Link>
        </Button>
      </form>
    </>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const demoCode = params.get("demo");
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: params.get("email") ?? "", code: "", password: "", confirmPassword: "" },
  });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await authApi.post("reset-password", values);
      toast.success("Password updated. Sign in with your new password.");
      router.replace("/login");
    } catch (err) {
      if (!applyFieldErrors(err, form.setError as never)) setError(errorMessage(err));
    }
  });

  return (
    <>
      <AuthHeading title="Set a new password" description="Enter the code we e-mailed you and choose a new password." />
      {demoCode && <FormAlert tone="info" message={`Demo mode: no e-mail was sent. Your simulated reset code is ${demoCode}.`} />}
      <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
        <FormAlert message={error} />
        <Field label="E-mail" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!e.email} {...form.register("email")} />
        </Field>
        <Field label="Reset code" htmlFor="code" error={e.code?.message}>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="font-mono tracking-[0.4em]"
            aria-invalid={!!e.code}
            {...form.register("code")}
          />
        </Field>
        <Field
          label="New password"
          htmlFor="password"
          error={e.password?.message}
          hint="At least 10 characters with upper and lower case letters and a number."
        >
          <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!e.password} {...form.register("password")} />
        </Field>
        <Field label="Confirm password" htmlFor="confirmPassword" error={e.confirmPassword?.message}>
          <PasswordInput id="confirmPassword" autoComplete="new-password" aria-invalid={!!e.confirmPassword} {...form.register("confirmPassword")} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </>
  );
}
