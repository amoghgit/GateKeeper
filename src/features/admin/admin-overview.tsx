"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Ban, DoorOpen, LogIn, ShieldCheck, UserPlus, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { CATEGORY_LABELS } from "@/shared/domain";
import type { AdminAnalytics } from "@/shared/types";
import { ErrorState, PageHeader, StatCard } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { CurrentlyInside } from "@/features/security/security-pages";
import { ChartCard, GroupedBars, HorizontalBars, TrendLines } from "./charts";

const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

export function useAnalytics() {
  return useQuery({ queryKey: ["overview", "admin"], queryFn: () => api.get<AdminAnalytics>("/admin/analytics"), refetchInterval: 30_000 });
}

function Totals({ data }: { data: AdminAnalytics | undefined }) {
  const t = data?.totals;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Residents" value={t?.residents ?? 0} icon={Users} loading={!t} />
      <StatCard label="Security staff" value={t?.securityStaff ?? 0} icon={ShieldCheck} loading={!t} />
      <StatCard label="Entries today" value={t?.entriesToday ?? 0} icon={LogIn} loading={!t} />
      <StatCard label="Inside now" value={t?.insideNow ?? 0} icon={DoorOpen} loading={!t} />
      <StatCard label="Visitors this month" value={t?.visitorsThisMonth ?? 0} icon={UsersRound} loading={!t} hint="Recorded entries" />
      <StatCard
        label="Denied this month"
        value={t?.deniedThisMonth ?? 0}
        icon={Ban}
        loading={!t}
        emphasis={t && t.deniedThisMonth > 0 ? "danger" : undefined}
        hint="Failed scans & refused entries"
      />
    </div>
  );
}

function categoryRows(data: AdminAnalytics) {
  return [...data.categories].sort((a, b) => b.count - a.count).map((c) => ({ label: CATEGORY_LABELS[c.category], value: c.count }));
}

export function AdminDashboard() {
  const a = useAnalytics();
  const data = a.data;
  return (
    <>
      <PageHeader
        title="Community overview"
        description="Today's gate activity and the health of your community at a glance."
        actions={
          <Button asChild>
            <Link href="/admin/residents?add=1">
              <UserPlus /> Add resident
            </Link>
          </Button>
        }
      />
      {a.isError ? (
        <Card>
          <ErrorState error={a.error} onRetry={() => a.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          {data && data.totals.pendingRegistrations > 0 && (
            <Link
              href="/admin/residents?tab=pending"
              className="border-warning/30 bg-warning-soft text-warning flex items-center gap-3 rounded-xl border px-4 py-3 text-sm"
            >
              <UserPlus className="size-4" />
              <span className="flex-1">
                <strong>{data.totals.pendingRegistrations}</strong> resident registration{data.totals.pendingRegistrations === 1 ? "" : "s"} awaiting review.
              </span>
              <ArrowRight className="size-4" />
            </Link>
          )}
          <Totals data={data} />
          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            {data ? (
              <ChartCard
                title="Daily visitor traffic"
                description="Entries and exits, last 14 days"
                legend={["entries", "exits"]}
                rows={data.daily.slice(-14)}
                columns={[
                  { key: "date", label: "Date", format: (v) => dayLabel(String(v)) },
                  { key: "entries", label: "Entries" },
                  { key: "exits", label: "Exits" },
                ]}
              >
                <TrendLines data={data.daily.slice(-14)} xKey="date" xFormat={dayLabel} />
              </ChartCard>
            ) : (
              <Skeleton className="h-80" />
            )}
            {data ? (
              <ChartCard
                title="Visitor mix"
                description="By category, last 30 days"
                rows={categoryRows(data)}
                columns={[
                  { key: "label", label: "Category" },
                  { key: "value", label: "Visits" },
                ]}
              >
                <HorizontalBars data={categoryRows(data)} />
              </ChartCard>
            ) : (
              <Skeleton className="h-80" />
            )}
          </div>
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Visitors inside the premises</h2>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/admin/visitors">
                  All visitors <ArrowRight />
                </Link>
              </Button>
            </div>
            <CurrentlyInside role="ADMIN" embedded />
          </div>
        </div>
      )}
    </>
  );
}

export function AdminAnalyticsPage() {
  const a = useAnalytics();
  const data = a.data;
  if (a.isError) return <ErrorState error={a.error} onRetry={() => a.refetch()} />;
  const weekLabel = (w: string) => `w/c ${dayLabel(w)}`;
  return (
    <>
      <PageHeader title="Analytics" description="Traffic patterns built from daily summaries computed by the scheduled summary job." />
      <Totals data={data} />
      {!data ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <ChartCard
            className="lg:col-span-2"
            title="Entry and exit trends"
            description="Daily, last 30 days"
            legend={["entries", "exits"]}
            rows={data.daily}
            columns={[
              { key: "date", label: "Date", format: (v) => dayLabel(String(v)) },
              { key: "entries", label: "Entries" },
              { key: "exits", label: "Exits" },
              { key: "denied", label: "Denied" },
            ]}
          >
            <TrendLines data={data.daily} xKey="date" xFormat={dayLabel} />
          </ChartCard>
          <ChartCard
            title="Weekly trends"
            description="Entries and exits per week, last 8 weeks"
            legend={["entries", "exits"]}
            rows={data.weekly}
            columns={[
              { key: "week", label: "Week", format: (v) => weekLabel(String(v)) },
              { key: "entries", label: "Entries" },
              { key: "exits", label: "Exits" },
            ]}
          >
            <GroupedBars data={data.weekly} xKey="week" xFormat={(w) => dayLabel(w)} keys={["entries", "exits"]} />
          </ChartCard>
          <ChartCard
            title="Monthly visitor volume"
            description="Recorded entries per month"
            rows={data.monthly}
            columns={[
              { key: "month", label: "Month", format: (v) => monthLabel(String(v)) },
              { key: "visitors", label: "Entries" },
            ]}
          >
            <GroupedBars data={data.monthly.map((m) => ({ month: m.month, entries: m.visitors }))} xKey="month" xFormat={monthLabel} keys={["entries"]} />
          </ChartCard>
          <ChartCard
            className="lg:col-span-2"
            title="Visitor category distribution"
            description="Invitations by category, last 30 days"
            rows={categoryRows(data)}
            columns={[
              { key: "label", label: "Category" },
              { key: "value", label: "Invitations" },
            ]}
          >
            <HorizontalBars data={categoryRows(data)} />
          </ChartCard>
        </div>
      )}
      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>How these numbers are computed</CardTitle>
            <CardDescription>
              Past days come from stored daily summaries; today is computed live from the gate event stream. &ldquo;Denied&rdquo; counts failed QR verifications
              and refused entries.
            </CardDescription>
          </div>
        </CardHeader>
        <div className="pb-5" />
      </Card>
    </>
  );
}
