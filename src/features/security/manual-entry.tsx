"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Camera, Search, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { CATEGORY_LABELS, VISITOR_CATEGORIES } from "@/shared/domain";
import { walkInFormSchema, type WalkInFormValues } from "@/shared/schemas";
import type { Apartment, Invitation, UploadTicket } from "@/shared/types";
import { CategoryLabel, StatusBadge } from "@/components/shared/badges";
import { EmptyState, PageHeader } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { api, applyFieldErrors, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { InvitationDialog } from "@/features/invitations/invitation-dialog";

const MAX_PHOTO = 2 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Requests a signed upload ticket, then PUTs the file directly to storage (S3 in production). */
async function uploadPhoto(file: File): Promise<string> {
  const ticket = await api.post<UploadTicket>("/uploads", { contentType: file.type, size: file.size });
  const res = await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: file });
  if (!res.ok) throw new Error("Photo upload failed");
  return ticket.objectKey;
}

function Lookup({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const results = useQuery({
    queryKey: ["lookup", submitted],
    queryFn: () => api.get<Invitation[]>("/security/lookup", { q: submitted }),
    enabled: submitted.length >= 2,
  });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Find an invitation</CardTitle>
          <CardDescription>Search by gate code, invitation ID, phone number or visitor name.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(q.trim());
          }}
        >
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
            <Input aria-label="Lookup query" value={q} onChange={(e) => setQ(e.target.value)} placeholder="K7Q-4MX, 98765 43210 or Rahul" className="pl-9" />
          </div>
          <Button type="submit" loading={results.isFetching} disabled={q.trim().length < 2}>
            Search
          </Button>
        </form>
        {submitted && results.data && results.data.length === 0 && (
          <EmptyState icon={Search} title="No matching invitations" description="Register them as a walk-in instead." className="py-8" />
        )}
        {results.data && results.data.length > 0 && (
          <ul className="divide-border border-border divide-y rounded-xl border" data-testid="lookup-results">
            {results.data.map((i) => (
              <li key={i.invitationId}>
                <button className="hover:bg-surface-muted/60 flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => onOpen(i.invitationId)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{i.visitor.fullName}</span>
                    <span className="text-muted-foreground block text-xs">
                      {i.apartmentLabel} · <span className="font-mono">{i.code}</span> · {formatDateTime(i.expectedArrival)}
                    </span>
                  </span>
                  <StatusBadge status={i.status} overdue={i.overdue} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function WalkInForm({ onCreated }: { onCreated: (inv: Invitation) => void }) {
  const apartments = useQuery({ queryKey: ["apartments"], queryFn: () => api.get<Apartment[]>("/apartments") });
  const [photo, setPhoto] = useState<File | null>(null);
  const form = useForm<WalkInFormValues>({
    resolver: zodResolver(walkInFormSchema),
    defaultValues: { fullName: "", phone: "", category: "DELIVERY", purpose: "", vehicleNumber: "", apartmentId: "", notes: "" },
  });
  const e = form.formState.errors;
  const create = useAction(
    async (v: WalkInFormValues) => {
      const photoKey = photo ? await uploadPhoto(photo) : undefined;
      return api.post<Invitation>("/security/manual-entry", {
        visitor: { fullName: v.fullName, phone: v.phone, category: v.category, purpose: v.purpose, vehicleNumber: v.vehicleNumber || undefined },
        apartmentId: v.apartmentId,
        notes: v.notes || undefined,
        photoKey,
      });
    },
    {
      success: (i) => (i.status === "PENDING_APPROVAL" ? "Walk-in registered — the resident has been asked to approve." : "Walk-in registered and approved."),
      invalidate: [["overview"], ["activity"], ["invitations"]],
      silentError: true,
    },
  );

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const inv = await create.mutateAsync(v);
      form.reset();
      setPhoto(null);
      onCreated(inv);
    } catch (err) {
      if (
        !applyFieldErrors(err, form.setError as never, {
          "visitor.fullName": "fullName",
          "visitor.phone": "phone",
          "visitor.purpose": "purpose",
          "visitor.vehicleNumber": "vehicleNumber",
        })
      ) {
        toast.error(errorMessage(err));
      }
    }
  });

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return toast.error("Use a JPEG, PNG or WebP image.");
    if (file.size > MAX_PHOTO) return toast.error("Images must be 2 MB or smaller.");
    setPhoto(file);
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="text-primary size-4" /> Register a walk-in
          </CardTitle>
          <CardDescription>For visitors without a pass. The apartment is notified to approve before entry.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Register walk-in">
          <Field label="Visiting apartment" htmlFor="apartmentId" error={e.apartmentId?.message}>
            <NativeSelect id="apartmentId" aria-invalid={!!e.apartmentId} {...form.register("apartmentId")}>
              <option value="">Select apartment…</option>
              {apartments.data?.map((a) => (
                <option key={a.apartmentId} value={a.apartmentId}>
                  {a.buildingName} · {a.unitNumber}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Visitor name" htmlFor="w-fullName" error={e.fullName?.message}>
              <Input id="w-fullName" aria-invalid={!!e.fullName} {...form.register("fullName")} />
            </Field>
            <Field label="Phone" htmlFor="w-phone" error={e.phone?.message}>
              <Input id="w-phone" type="tel" aria-invalid={!!e.phone} {...form.register("phone")} />
            </Field>
            <Field label="Category" htmlFor="w-category">
              <NativeSelect id="w-category" {...form.register("category")}>
                {VISITOR_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Vehicle" htmlFor="w-vehicle" optional error={e.vehicleNumber?.message}>
              <Input id="w-vehicle" className="uppercase" {...form.register("vehicleNumber")} />
            </Field>
          </div>
          <Field label="Purpose" htmlFor="w-purpose" error={e.purpose?.message}>
            <Input id="w-purpose" placeholder="e.g. Swiggy order" aria-invalid={!!e.purpose} {...form.register("purpose")} />
          </Field>
          <Field label="Notes" htmlFor="w-notes" optional>
            <Textarea id="w-notes" className="min-h-16" {...form.register("notes")} />
          </Field>
          <div className="border-border-strong flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-3">
            <Camera className="text-muted-foreground size-4" aria-hidden />
            {photo ? (
              <span className="flex flex-1 items-center gap-2 text-[13px]">
                {photo.name} · {(photo.size / 1024).toFixed(0)} KB
                <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo" className="hover:bg-surface-muted rounded p-0.5">
                  <X className="size-3.5" />
                </button>
              </span>
            ) : (
              <label className="text-ink-soft flex-1 cursor-pointer text-[13px]">
                <span className="text-primary font-medium">Add visitor photo</span> (optional · JPEG/PNG/WebP · max 2 MB)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="sr-only"
                  onChange={(ev) => pickPhoto(ev.target.files?.[0])}
                />
              </label>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={form.formState.isSubmitting}>
              Register & request approval
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ManualEntry() {
  const [open, setOpen] = useState<string | null>(null);
  const [recent, setRecent] = useState<Invitation[]>([]);
  return (
    <>
      <PageHeader title="Manual entry" description="Look up an invitation without scanning, or register a visitor who arrived without a pass." />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Lookup onOpen={setOpen} />
          {recent.length > 0 && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Registered this session</CardTitle>
                  <CardDescription>Open one to admit the visitor once the resident approves.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {recent.map((i) => (
                  <button
                    key={i.invitationId}
                    onClick={() => setOpen(i.invitationId)}
                    className="border-border hover:bg-surface-muted/60 flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{i.visitor.fullName}</span>
                      <span className="text-muted-foreground text-xs">
                        <CategoryLabel category={i.visitor.category} /> · {i.apartmentLabel}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-xs">Tap to refresh</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
        <WalkInForm onCreated={(inv) => setRecent((r) => [inv, ...r].slice(0, 5))} />
      </div>
      <InvitationDialog invitationId={open} role="SECURITY" onClose={() => setOpen(null)} />
    </>
  );
}
