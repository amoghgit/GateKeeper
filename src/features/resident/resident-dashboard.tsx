"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BellRing, CalendarClock, DoorOpen, Megaphone, UserPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EVENT_LABELS } from "@/shared/domain";
import type { Invitation, Page, ResidentOverview } from "@/shared/types";
import { CategoryLabel, EventBadge, StatusBadge } from "@/components/shared/badges";
import { EmptyState, ErrorState, PageHeader, StatCard } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { formatDateTime, formatRelative, formatWeekday, formatTime } from "@/lib/format";
import { useMe, useNow } from "@/lib/hooks";
import { InvitationDialog } from "@/features/invitations/invitation-dialog";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function ResidentDashboard() {
  const me = useMe();
  const now = useNow();
  const [open, setOpen] = useState<string | null>(null);
  const overview = useQuery({
    queryKey: ["overview", "resident"],
    queryFn: () => api.get<ResidentOverview>("/resident/overview"),
    refetchInterval: 20_000,
  });
  const pending = useQuery({
    queryKey: ["invitations", "pending-dashboard"],
    queryFn: () => api.get<Page<Invitation>>("/invitations", { status: "PENDING_APPROVAL", limit: 5 }),
    refetchInterval: 15_000,
  });
  const data = overview.data;
  const firstName = me.data?.profile.fullName.split(" ")[0] ?? "";
  const pendingItems = (pending.data?.items ?? []).filter((i) => Date.parse(i.expiry) > now);

  return (
    <>
      <PageHeader
        eyebrow={me.data?.profile.apartmentLabel ?? undefined}
        title={`${greeting()}${firstName ? `, ${firstName}` : ""}`}
        description="Here's who is expected, who is inside, and anything waiting on you."
        actions={
          <Button asChild>
            <Link href="/resident/invitations/new">
              <UserPlus /> Invite a visitor
            </Link>
          </Button>
        }
      />

      {pendingItems.length > 0 && (
        <Card className="border-warning/30 bg-warning-soft/40 mb-6" data-testid="pending-approvals">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <BellRing className="text-warning size-4" /> Waiting for your approval
              </CardTitle>
              <CardDescription>Security is holding these visitors at the gate until you respond.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingItems.map((i) => (
              <div key={i.invitationId} className="border-border bg-surface flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{i.visitor.fullName}</p>
                  <p className="text-muted-foreground text-xs">
                    <CategoryLabel category={i.visitor.category} /> · {i.visitor.purpose} · {formatRelative(i.createdAt)}
                  </p>
                </div>
                <Button size="sm" onClick={() => setOpen(i.invitationId)}>
                  Review
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {overview.isError ? (
        <Card>
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Visitors this month"
              value={data?.visitorsThisMonth ?? 0}
              icon={UsersRound}
              loading={!data}
              hint="Excludes cancelled and rejected"
            />
            <StatCard label="Inside right now" value={data?.insideNow ?? 0} icon={DoorOpen} loading={!data} hint="Checked in, not yet exited" />
            <StatCard
              label="Pending requests"
              value={data?.pendingRequests ?? 0}
              icon={BellRing}
              loading={!data}
              emphasis={data && data.pendingRequests > 0 ? "warning" : undefined}
              hint="Walk-ins awaiting your decision"
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Upcoming visitors</CardTitle>
                  <CardDescription>Approved passes for the days ahead</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/resident/invitations">
                    All invitations <ArrowRight />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="pt-2">
                {!data ? (
                  <div className="space-y-3">
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                  </div>
                ) : data.upcoming.length === 0 ? (
                  <EmptyState
                    icon={CalendarClock}
                    title="No upcoming visitors"
                    description="Invite someone and they'll appear here with their pass."
                    className="py-8"
                  />
                ) : (
                  <ul className="divide-border divide-y">
                    {data.upcoming.map((i) => (
                      <li key={i.invitationId}>
                        <button className="flex w-full items-center gap-4 py-3 text-left" onClick={() => setOpen(i.invitationId)}>
                          <span className="border-border bg-surface-muted/60 flex w-[76px] shrink-0 flex-col items-center rounded-lg border py-1.5">
                            <span className="text-muted-foreground text-[10px] font-medium uppercase">{formatWeekday(i.expectedArrival).split(" ")[0]}</span>
                            <span className="text-[13px] font-semibold whitespace-nowrap">{formatTime(i.expectedArrival)}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{i.visitor.fullName}</span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {i.visitor.purpose} · {formatWeekday(i.expectedArrival)}
                            </span>
                          </span>
                          <StatusBadge status={i.status} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Recent gate activity</CardTitle>
                  <CardDescription>Entries, exits and decisions for your apartment</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                {!data ? (
                  <Skeleton className="h-40" />
                ) : data.recentActivity.length === 0 ? (
                  <EmptyState icon={DoorOpen} title="No activity yet" className="py-8" />
                ) : (
                  <ul className="space-y-3">
                    {data.recentActivity.map((e) => (
                      <li key={e.eventId} className="flex items-start gap-3">
                        <span className="w-[132px] shrink-0">
                          <EventBadge type={e.eventType} />
                        </span>
                        <span className="min-w-0 flex-1 text-[13px]">
                          <span className="text-foreground font-medium">{e.visitorName ?? EVENT_LABELS[e.eventType]}</span>
                          <span className="text-muted-foreground block text-xs">
                            {formatDateTime(e.timestamp)} · {e.actorName}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {data && data.announcements.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Megaphone className="text-primary size-4" /> Community announcements
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                {data.announcements.map((a) => (
                  <article key={a.announcementId} className="border-border rounded-xl border p-4">
                    <div className="mb-2 flex items-center gap-2">
                      {a.priority === "IMPORTANT" && <Badge tone="warning">Important</Badge>}
                      <span className="text-muted-foreground text-xs">{formatRelative(a.createdAt)}</span>
                    </div>
                    <h3 className="text-sm font-semibold">{a.title}</h3>
                    <p className="text-muted-foreground mt-1 line-clamp-3 text-[13px]">{a.content}</p>
                  </article>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
      <InvitationDialog invitationId={open} role="RESIDENT" onClose={() => setOpen(null)} />
    </>
  );
}
