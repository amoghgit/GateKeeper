"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Lock } from "lucide-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { type NotificationType } from "@/shared/domain";
import { emergencyContactSchema, phoneSchema } from "@/shared/schemas";
import type { UserProfile } from "@/shared/types";
import { PageHeader } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/overlays";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Skeleton } from "@/components/ui/primitives";
import { api, applyFieldErrors } from "@/lib/api-client";
import { useAction, useMe } from "@/lib/hooks";

const profileForm = z
  .object({
    fullName: z.string().trim().min(2, "Full name must be at least 2 characters").max(80),
    phone: phoneSchema,
    emergencyName: z.string().trim().max(80),
    emergencyPhone: z.string().trim().max(24),
    email: z.boolean(),
    sms: z.boolean(),
    types: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    if (!v.emergencyName && !v.emergencyPhone) return;
    const r = emergencyContactSchema.safeParse({ name: v.emergencyName, phone: v.emergencyPhone });
    if (!r.success)
      for (const i of r.error.issues) ctx.addIssue({ code: "custom", path: [i.path[0] === "name" ? "emergencyName" : "emergencyPhone"], message: i.message });
  });
type ProfileValues = z.infer<typeof profileForm>;

const NOTIFY_OPTIONS: { type: NotificationType; label: string }[] = [
  { type: "VISITOR_REQUEST", label: "Visitor waiting for approval" },
  { type: "VISITOR_ARRIVAL", label: "Visitor arrived at the gate" },
  { type: "VISITOR_ENTRY", label: "Visitor entered" },
  { type: "VISITOR_EXIT", label: "Visitor left" },
  { type: "VISITOR_OVERDUE", label: "Visitor overstaying" },
  { type: "INVITATION_EXPIRED", label: "Unused pass expired" },
  { type: "ANNOUNCEMENT", label: "Community announcements" },
];

function ReadOnly({ label, value, id }: { label: string; value: string; id: string }) {
  return (
    <Field label={label} htmlFor={id} hint="Managed by your community administrator">
      <div className="relative">
        <Input id={id} value={value} readOnly disabled className="pr-9" />
        <Lock className="text-muted-foreground absolute top-1/2 right-3 size-3.5 -translate-y-1/2" aria-hidden />
      </div>
    </Field>
  );
}

export function ProfileForm() {
  const me = useMe();
  const profile = me.data?.profile;
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileForm) });
  const e = form.formState.errors;

  useEffect(() => {
    if (!profile) return;
    form.reset({
      fullName: profile.fullName,
      phone: profile.phone,
      emergencyName: profile.emergencyContact?.name ?? "",
      emergencyPhone: profile.emergencyContact?.phone ?? "",
      email: profile.notificationPrefs.email,
      sms: profile.notificationPrefs.sms,
      types: profile.notificationPrefs.types,
    });
  }, [profile, form]);

  const save = useAction(
    (v: ProfileValues) =>
      api.patch<UserProfile>("/me", {
        fullName: v.fullName,
        phone: v.phone,
        emergencyContact: v.emergencyName ? { name: v.emergencyName, phone: v.emergencyPhone } : null,
        notificationPrefs: { email: v.email, sms: v.sms, types: v.types },
      }),
    { success: "Profile saved", invalidate: [["me"]], silentError: true },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync(v);
    } catch (err) {
      if (!applyFieldErrors(err, form.setError as never, { "emergencyContact.phone": "emergencyPhone", "emergencyContact.name": "emergencyName" })) {
        form.setError("root", { message: (err as Error).message });
      }
    }
  });

  if (!profile) return <Skeleton className="h-96" />;

  return (
    <>
      <PageHeader title="Profile" description="Your contact details and how GateKeeper reaches you." />
      <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Personal details</CardTitle>
              <CardDescription>Shown to security when they contact you about a visitor.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Full name" htmlFor="fullName" error={e.fullName?.message}>
              <Input id="fullName" aria-invalid={!!e.fullName} {...form.register("fullName")} />
            </Field>
            <Field label="Phone" htmlFor="phone" error={e.phone?.message}>
              <Input id="phone" type="tel" aria-invalid={!!e.phone} {...form.register("phone")} />
            </Field>
            <ReadOnly id="email" label="E-mail" value={profile.email} />
            <div className="grid gap-4 sm:grid-cols-2">
              <ReadOnly id="apartment" label="Apartment" value={profile.apartmentLabel?.split(" · ")[1] ?? "Not assigned"} />
              <ReadOnly id="building" label="Building" value={profile.apartmentLabel?.split(" · ")[0] ?? "—"} />
            </div>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Emergency contact</CardTitle>
                <CardDescription>Used by security only in an emergency.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="emergencyName" error={e.emergencyName?.message}>
                <Input id="emergencyName" {...form.register("emergencyName")} />
              </Field>
              <Field label="Phone" htmlFor="emergencyPhone" error={e.emergencyPhone?.message}>
                <Input id="emergencyPhone" type="tel" {...form.register("emergencyPhone")} />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Notification preferences</CardTitle>
                <CardDescription>In-app notifications are always on. E-mail and SMS are delivered via Amazon SNS.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Controller
                control={form.control}
                name="email"
                render={({ field }) => (
                  <label className="flex items-center justify-between gap-4 text-sm">
                    <span>
                      E-mail notifications
                      <span className="text-muted-foreground block text-xs">You&apos;ll receive a one-time confirmation e-mail from AWS.</span>
                    </span>
                    <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="E-mail notifications" />
                  </label>
                )}
              />
              <Controller
                control={form.control}
                name="sms"
                render={({ field }) => (
                  <label className="flex items-center justify-between gap-4 text-sm">
                    <span>
                      SMS notifications
                      <span className="text-muted-foreground block text-xs">Only delivered if your community has enabled SMS.</span>
                    </span>
                    <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="SMS notifications" />
                  </label>
                )}
              />
              <Controller
                control={form.control}
                name="types"
                render={({ field }) => (
                  <fieldset className="border-border rounded-xl border p-4">
                    <legend className="text-muted-foreground px-1 text-xs font-medium">Send e-mail / SMS for</legend>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {NOTIFY_OPTIONS.map((o) => (
                        <label key={o.type} className="flex items-center gap-2.5 text-[13px]">
                          <Checkbox
                            checked={field.value?.includes(o.type)}
                            onCheckedChange={(c) => field.onChange(c ? [...(field.value ?? []), o.type] : (field.value ?? []).filter((t) => t !== o.type))}
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
              />
            </CardContent>
          </Card>
          {e.root?.message && <p className="text-danger text-sm">{e.root.message}</p>}
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
              Save changes
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
