"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Ban, Inbox, Mail, Megaphone, PlayCircle, Search, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { announcementSchema, emailSchema, phoneSchema, type AnnouncementInput } from "@/shared/schemas";
import type { Announcement, AuditChainReport, AuditLogEntry, Community, DemoOutboxEntry, Page } from "@/shared/types";
import { EmptyState, ErrorState, PageHeader, Pager, TableSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
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
  Textarea,
} from "@/components/ui/primitives";
import { api, applyFieldErrors, errorMessage } from "@/lib/api-client";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAction, useCursorPager, useDebounced } from "@/lib/hooks";
import { InvitationBrowser } from "@/features/invitations/invitation-browser";
import { CurrentlyInside } from "@/features/security/security-pages";

export function AdminVisitorsPage() {
  return (
    <>
      <PageHeader title="Visitors" description="Every invitation and walk-in across the community. Search by visitor, resident, phone, code or vehicle." />
      <Tabs defaultValue="all">
        <TabsList className="mb-4">
          <TabsTrigger value="all">All visitors</TabsTrigger>
          <TabsTrigger value="inside">Currently inside</TabsTrigger>
          <TabsTrigger value="rejected">
            <Ban className="size-3.5" /> Rejected
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <InvitationBrowser
            role="ADMIN"
            showResident
            allowExport
            periods={["month", "today", "week", "custom", "all"]}
            defaultPeriod="month"
            testId="admin-visitors"
          />
        </TabsContent>
        <TabsContent value="inside">
          <CurrentlyInside role="ADMIN" embedded />
        </TabsContent>
        <TabsContent value="rejected">
          <InvitationBrowser role="ADMIN" showResident allowExport defaultStatus="REJECTED" emptyTitle="No rejected visitors" />
        </TabsContent>
      </Tabs>
    </>
  );
}

export function AnnouncementsPage() {
  const list = useQuery({ queryKey: ["announcements"], queryFn: () => api.get<Page<Announcement>>("/announcements", { limit: 50 }) });
  const form = useForm<z.input<typeof announcementSchema>, unknown, AnnouncementInput>({
    resolver: zodResolver(announcementSchema),
    defaultValues: { title: "", content: "", priority: "NORMAL" },
  });
  const e = form.formState.errors;
  const publish = useAction((v: AnnouncementInput) => api.post<Announcement>("/admin/announcements", v), {
    success: "Announcement published and residents notified",
    invalidate: [["announcements"]],
    silentError: true,
  });
  const remove = useAction((id: string) => api.delete(`/admin/announcements/${id}`), { success: "Announcement removed", invalidate: [["announcements"]] });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await publish.mutateAsync(v);
      form.reset();
    } catch (err) {
      if (!applyFieldErrors(err, form.setError as never)) form.setError("root", { message: errorMessage(err) });
    }
  });
  return (
    <>
      <PageHeader title="Announcements" description="Publish notices to every resident and guard. Each publication sends an in-app notification." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>New announcement</CardTitle>
              <CardDescription>Keep it short and specific.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="New announcement">
              <Field label="Title" htmlFor="an-title" error={e.title?.message}>
                <Input id="an-title" aria-invalid={!!e.title} {...form.register("title")} />
              </Field>
              <Field label="Message" htmlFor="an-content" error={e.content?.message}>
                <Textarea id="an-content" className="min-h-32" aria-invalid={!!e.content} {...form.register("content")} />
              </Field>
              <Field label="Priority" htmlFor="an-priority">
                <NativeSelect id="an-priority" {...form.register("priority")}>
                  <option value="NORMAL">Normal</option>
                  <option value="IMPORTANT">Important</option>
                </NativeSelect>
              </Field>
              {e.root?.message && <p className="text-danger text-sm">{e.root.message}</p>}
              <div className="flex justify-end">
                <Button type="submit" loading={form.formState.isSubmitting}>
                  <Megaphone /> Publish
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Published</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
            {list.data?.items.length === 0 && <EmptyState icon={Megaphone} title="No announcements yet" />}
            {list.data?.items.map((a) => (
              <article key={a.announcementId} className="border-border rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      {a.priority === "IMPORTANT" && <Badge tone="warning">Important</Badge>}
                      <span className="text-muted-foreground text-xs">
                        {formatRelative(a.createdAt)} · {a.createdByName}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold">{a.title}</h3>
                  </div>
                  <Button size="icon" variant="ghost" aria-label={`Delete ${a.title}`} onClick={() => remove.mutate(a.announcementId)}>
                    <Trash2 />
                  </Button>
                </div>
                <p className="text-muted-foreground mt-2 text-[13px] whitespace-pre-line">{a.content}</p>
              </article>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function AuditLogPage() {
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const pager = useCursorPager(search);
  const [report, setReport] = useState<AuditChainReport | null>(null);
  const list = useQuery({
    queryKey: ["audit", search, pager.cursor],
    queryFn: () => api.get<Page<AuditLogEntry>>("/admin/audit-logs", { q: search || undefined, limit: 25, cursor: pager.cursor }),
    placeholderData: keepPreviousData,
  });
  const verify = useAction(() => api.get<AuditChainReport>("/admin/audit-logs/verify"), { onSuccess: setReport });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only, hash-chained record of every critical action. Each entry includes the hash of the one before it."
        actions={
          <Button variant="secondary" onClick={() => verify.mutate(undefined)} loading={verify.isPending}>
            <ShieldCheck /> Verify integrity
          </Button>
        }
      />
      {report && (
        <div
          role="status"
          data-testid="audit-verify"
          className={`mb-6 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${report.verified ? "border-success/30 bg-success-soft text-success" : "border-danger/30 bg-danger-soft text-danger"}`}
        >
          {report.verified ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
          {report.verified
            ? `Chain verified — ${report.checked} entries and ${report.anchorsChecked} write-once checkpoint${report.anchorsChecked === 1 ? "" : "s"}, no tampering detected.`
            : `Integrity check failed at entry #${report.brokenAtSeq} (${report.reason.replaceAll("_", " ").toLowerCase()}). Investigate immediately.`}
        </div>
      )}
      <Card>
        <div className="border-border border-b p-4">
          <div className="relative max-w-sm">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
            <Input
              aria-label="Search audit log"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search action, actor or record id"
              className="pl-9"
            />
          </div>
        </div>
        {list.isLoading ? (
          <TableSkeleton />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data!.items.length === 0 ? (
          <EmptyState icon={Inbox} title="No audit entries match" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>#</TH>
                <TH>Time</TH>
                <TH>Action</TH>
                <TH>Actor</TH>
                <TH>Record</TH>
                <TH>Hash</TH>
              </tr>
            </THead>
            <TBody>
              {list.data!.items.map((a) => (
                <TR key={a.auditId}>
                  <TD className="tabular-nums">{a.seq}</TD>
                  <TD className="whitespace-nowrap">{formatDateTime(a.timestamp)}</TD>
                  <TD>
                    <Badge tone="outline" className="font-mono text-[11px]">
                      {a.action}
                    </Badge>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {a.actorName}
                    <span className="text-muted-foreground block text-xs">{a.actorRole.toLowerCase()}</span>
                  </TD>
                  <TD className="text-xs">
                    {a.entityType}
                    <span className="text-muted-foreground block font-mono">{a.entityId.slice(0, 18)}</span>
                  </TD>
                  <TD className="text-muted-foreground font-mono text-xs" title={a.hash}>
                    {a.hash.slice(0, 10)}…
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
    </>
  );
}

const settingsForm = z.object({
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().min(5).max(200),
  contactEmail: emailSchema,
  contactPhone: phoneSchema,
  entryGraceMinutes: z.coerce.number<string | number>().int().min(0).max(240),
  overdueAfterMinutes: z.coerce.number<string | number>().int().min(15).max(1440),
  walkInsRequireApproval: z.boolean(),
  remindersEnabled: z.boolean(),
});
type SettingsValues = z.infer<typeof settingsForm>;

function DemoTools() {
  const outbox = useQuery({ queryKey: ["demo-outbox"], queryFn: () => api.get<DemoOutboxEntry[]>("/demo/outbox"), refetchInterval: 15_000 });
  const run = useAction(() => api.post<{ job: string; affected: number }[]>("/demo/run-jobs"), {
    success: (r) => `Jobs complete: ${r.map((j) => `${j.job} (${j.affected})`).join(", ")}`,
    invalidate: [["overview"], ["invitations"], ["inside"], ["demo-outbox"]],
  });
  return (
    <Card className="border-dashed">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            Demo tools <Badge tone="warning">Local demo only</Badge>
          </CardTitle>
          <CardDescription>
            In AWS these jobs run on EventBridge schedules and messages are delivered by SNS. Locally you can trigger them and inspect the simulated outbox.
          </CardDescription>
        </div>
        <Button variant="secondary" onClick={() => run.mutate(undefined)} loading={run.isPending}>
          <PlayCircle /> Run scheduled jobs now
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">Simulated outbox</p>
        {(outbox.data ?? []).length === 0 ? (
          <p className="text-muted-foreground text-[13px]">
            No messages yet. Enable e-mail notifications on a profile, or create an account, to see deliveries here.
          </p>
        ) : (
          <ul className="divide-border border-border max-h-80 divide-y overflow-y-auto rounded-xl border">
            {outbox.data!.map((m) => (
              <li key={m.id} className="flex gap-3 px-4 py-3 text-[13px]">
                <Mail className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone="outline">{m.channel}</Badge>
                    <span className="font-medium">{m.subject}</span>
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    to {m.to} · {formatRelative(m.createdAt)}
                  </span>
                  <span className="text-ink-soft mt-1 block">{m.body}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPage({ demo }: { demo: boolean }) {
  const community = useQuery({ queryKey: ["community"], queryFn: () => api.get<Community>("/admin/community") });
  const form = useForm<z.input<typeof settingsForm>, unknown, SettingsValues>({ resolver: zodResolver(settingsForm) });
  const e = form.formState.errors;
  useEffect(() => {
    const c = community.data;
    if (c) form.reset({ name: c.name, address: c.address, contactEmail: c.contactEmail, contactPhone: c.contactPhone, ...c.settings });
  }, [community.data, form]);
  const save = useAction(
    (v: SettingsValues) =>
      api.patch<Community>("/admin/community", {
        name: v.name,
        address: v.address,
        contactEmail: v.contactEmail,
        contactPhone: v.contactPhone,
        settings: {
          entryGraceMinutes: v.entryGraceMinutes,
          overdueAfterMinutes: v.overdueAfterMinutes,
          walkInsRequireApproval: v.walkInsRequireApproval,
          remindersEnabled: v.remindersEnabled,
        },
      }),
    { success: "Settings saved", invalidate: [["community"], ["me"]] },
  );
  if (community.isError) return <ErrorState error={community.error} onRetry={() => community.refetch()} />;
  return (
    <>
      <PageHeader title="Settings" description="Community details and gate policies." />
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-6 lg:grid-cols-2" aria-label="Community settings">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Community</CardTitle>
              <CardDescription>
                Residents register with community code{" "}
                <code className="bg-surface-muted text-foreground rounded px-1.5 py-0.5 font-mono" data-testid="join-code">
                  {community.data?.joinCode ?? "…"}
                </code>
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Name" htmlFor="s-name" error={e.name?.message}>
              <Input id="s-name" {...form.register("name")} />
            </Field>
            <Field label="Address" htmlFor="s-address" error={e.address?.message}>
              <Input id="s-address" {...form.register("address")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Office e-mail" htmlFor="s-email" error={e.contactEmail?.message}>
                <Input id="s-email" type="email" {...form.register("contactEmail")} />
              </Field>
              <Field label="Office phone" htmlFor="s-phone" error={e.contactPhone?.message}>
                <Input id="s-phone" type="tel" {...form.register("contactPhone")} />
              </Field>
            </div>
            <Field label="Time zone" htmlFor="s-tz" hint="Used for daily summaries and “today” views">
              <Input id="s-tz" value={community.data?.timezone ?? ""} readOnly disabled />
            </Field>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <div>
              <CardTitle>Gate policy</CardTitle>
              <CardDescription>How passes and visitors are handled at the gate.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Early entry window (min)" htmlFor="s-grace" error={e.entryGraceMinutes?.message} hint="Pass becomes valid this long before arrival">
                <Input id="s-grace" type="number" {...form.register("entryGraceMinutes")} />
              </Field>
              <Field label="Overdue after (min)" htmlFor="s-overdue" error={e.overdueAfterMinutes?.message} hint="Past expected departure">
                <Input id="s-overdue" type="number" {...form.register("overdueAfterMinutes")} />
              </Field>
            </div>
            {(
              [
                ["walkInsRequireApproval", "Walk-ins need resident approval", "Security cannot admit unannounced visitors until the resident approves."],
                ["remindersEnabled", "Arrival reminders", "Notify residents an hour before an invited visitor is due."],
              ] as const
            ).map(([name, label, hint]) => (
              <Controller
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <label className="border-border flex items-start justify-between gap-4 rounded-xl border p-4">
                    <span>
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="text-muted-foreground block text-xs">{hint}</span>
                    </span>
                    <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} aria-label={label} />
                  </label>
                )}
              />
            ))}
            <p className="text-muted-foreground text-xs">Overdue visitors are flagged and notified — GateKeeper never records an exit automatically.</p>
            <div className="flex justify-end">
              <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
                Save settings
              </Button>
            </div>
          </CardContent>
        </Card>
        {demo && (
          <div className="lg:col-span-2">
            <DemoTools />
          </div>
        )}
      </form>
    </>
  );
}
