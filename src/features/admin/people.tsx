"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, Copy, KeyRound, MoreHorizontal, Pencil, Power, Search, UserPlus, Users, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { SHIFT_LABELS, SHIFTS, type Shift } from "@/shared/domain";
import { createGuardSchema, createResidentSchema, type CreateGuardInput, type CreateResidentInput } from "@/shared/schemas";
import type { Apartment, CreatedAccount, Page, UserProfile, VisitEvent } from "@/shared/types";
import { EventBadge } from "@/components/shared/badges";
import { EmptyState, ErrorState, PageHeader, Pager, TableSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/overlays";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  NativeSelect,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/primitives";
import { api, applyFieldErrors, errorMessage } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAction, useCursorPager, useDebounced } from "@/lib/hooks";

const INVALIDATE = [["people"], ["overview"]];

function useApartments() {
  return useQuery({ queryKey: ["apartments", "admin"], queryFn: () => api.get<Apartment[]>("/admin/apartments") });
}

function ApartmentSelect({ invalid, ...rest }: { invalid?: boolean } & React.ComponentProps<"select">) {
  const apartments = useApartments();
  return (
    <NativeSelect aria-invalid={invalid} {...rest}>
      <option value="">Select apartment…</option>
      {apartments.data?.map((a) => (
        <option key={a.apartmentId} value={a.apartmentId}>
          {a.buildingName} · {a.unitNumber}
          {a.block ? ` (${a.block})` : ""}
        </option>
      ))}
    </NativeSelect>
  );
}

function StatusPill({ status }: { status: UserProfile["status"] }) {
  return (
    <Badge tone={status === "ACTIVE" ? "success" : status === "PENDING" ? "warning" : "neutral"} dot>
      {status === "ACTIVE" ? "Active" : status === "PENDING" ? "Pending" : "Deactivated"}
    </Badge>
  );
}

/** Shown once after account creation. In production Cognito e-mails the invitation instead. */
function CreatedNotice({ account, onClose }: { account: CreatedAccount | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(account)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Account created</DialogTitle>
          <DialogDescription>{account?.user.fullName} can now sign in.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-sm">
          {account?.temporaryPassword ? (
            <>
              <p className="text-muted-foreground">
                Demo mode: no e-mail was sent. Share this temporary password securely — it is shown only once and must be changed at first sign-in.
              </p>
              <div className="border-border bg-surface-muted flex items-center gap-2 rounded-lg border px-3 py-2">
                <KeyRound className="text-muted-foreground size-4" />
                <code className="flex-1 font-mono" data-testid="temp-password">
                  {account.temporaryPassword}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigator.clipboard.writeText(account.temporaryPassword!).then(() => toast.success("Copied"))}
                  aria-label="Copy temporary password"
                >
                  <Copy />
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">An invitation e-mail with a temporary password has been sent to {account?.user.email} by Amazon Cognito.</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddResidentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (a: CreatedAccount) => void }) {
  const form = useForm<CreateResidentInput>({
    resolver: zodResolver(createResidentSchema),
    defaultValues: { fullName: "", email: "", phone: "", apartmentId: "" },
  });
  const e = form.formState.errors;
  const create = useAction((v: CreateResidentInput) => api.post<CreatedAccount>("/residents", v), {
    success: "Resident added",
    invalidate: INVALIDATE,
    silentError: true,
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const account = await create.mutateAsync(v);
      form.reset();
      onOpenChange(false);
      onCreated(account);
    } catch (err) {
      if (!applyFieldErrors(err, form.setError as never)) form.setError("root", { message: errorMessage(err) });
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate aria-label="Add resident">
          <DialogHeader>
            <DialogTitle>Add a resident</DialogTitle>
            <DialogDescription>They&apos;ll receive an invitation with a temporary password.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Full name" htmlFor="r-name" error={e.fullName?.message}>
              <Input id="r-name" aria-invalid={!!e.fullName} {...form.register("fullName")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="E-mail" htmlFor="r-email" error={e.email?.message}>
                <Input id="r-email" type="email" aria-invalid={!!e.email} {...form.register("email")} />
              </Field>
              <Field label="Phone" htmlFor="r-phone" error={e.phone?.message}>
                <Input id="r-phone" type="tel" aria-invalid={!!e.phone} {...form.register("phone")} />
              </Field>
            </div>
            <Field label="Apartment" htmlFor="r-apartment" error={e.apartmentId?.message}>
              <ApartmentSelect id="r-apartment" invalid={!!e.apartmentId} {...form.register("apartmentId")} />
            </Field>
            {e.root?.message && <p className="text-danger text-sm">{e.root.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Add resident
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditResidentDialog({ resident, onClose }: { resident: UserProfile | null; onClose: () => void }) {
  const [draft, setDraft] = useState<{ fullName: string; phone: string; apartmentId: string } | null>(null);
  const current = draft ?? (resident ? { fullName: resident.fullName, phone: resident.phone, apartmentId: resident.apartmentId ?? "" } : null);
  const save = useAction((v: typeof current) => api.patch<UserProfile>(`/residents/${resident!.userId}`, v), {
    success: "Resident updated",
    invalidate: INVALIDATE,
    onSuccess: () => {
      setDraft(null);
      onClose();
    },
  });
  return (
    <Dialog
      open={Boolean(resident)}
      onOpenChange={(o) => {
        if (!o) {
          setDraft(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit resident</DialogTitle>
          <DialogDescription>{resident?.email}</DialogDescription>
        </DialogHeader>
        {current && (
          <DialogBody className="space-y-4">
            <Field label="Full name" htmlFor="er-name">
              <Input id="er-name" value={current.fullName} onChange={(e) => setDraft({ ...current, fullName: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor="er-phone">
              <Input id="er-phone" value={current.phone} onChange={(e) => setDraft({ ...current, phone: e.target.value })} />
            </Field>
            <Field label="Apartment" htmlFor="er-apartment" hint="Reassigning moves the resident's access to the new unit.">
              <ApartmentSelect id="er-apartment" value={current.apartmentId} onChange={(e) => setDraft({ ...current, apartmentId: e.target.value })} />
            </Field>
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(current)} loading={save.isPending} disabled={!draft}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApproveRegistrationDialog({ user, onClose }: { user: UserProfile | null; onClose: () => void }) {
  const apartments = useApartments();
  const [apartmentId, setApartmentId] = useState("");
  const suggested = apartments.data?.find((a) => a.unitNumber === user?.requestedUnit)?.apartmentId ?? "";
  const value = apartmentId || suggested;
  const approve = useAction(() => api.post(`/residents/${user!.userId}/approve-registration`, { apartmentId: value }), {
    success: "Registration approved",
    invalidate: INVALIDATE,
    onSuccess: () => {
      setApartmentId("");
      onClose();
    },
  });
  return (
    <Dialog open={Boolean(user)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Approve {user?.fullName}</DialogTitle>
          <DialogDescription>Requested unit: {user?.requestedUnit ?? "—"}. Confirm the apartment before granting access.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label="Apartment" htmlFor="approve-apartment">
            <ApartmentSelect id="approve-apartment" value={value} onChange={(e) => setApartmentId(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => approve.mutate(undefined)} loading={approve.isPending} disabled={!value}>
            <Check /> Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResidentsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<"ACTIVE" | "PENDING" | "DEACTIVATED">(params.get("tab") === "pending" ? "PENDING" : "ACTIVE");
  const [adding, setAdding] = useState(params.get("add") === "1");
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [approving, setApproving] = useState<UserProfile | null>(null);
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const pager = useCursorPager(`${tab}:${search}`);
  const list = useQuery({
    queryKey: ["people", "residents", tab, search, pager.cursor],
    queryFn: () =>
      api.get<Page<UserProfile>>("/residents", {
        status: tab,
        pending: tab === "PENDING" ? "true" : undefined,
        q: search || undefined,
        limit: 20,
        cursor: pager.cursor,
      }),
    placeholderData: keepPreviousData,
  });
  const setStatus = useAction(({ id, status }: { id: string; status: "ACTIVE" | "DEACTIVATED" }) => api.patch(`/residents/${id}`, { status }), {
    success: "Account status updated",
    invalidate: INVALIDATE,
  });
  const reject = useAction((id: string) => api.post(`/residents/${id}/reject-registration`), { success: "Registration rejected", invalidate: INVALIDATE });

  return (
    <>
      <PageHeader
        title="Residents"
        description="Manage resident accounts, apartment assignments and self-registrations."
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus /> Add resident
          </Button>
        }
      />
      <Card>
        <div className="border-border flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as typeof tab);
              router.replace(v === "PENDING" ? "?tab=pending" : "?", { scroll: false });
            }}
          >
            <TabsList>
              <TabsTrigger value="ACTIVE">Active</TabsTrigger>
              <TabsTrigger value="PENDING">Pending registrations</TabsTrigger>
              <TabsTrigger value="DEACTIVATED">Deactivated</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative sm:w-72">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
            <Input aria-label="Search residents" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, e-mail or unit" className="pl-9" />
          </div>
        </div>
        {list.isLoading ? (
          <TableSkeleton />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data!.items.length === 0 ? (
          <EmptyState icon={Users} title={tab === "PENDING" ? "No registrations waiting" : "No residents found"} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Contact</TH>
                <TH>{tab === "PENDING" ? "Requested unit" : "Apartment"}</TH>
                <TH>Status</TH>
                <TH>Since</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <TBody>
              {list.data!.items.map((u) => (
                <TR key={u.userId}>
                  <TD className="text-foreground font-medium">{u.fullName}</TD>
                  <TD>
                    <span className="block">{u.email}</span>
                    <span className="text-muted-foreground text-xs">{u.phone}</span>
                  </TD>
                  <TD className="whitespace-nowrap">{tab === "PENDING" ? u.requestedUnit : (u.apartmentLabel ?? "—")}</TD>
                  <TD>
                    <StatusPill status={u.status} />
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(u.createdAt)}</TD>
                  <TD className="text-right">
                    {tab === "PENDING" ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="danger-outline" onClick={() => reject.mutate(u.userId)} aria-label={`Reject ${u.fullName}`}>
                          <X /> Reject
                        </Button>
                        <Button size="sm" onClick={() => setApproving(u)}>
                          <Check /> Approve
                        </Button>
                      </div>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" aria-label={`Actions for ${u.fullName}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setEditing(u)}>
                            <Pencil /> Edit details
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setStatus.mutate({ id: u.userId, status: u.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE" })}>
                            <Power /> {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pager
          page={pager.page}
          hasPrev={pager.hasPrev}
          hasNext={Boolean(list.data?.nextCursor)}
          onPrev={pager.prev}
          onNext={() => pager.next(list.data?.nextCursor ?? null)}
        />
      </Card>
      <AddResidentDialog open={adding} onOpenChange={setAdding} onCreated={setCreated} />
      <CreatedNotice account={created} onClose={() => setCreated(null)} />
      <EditResidentDialog key={editing?.userId} resident={editing} onClose={() => setEditing(null)} />
      <ApproveRegistrationDialog key={approving?.userId} user={approving} onClose={() => setApproving(null)} />
    </>
  );
}

function AddGuardDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (a: CreatedAccount) => void }) {
  const form = useForm<CreateGuardInput>({ resolver: zodResolver(createGuardSchema), defaultValues: { fullName: "", email: "", phone: "", shift: "MORNING" } });
  const e = form.formState.errors;
  const create = useAction((v: CreateGuardInput) => api.post<CreatedAccount>("/admin/guards", v), {
    success: "Guard added",
    invalidate: INVALIDATE,
    silentError: true,
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const account = await create.mutateAsync(v);
      form.reset();
      onOpenChange(false);
      onCreated(account);
    } catch (err) {
      if (!applyFieldErrors(err, form.setError as never)) form.setError("root", { message: errorMessage(err) });
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate aria-label="Add guard">
          <DialogHeader>
            <DialogTitle>Add security staff</DialogTitle>
            <DialogDescription>Guards can scan passes, register walk-ins and record entries and exits.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Full name" htmlFor="g-name" error={e.fullName?.message}>
              <Input id="g-name" aria-invalid={!!e.fullName} {...form.register("fullName")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="E-mail" htmlFor="g-email" error={e.email?.message}>
                <Input id="g-email" type="email" aria-invalid={!!e.email} {...form.register("email")} />
              </Field>
              <Field label="Phone" htmlFor="g-phone" error={e.phone?.message}>
                <Input id="g-phone" type="tel" aria-invalid={!!e.phone} {...form.register("phone")} />
              </Field>
            </div>
            <Field label="Shift" htmlFor="g-shift">
              <NativeSelect id="g-shift" {...form.register("shift")}>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {e.root?.message && <p className="text-danger text-sm">{e.root.message}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Add guard
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GuardsPage() {
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [selected, setSelected] = useState<UserProfile | null>(null);
  const list = useQuery({ queryKey: ["people", "guards"], queryFn: () => api.get<Page<UserProfile>>("/admin/guards", { limit: 100 }) });
  const update = useAction(
    ({ id, body }: { id: string; body: { shift?: Shift; status?: "ACTIVE" | "DEACTIVATED" } }) => api.patch<UserProfile>(`/admin/guards/${id}`, body),
    {
      success: "Guard updated",
      invalidate: INVALIDATE,
    },
  );
  const activity = useQuery({
    queryKey: ["activity", "guard", selected?.fullName],
    queryFn: () => api.get<Page<VisitEvent>>("/security/activity", { q: selected!.fullName, limit: 10 }),
    enabled: Boolean(selected),
  });

  return (
    <>
      <PageHeader
        title="Security staff"
        description="Guard accounts, shift assignments and gate activity."
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus /> Add guard
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          {list.isLoading ? (
            <TableSkeleton />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data!.items.length === 0 ? (
            <EmptyState icon={Users} title="No guards yet" action={<Button onClick={() => setAdding(true)}>Add the first guard</Button>} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Guard</TH>
                  <TH>Shift</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Account</TH>
                </tr>
              </THead>
              <TBody>
                {list.data!.items.map((g) => (
                  <TR key={g.userId} className={selected?.userId === g.userId ? "bg-primary-softer" : undefined}>
                    <TD>
                      <button className="text-left" onClick={() => setSelected(g)}>
                        <span className="text-foreground block font-medium hover:underline">{g.fullName}</span>
                        <span className="text-muted-foreground text-xs">{g.email}</span>
                      </button>
                    </TD>
                    <TD>
                      <NativeSelect
                        aria-label={`Shift for ${g.fullName}`}
                        value={g.shift ?? "UNASSIGNED"}
                        onChange={(e) => update.mutate({ id: g.userId, body: { shift: e.target.value as Shift } })}
                        className="w-52"
                      >
                        {SHIFTS.map((s) => (
                          <option key={s} value={s}>
                            {SHIFT_LABELS[s]}
                          </option>
                        ))}
                      </NativeSelect>
                    </TD>
                    <TD>
                      <StatusPill status={g.status} />
                    </TD>
                    <TD className="text-right">
                      <Button
                        size="sm"
                        variant={g.status === "ACTIVE" ? "danger-outline" : "secondary"}
                        onClick={() => update.mutate({ id: g.userId, body: { status: g.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE" } })}
                      >
                        <Power /> {g.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>{selected ? `${selected.fullName}'s recent activity` : "Guard activity"}</CardTitle>
              <CardDescription>{selected ? "Latest gate events by this guard" : "Select a guard to view their recent gate events."}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {selected && activity.data?.items.length === 0 && <p className="text-muted-foreground text-[13px]">No recent activity.</p>}
            <ul className="space-y-3">
              {activity.data?.items.map((e) => (
                <li key={e.eventId} className="flex items-start gap-3 text-[13px]">
                  <EventBadge type={e.eventType} />
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate">{e.visitorName ?? "—"}</span>
                    <span className="text-muted-foreground text-xs">{formatDateTime(e.timestamp)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <AddGuardDialog open={adding} onOpenChange={setAdding} onCreated={setCreated} />
      <CreatedNotice account={created} onClose={() => setCreated(null)} />
    </>
  );
}
