"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { registerSchema, verifyEmailSchema, type RegisterInput } from "@/shared/schemas";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { applyFieldErrors, authApi, errorMessage } from "@/lib/api-client";
import { AuthHeading, FormAlert, PasswordInput } from "./password-input";
import type { z } from "zod";

type CodeResponse = { status: string; demoCode?: string | null };

export function RegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"details" | "verify" | "done">("details");
  const [email, setEmail] = useState("");
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", email: "", phone: "", joinCode: "", unitNumber: "", password: "", confirmPassword: "" },
  });
  const verify = useForm<z.infer<typeof verifyEmailSchema>>({ resolver: zodResolver(verifyEmailSchema), defaultValues: { email: "", code: "" } });

  const onRegister = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await authApi.post<CodeResponse>("register", values);
      setEmail(values.email);
      verify.setValue("email", values.email);
      setDemoCode(res.demoCode ?? null);
      setStep("verify");
    } catch (err) {
      if (!applyFieldErrors(err, form.setError as never)) setError(errorMessage(err));
    }
  });

  const onVerify = verify.handleSubmit(async (values) => {
    setError(null);
    try {
      await authApi.post("verify-email", values);
      setStep("done");
    } catch (err) {
      if (!applyFieldErrors(err, verify.setError as never)) setError(errorMessage(err));
    }
  });

  const resend = async () => {
    try {
      const res = await authApi.post<CodeResponse>("resend-code", { email });
      setDemoCode(res.demoCode ?? null);
      toast.success("A new code is on its way");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (step === "done") {
    return (
      <div className="text-center">
        <span className="bg-success-soft text-success mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl">
          <MailCheck className="size-5" />
        </span>
        <AuthHeading
          title="E-mail verified"
          description="Your registration has been sent to your community administrator. You can sign in now — full access unlocks as soon as they approve your apartment."
        />
        <Button asChild size="lg" className="w-full">
          <Link href="/login">Continue to sign in</Link>
        </Button>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <>
        <AuthHeading title="Check your inbox" description={`We sent a 6-digit verification code to ${email}.`} />
        {demoCode && <FormAlert tone="info" message={`Demo mode: no e-mail was sent. Your simulated code is ${demoCode}.`} />}
        <form onSubmit={onVerify} className="mt-4 space-y-4" noValidate>
          <FormAlert message={error} />
          <Field label="Verification code" htmlFor="code" error={verify.formState.errors.code?.message}>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="font-mono tracking-[0.4em]"
              aria-invalid={!!verify.formState.errors.code}
              {...verify.register("code")}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={verify.formState.isSubmitting}>
            Verify e-mail
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={resend}>
            Resend code
          </Button>
        </form>
      </>
    );
  }

  const e = form.formState.errors;
  return (
    <>
      <AuthHeading
        title="Join your community"
        description={
          <>
            Use the community code from your association. Already registered?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </>
        }
      />
      <form onSubmit={onRegister} className="space-y-4" noValidate>
        <FormAlert message={error} />
        <Field label="Full name" htmlFor="fullName" error={e.fullName?.message}>
          <Input id="fullName" autoComplete="name" aria-invalid={!!e.fullName} {...form.register("fullName")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="E-mail" htmlFor="email" error={e.email?.message}>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!e.email} {...form.register("email")} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={e.phone?.message}>
            <Input id="phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" aria-invalid={!!e.phone} {...form.register("phone")} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Community code" htmlFor="joinCode" error={e.joinCode?.message} hint="e.g. LAKE2026 in the demo">
            <Input id="joinCode" className="uppercase" autoComplete="off" aria-invalid={!!e.joinCode} {...form.register("joinCode")} />
          </Field>
          <Field label="Unit number" htmlFor="unitNumber" error={e.unitNumber?.message}>
            <Input id="unitNumber" placeholder="A-1204" aria-invalid={!!e.unitNumber} {...form.register("unitNumber")} />
          </Field>
        </div>
        <Field label="Password" htmlFor="password" error={e.password?.message} hint="At least 10 characters with upper and lower case letters and a number.">
          <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!e.password} {...form.register("password")} />
        </Field>
        <Field label="Confirm password" htmlFor="confirmPassword" error={e.confirmPassword?.message}>
          <PasswordInput id="confirmPassword" autoComplete="new-password" aria-invalid={!!e.confirmPassword} {...form.register("confirmPassword")} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </>
  );
}
