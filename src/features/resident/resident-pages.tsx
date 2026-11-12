"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bell, CheckCheck, Megaphone, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { AppNotification, Announcement, KnownVisitor, Page } from "@/shared/types";
import { CATEGORY_ICONS } from "@/components/shared/badges";
import { EmptyState, ErrorState, PageHeader, Pager, TableSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { formatDate, formatRelative } from "@/lib/format";
import { useAction, useCursorPager } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { InvitationBrowser } from "@/features/invitations/invitation-browser";

const inviteButton = (
  <Button asChild>
    <Link href="/resident/invitations/new">
      <UserPlus /> Invite a visitor
    </Link>
  </Button>
);

export function ResidentInvitations() {
  return (
    <>
      <PageHeader title="Invitations" description="Passes you've issued and requests from the gate." actions={inviteButton} />
      <Tabs defaultValue="upcoming">
        <TabsList className="mb-4 max-w-full overflow-x-auto">
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="pending">Needs approval</TabsTrigger>
          <TabsTrigger value="inside">Inside now</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming">
          <InvitationBrowser
            role="RESIDENT"
            showApartment={false}
            periods={["upcoming", "today", "week", "all"]}
            defaultPeriod="upcoming"
            defaultStatus="APPROVED"
            emptyTitle="No upcoming visitors"
            emptyDescription="Create an invitation to issue a QR pass."
            emptyAction={inviteButton}
          />
        </TabsContent>
        <TabsContent value="pending">
          <InvitationBrowser
            role="RESIDENT"
            showApartment={false}
            defaultStatus="PENDING_APPROVAL"
            emptyTitle="Nothing waiting on you"
            emptyDescription="Walk-in visitors registered by security will appear here for approval."
          />
        </TabsContent>
        <TabsContent value="inside">
          <InvitationBrowser role="RESIDENT" showApartment={false} defaultStatus="CHECKED_IN" emptyTitle="No one is inside right now" />
        </TabsContent>
        <TabsContent value="all">
          <InvitationBrowser role="RESIDENT" showApartment={false} testId="all-invitations" />
        </TabsContent>
      </Tabs>
    </>
  );
}

export function ResidentVisitors() {
  const known = useQuery({ queryKey: ["visitors", "known"], queryFn: () => api.get<Page<KnownVisitor>>("/visitors") });
  return (
    <>
      <PageHeader title="Visitor history" description="Every visit to your apartment, with entry and exit times recorded at the gate." actions={inviteButton} />
      <div className="space-y-6">
        <InvitationBrowser
          role="RESIDENT"
          showApartment={false}
          periods={["month", "today", "week", "custom", "all"]}
          defaultPeriod="month"
          testId="visitor-history"
        />
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Frequent visitors</CardTitle>
              <CardDescription>Saved from previous invitations</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {known.isError ? (
              <ErrorState error={known.error} onRetry={() => known.refetch()} />
            ) : (known.data?.items ?? []).length === 0 ? (
              <p className="text-muted-foreground text-[13px]">No visitors yet.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {known.data!.items.slice(0, 9).map((v) => {
                  const Icon = CATEGORY_ICONS[v.category];
                  return (
                    <li key={v.visitorId} className="border-border flex items-center gap-3 rounded-xl border p-3">
                      <span className="bg-primary-softer text-primary flex size-9 items-center justify-center rounded-lg">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{v.fullName}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {v.visitCount} visit{v.visitCount === 1 ? "" : "s"} · last {formatDate(v.lastVisitAt)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function ResidentNotifications() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const pager = useCursorPager(String(unreadOnly));
  const list = useQuery({
    queryKey: ["notifications", { unreadOnly, cursor: pager.cursor }],
    queryFn: () => api.get<Page<AppNotification>>("/notifications", { unreadOnly, limit: 15, cursor: pager.cursor }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  });
  const announcements = useQuery({ queryKey: ["announcements"], queryFn: () => api.get<Page<Announcement>>("/announcements", { limit: 5 }) });
  const markRead = useAction((id: string) => api.patch(`/notifications/${id}/read`), { invalidate: [["notifications"], ["me"]] });
  const markAll = useAction(() => api.post<{ updated: number }>("/notifications/read-all"), {
    success: (r) => (r.updated ? `Marked ${r.updated} as read` : "Already up to date"),
    invalidate: [["notifications"], ["me"]],
  });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Arrivals, approvals, entries, exits and community announcements."
        actions={
          <Button variant="secondary" onClick={() => markAll.mutate(undefined)} loading={markAll.isPending}>
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <div className="border-border flex items-center justify-between border-b px-5 py-3">
            <Tabs value={unreadOnly ? "unread" : "all"} onValueChange={(v) => setUnreadOnly(v === "unread")}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="unread">Unread</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {list.isLoading ? (
            <TableSkeleton cols={2} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data!.items.length === 0 ? (
            <EmptyState icon={Bell} title={unreadOnly ? "No unread notifications" : "No notifications yet"} />
          ) : (
            <ul className="divide-border divide-y">
              {list.data!.items.map((n) => (
                <li key={n.notificationId} className={cn("flex gap-4 px-5 py-4", !n.read && "bg-primary-softer/60")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-border-strong" : "bg-primary")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm font-medium">{n.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-[13px]">{n.message}</p>
                    <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-3 text-xs">
                      <span>{formatRelative(n.createdAt)}</span>
                      {n.link && (
                        <Link href={n.link} className="text-primary font-medium hover:underline">
                          Open
                        </Link>
                      )}
                      {!n.read && (
                        <button className="text-ink-soft hover:text-foreground font-medium" onClick={() => markRead.mutate(n.notificationId)}>
                          Mark as read
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Pager
            page={pager.page}
            hasPrev={pager.hasPrev}
            hasNext={Boolean(list.data?.nextCursor)}
            onPrev={pager.prev}
            onNext={() => pager.next(list.data?.nextCursor ?? null)}
          />
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="text-primary size-4" /> Announcements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(announcements.data?.items ?? []).length === 0 && <p className="text-muted-foreground text-[13px]">No announcements.</p>}
            {announcements.data?.items.map((a) => (
              <article key={a.announcementId} className="border-border border-b pb-4 last:border-0 last:pb-0">
                <div className="mb-1 flex items-center gap-2">
                  {a.priority === "IMPORTANT" && <Badge tone="warning">Important</Badge>}
                  <span className="text-muted-foreground text-xs">
                    {formatRelative(a.createdAt)} · {a.createdByName}
                  </span>
                </div>
                <h3 className="text-sm font-semibold">{a.title}</h3>
                <p className="text-muted-foreground mt-1 text-[13px] whitespace-pre-line">{a.content}</p>
              </article>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
