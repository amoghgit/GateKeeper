"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, BellRing, CalendarClock, ClipboardList, DoorClosed, DoorOpen, LogIn, LogOut, ScanLine, Search, Siren } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EVENT_LABELS, VISIT_EVENT_TYPES, type VisitEventType } from "@/shared/domain";
import type { Invitation, Page, SecurityOverview, VisitEvent } from "@/shared/types";
import { CategoryLabel, EventBadge, StatusBadge } from "@/components/shared/badges";
import { EmptyState, ErrorState, PageHeader, Pager, StatCard, TableSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  NativeSelect,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { formatDateTime, formatDuration, formatTime, localDay, shiftDay } from "@/lib/format";
import { useAction, useCursorPager, useDebounced, useNow } from "@/lib/hooks";
import { InvitationDialog } from "@/features/invitations/invitation-dialog";

export function SecurityDashboard() {
  const [open, setOpen] = useState<string | null>(null);
  const o = useQuery({ queryKey: ["overview", "security"], queryFn: () => api.get<SecurityOverview>("/security/overview"), refetchInterval: 10_000 });
  const d = o.data;
  return (
    <>
      <PageHeader
        title="Gate overview"
        description="Live status of the main gate. Refreshes automatically."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/security/manual-entry">
                <ClipboardList /> Manual entry
              </Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/security/scan">
                <ScanLine /> Scan pass
              </Link>
            </Button>
          </>
        }
      />
      {o.isError ? (
        <Card>
          <ErrorState error={o.error} onRetry={() => o.refetch()} />
        </Card>
      ) : (
        <>
          {d && d.overdue > 0 && (
            <Link
              href="/security/currently-inside"
              className="border-danger/30 bg-danger-soft text-danger mb-6 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
            >
              <Siren className="size-4" />
              <span className="flex-1">
                <strong>{d.overdue}</strong> visitor{d.overdue === 1 ? " is" : "s are"} past their expected departure. Follow up with the resident.
              </span>
              <ArrowRight className="size-4" />
            </Link>
          )}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Inside now" value={d?.insideNow ?? 0} icon={DoorOpen} loading={!d} />
            <StatCard label="Expected today" value={d?.expectedToday ?? 0} icon={CalendarClock} loading={!d} />
            <StatCard
              label="Pending approval"
              value={d?.pendingApprovals ?? 0}
              icon={BellRing}
              loading={!d}
              emphasis={d && d.pendingApprovals > 0 ? "warning" : undefined}
            />
            <StatCard label="Entries today" value={d?.entriesToday ?? 0} icon={LogIn} loading={!d} />
            <StatCard label="Exits today" value={d?.exitsToday ?? 0} icon={LogOut} loading={!d} />
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Expected today</CardTitle>
                  <CardDescription>Approved and pending visitors due at the gate</CardDescription>
                </div>
              </CardHeader>
              {!d ? (
                <TableSkeleton rows={4} cols={4} />
              ) : d.expectedList.length === 0 ? (
                <EmptyState icon={CalendarClock} title="No more visitors expected today" />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Visitor</TH>
                      <TH>Apartment</TH>
                      <TH>Time</TH>
                      <TH>Status</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {d.expectedList.map((i) => (
                      <TR key={i.invitationId} className="cursor-pointer" onClick={() => setOpen(i.invitationId)}>
                        <TD>
                          <span className="text-foreground block font-medium">{i.visitor.fullName}</span>
                          <span className="text-xs">
                            <CategoryLabel category={i.visitor.category} />
                          </span>
                        </TD>
                        <TD className="whitespace-nowrap">{i.apartmentLabel}</TD>
                        <TD className="whitespace-nowrap">{formatTime(i.expectedArrival)}</TD>
                        <TD>
                          <StatusBadge status={i.status} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Latest activity</CardTitle>
                  <CardDescription>Scans, entries and exits across all guards</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/security/activity">
                    Full log <ArrowRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {d?.recentActivity.map((e) => (
                    <li key={e.eventId} className="flex items-start gap-3 text-[13px]">
                      <span className="text-muted-foreground w-14 shrink-0 pt-0.5 text-xs tabular-nums">{formatTime(e.timestamp)}</span>
                      <span className="min-w-0 flex-1">
                        <EventBadge type={e.eventType} />
                        <span className="text-foreground mt-1 block truncate">{e.visitorName ?? e.detail?.replaceAll("_", " ").toLowerCase() ?? "—"}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {e.apartmentLabel ?? "—"} · {e.actorName}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
      <InvitationDialog invitationId={open} role="SECURITY" onClose={() => setOpen(null)} />
    </>
  );
}

export function CurrentlyInside({ role = "SECURITY" as "SECURITY" | "ADMIN", embedded = false }) {
  const now = useNow(15_000);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["inside"], queryFn: () => api.get<Invitation[]>("/security/currently-inside"), refetchInterval: 10_000 });
  const exit = useAction((invitationId: string) => api.post<Invitation>("/security/record-exit", { invitationId }), {
    success: (i) => `Exit recorded for ${i.visitor.fullName}`,
    invalidate: [["inside"], ["overview"], ["activity"]],
  });
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data ?? []).filter((i) => !needle || `${i.visitor.fullName} ${i.apartmentLabel} ${i.visitor.phone}`.toLowerCase().includes(needle));
  }, [list.data, q]);

  const table = (
    <Card data-testid="currently-inside">
      <div className="border-border flex flex-wrap items-center gap-3 border-b p-4">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
          <Input
            aria-label="Filter visitors inside"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name, phone or apartment"
            className="pl-9"
          />
        </div>
        <span className="text-muted-foreground flex items-center gap-2 text-xs">
          <span className="bg-success size-2 animate-pulse rounded-full" aria-hidden /> Live · {list.data?.length ?? 0} inside
        </span>
      </div>
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={DoorOpen} title={q ? "No matches" : "No visitors inside"} description="Visitors appear here as soon as their entry is recorded." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Visitor</TH>
              <TH>Apartment</TH>
              <TH>Category</TH>
              <TH>Entered</TH>
              <TH>Entry guard</TH>
              <TH>Status</TH>
              {role === "SECURITY" && <TH className="text-right">Action</TH>}
            </tr>
          </THead>
          <TBody>
            {rows.map((i) => (
              <TR key={i.invitationId}>
                <TD>
                  <button className="text-left" onClick={() => setOpen(i.invitationId)}>
                    <span className="text-foreground block font-medium hover:underline">{i.visitor.fullName}</span>
                    <span className="text-muted-foreground text-xs">{i.visitor.phone}</span>
                  </button>
                </TD>
                <TD className="whitespace-nowrap">{i.apartmentLabel}</TD>
                <TD>
                  <CategoryLabel category={i.visitor.category} />
                </TD>
                <TD className="whitespace-nowrap">
                  {formatTime(i.lastEntryAt)}
                  <span className="text-muted-foreground block text-xs">{i.lastEntryAt ? `${formatDuration(i.lastEntryAt, now)} ago` : ""}</span>
                </TD>
                <TD className="whitespace-nowrap">{i.lastEntryGuardName ?? "—"}</TD>
                <TD>
                  <StatusBadge status={i.status} overdue={i.overdue || Date.parse(i.expectedDeparture) < now - 60 * 60_000} />
                </TD>
                {role === "SECURITY" && (
                  <TD className="text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => exit.mutate(i.invitationId)}
                      loading={exit.isPending && exit.variables === i.invitationId}
                      aria-label={`Record exit for ${i.visitor.fullName}`}
                    >
                      <DoorClosed /> Exit
                    </Button>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <InvitationDialog invitationId={open} role={role} onClose={() => setOpen(null)} />
    </Card>
  );
  if (embedded) return table;
  return (
    <>
      <PageHeader title="Currently inside" description="Everyone checked in and not yet exited. Updates every 10 seconds." />
      {table}
    </>
  );
}

export function ActivityLog() {
  const [type, setType] = useState<VisitEventType | "">("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(shiftDay(localDay(), -7));
  const [to, setTo] = useState(localDay());
  const search = useDebounced(q.trim());
  const filters = { type: type || undefined, q: search.length >= 2 ? search : undefined, from, to };
  const pager = useCursorPager(JSON.stringify(filters));
  const list = useQuery({
    queryKey: ["activity", filters, pager.cursor],
    queryFn: () => api.get<Page<VisitEvent>>("/security/activity", { ...filters, limit: 25, cursor: pager.cursor }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageHeader title="Activity log" description="Every scan, entry, exit, walk-in and approval decision at the gate." />
      <Card>
        <div className="border-border grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
            <Input
              aria-label="Search activity"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search visitor, apartment or guard"
              className="pl-9"
            />
          </div>
          <NativeSelect aria-label="Event type" value={type} onChange={(e) => setType(e.target.value as VisitEventType | "")} className="lg:w-48">
            <option value="">All events</option>
            {VISIT_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
          <div className="flex items-center gap-2">
            <Label htmlFor="act-from" className="text-muted-foreground text-xs">
              From
            </Label>
            <Input id="act-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="act-to" className="text-muted-foreground text-xs">
              To
            </Label>
            <Input id="act-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        </div>
        {list.isLoading ? (
          <TableSkeleton />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data!.items.length === 0 ? (
          <EmptyState icon={Activity} title="No activity for these filters" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Time</TH>
                <TH>Event</TH>
                <TH>Visitor</TH>
                <TH>Apartment</TH>
                <TH>By</TH>
                <TH>Detail</TH>
              </tr>
            </THead>
            <TBody>
              {list.data!.items.map((e) => (
                <TR key={e.eventId}>
                  <TD className="whitespace-nowrap tabular-nums">{formatDateTime(e.timestamp)}</TD>
                  <TD>
                    <EventBadge type={e.eventType} />
                  </TD>
                  <TD className="text-foreground font-medium">{e.visitorName ?? "—"}</TD>
                  <TD className="whitespace-nowrap">{e.apartmentLabel ?? "—"}</TD>
                  <TD className="whitespace-nowrap">{e.actorName}</TD>
                  <TD className="text-xs">{e.detail?.replaceAll("_", " ").toLowerCase() ?? ""}</TD>
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
