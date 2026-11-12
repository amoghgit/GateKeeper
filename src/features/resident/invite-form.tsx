"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Plus, Repeat, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { CATEGORY_LABELS, VISITOR_CATEGORIES } from "@/shared/domain";
import { inviteFormSchema, type InviteFormValues } from "@/shared/schemas";
import type { IssuedPass, KnownVisitor, Page } from "@/shared/types";
import { CATEGORY_ICONS } from "@/components/shared/badges";
import { PageHeader } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/overlays";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { api, applyFieldErrors } from "@/lib/api-client";
import { localDay } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { QrPass } from "@/features/invitations/qr-pass";

const pad = (n: number) => String(n).padStart(2, "0");

function defaults(): InviteFormValues {
  const start = new Date(Date.now() + 30 * 60_000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 3 * 3_600_000);
  return {
    fullName: "",
    phone: "",
    category: "GUEST",
    purpose: "",
    arrivalDate: localDay(start),
    arrivalTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
    departureDate: localDay(end),
    departureTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
    vehicleNumber: "",
    notes: "",
    usagePolicy: "SINGLE_USE",
    preApproved: true,
  };
}

/** Converts the local date/time fields into the server's ISO contract. */
export function toCreatePayload(v: InviteFormValues) {
  return {
    visitor: { fullName: v.fullName, phone: v.phone, category: v.category, purpose: v.purpose, vehicleNumber: v.vehicleNumber || undefined },
    expectedArrival: new Date(`${v.arrivalDate}T${v.arrivalTime}`).toISOString(),
    expectedDeparture: new Date(`${v.departureDate}T${v.departureTime}`).toISOString(),
    usagePolicy: v.usagePolicy,
    preApproved: v.preApproved,
    notes: v.notes || undefined,
  };
}

export function InviteForm() {
  const [issued, setIssued] = useState<IssuedPass | null>(null);
  const form = useForm<InviteFormValues>({ resolver: zodResolver(inviteFormSchema), defaultValues: defaults() });
  const e = form.formState.errors;
  const known = useQuery({ queryKey: ["visitors", "known"], queryFn: () => api.get<Page<KnownVisitor>>("/visitors") });
  const category = useWatch({ control: form.control, name: "category" });
  const multi = useWatch({ control: form.control, name: "usagePolicy" }) === "MULTI_USE";
  const arrivalDate = useWatch({ control: form.control, name: "arrivalDate" });

  const create = useAction((v: InviteFormValues) => api.post<IssuedPass>("/invitations", toCreatePayload(v)), {
    success: "Invitation created",
    invalidate: [["invitations"], ["overview"], ["visitors"]],
    onSuccess: setIssued,
    silentError: true,
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values);
    } catch (err) {
      const mapped = applyFieldErrors(err, form.setError as never, {
        "visitor.fullName": "fullName",
        "visitor.phone": "phone",
        "visitor.purpose": "purpose",
        "visitor.vehicleNumber": "vehicleNumber",
        expectedArrival: "arrivalTime",
        expectedDeparture: "departureTime",
      });
      if (!mapped) form.setError("root", { message: (err as Error).message });
    }
  });

  const prefill = (v: KnownVisitor) => {
    form.setValue("fullName", v.fullName, { shouldValidate: true });
    form.setValue("phone", v.phone, { shouldValidate: true });
    form.setValue("category", v.category);
    form.setValue("purpose", v.purpose, { shouldValidate: true });
    form.setValue("vehicleNumber", v.vehicleNumber ?? "");
  };

  if (issued) {
    return (
      <>
        <PageHeader title="Pass ready" description="Share the pass with your visitor. They show the QR code at the gate; security verifies it in seconds." />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,480px)_1fr]">
          <div data-testid="issued-pass">
            <QrPass invitation={issued.invitation} payload={issued.qrPayload} />
          </div>
          <Card className="h-fit">
            <CardContent className="space-y-4 pt-5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <CircleCheck className="text-success size-4" /> Invitation {issued.invitation.code} created
              </p>
              <ul className="text-muted-foreground space-y-2 text-[13px]">
                <li>• The QR contains only a random token — no personal details.</li>
                <li>• You can re-open, regenerate or cancel this pass from Invitations.</li>
                <li>• You&apos;ll be notified when your visitor enters and leaves.</li>
              </ul>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  onClick={() => {
                    setIssued(null);
                    form.reset(defaults());
                  }}
                >
                  <Plus /> Invite another
                </Button>
                <Button variant="secondary" asChild>
                  <Link href={`/resident/invitations?focus=${issued.invitation.invitationId}`}>View invitation</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Invite a visitor" description="Create a secure, time-limited pass. Your visitor will need it at the gate." />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <form onSubmit={onSubmit} noValidate className="space-y-6" aria-label="Invite visitor">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Visitor</CardTitle>
                <CardDescription>Who is coming and why</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium">Category</legend>
                <Controller
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {VISITOR_CATEGORIES.map((c) => {
                        const Icon = CATEGORY_ICONS[c];
                        const selected = field.value === c;
                        return (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            key={c}
                            onClick={() => field.onChange(c)}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] font-medium transition-colors",
                              selected ? "border-primary bg-primary-softer text-primary ring-primary/15 ring-2" : "border-border hover:border-border-strong",
                            )}
                          >
                            <Icon className="size-4" aria-hidden /> {CATEGORY_LABELS[c]}
                          </button>
                        );
                      })}
                    </div>
                  )}
                />
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" htmlFor="fullName" error={e.fullName?.message}>
                  <Input id="fullName" autoComplete="off" aria-invalid={!!e.fullName} {...form.register("fullName")} />
                </Field>
                <Field label="Phone number" htmlFor="phone" error={e.phone?.message}>
                  <Input id="phone" type="tel" placeholder="+91 98765 43210" aria-invalid={!!e.phone} {...form.register("phone")} />
                </Field>
              </div>
              <Field label="Purpose of visit" htmlFor="purpose" error={e.purpose?.message}>
                <Input
                  id="purpose"
                  placeholder={category === "DELIVERY" ? "e.g. Amazon parcel" : "e.g. Family dinner"}
                  aria-invalid={!!e.purpose}
                  {...form.register("purpose")}
                />
              </Field>
              <Field label="Vehicle registration" htmlFor="vehicleNumber" optional error={e.vehicleNumber?.message}>
                <Input
                  id="vehicleNumber"
                  className="uppercase"
                  placeholder="KA 01 AB 1234"
                  aria-invalid={!!e.vehicleNumber}
                  {...form.register("vehicleNumber")}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Schedule & access</CardTitle>
                <CardDescription>The pass works from one hour before arrival until the departure time.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Arrival date" htmlFor="arrivalDate" error={e.arrivalDate?.message}>
                  <Input id="arrivalDate" type="date" min={localDay()} {...form.register("arrivalDate")} />
                </Field>
                <Field label="Arrival time" htmlFor="arrivalTime" error={e.arrivalTime?.message}>
                  <Input id="arrivalTime" type="time" aria-invalid={!!e.arrivalTime} {...form.register("arrivalTime")} />
                </Field>
                <Field label="Departure date" htmlFor="departureDate" error={e.departureDate?.message}>
                  <Input id="departureDate" type="date" min={arrivalDate} {...form.register("departureDate")} />
                </Field>
                <Field label="Expected departure" htmlFor="departureTime" error={e.departureTime?.message}>
                  <Input id="departureTime" type="time" aria-invalid={!!e.departureTime} {...form.register("departureTime")} />
                </Field>
              </div>
              <Field
                label="Pass type"
                htmlFor="usagePolicy"
                hint={
                  multi
                    ? "Recurring passes suit domestic help — valid for repeated entries up to 31 days."
                    : "Single-use passes stop working after the visitor leaves."
                }
              >
                <NativeSelect id="usagePolicy" {...form.register("usagePolicy")}>
                  <option value="SINGLE_USE">Single visit</option>
                  <option value="MULTI_USE">Recurring (multiple entries)</option>
                </NativeSelect>
              </Field>
              <Controller
                control={form.control}
                name="preApproved"
                render={({ field }) => (
                  <label htmlFor="preApproved" className="border-border flex items-start justify-between gap-4 rounded-xl border p-4">
                    <span>
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <ShieldCheck className="text-primary size-4" /> Pre-approve entry
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        Turn off to require your confirmation before security can admit this visitor.
                      </span>
                    </span>
                    <Switch id="preApproved" checked={field.value} onCheckedChange={field.onChange} />
                  </label>
                )}
              />
              <Field label="Notes for security" htmlFor="notes" optional error={e.notes?.message}>
                <Textarea id="notes" placeholder="e.g. Please direct to the visitor parking bay" {...form.register("notes")} />
              </Field>
            </CardContent>
          </Card>

          {e.root?.message && (
            <p role="alert" className="bg-danger-soft text-danger rounded-lg px-4 py-3 text-sm">
              {e.root.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" asChild>
              <Link href="/resident/invitations">Cancel</Link>
            </Button>
            <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
              Create pass
            </Button>
          </div>
        </form>

        <aside>
          <Card className="sticky top-24">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Repeat className="text-primary size-4" /> Invite again
                </CardTitle>
                <CardDescription>People who have visited before</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {(known.data?.items ?? []).length === 0 ? (
                <p className="text-muted-foreground text-[13px]">Visitors you invite will appear here for one-tap re-invites.</p>
              ) : (
                <ul className="-mx-2 max-h-[420px] overflow-y-auto">
                  {known.data!.items.slice(0, 12).map((v) => {
                    const Icon = CATEGORY_ICONS[v.category];
                    return (
                      <li key={v.visitorId}>
                        <button
                          type="button"
                          onClick={() => prefill(v)}
                          className="hover:bg-surface-muted flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left"
                        >
                          <Icon className="text-muted-foreground size-4" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{v.fullName}</span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {v.purpose} · {v.visitCount} visit{v.visitCount === 1 ? "" : "s"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
