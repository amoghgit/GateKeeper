"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Inbox, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CATEGORY_LABELS, type InvitationStatus, type Role, STATUS_LABELS, VISITOR_CATEGORIES, type VisitorCategory } from "@/shared/domain";
import type { Invitation, Page } from "@/shared/types";
import { EmptyState, ErrorState, Pager, TableSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { Input, Label, NativeSelect } from "@/components/ui/primitives";
import { api, downloadFile, errorMessage } from "@/lib/api-client";
import { localDay, shiftDay } from "@/lib/format";
import { useCursorPager, useDebounced } from "@/lib/hooks";
import { InvitationDialog } from "./invitation-dialog";
import { InvitationTable } from "./invitation-table";

export type Period = "all" | "today" | "week" | "month" | "upcoming" | "custom";

const PERIOD_LABELS: Record<Period, string> = {
  all: "All time",
  today: "Today",
  week: "This week",
  month: "This month",
  upcoming: "Upcoming",
  custom: "Custom range",
};

export function periodRange(period: Period, custom: { from: string; to: string }): { from?: string; to?: string } {
  const today = localDay();
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const dow = (new Date().getDay() + 6) % 7;
      return { from: shiftDay(today, -dow), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "upcoming":
      return { from: today, to: shiftDay(today, 90) };
    case "custom":
      return { from: custom.from || undefined, to: custom.to || undefined };
    default:
      return {};
  }
}

export interface InvitationBrowserProps {
  role: Role;
  periods?: Period[];
  defaultPeriod?: Period;
  statuses?: InvitationStatus[];
  defaultStatus?: InvitationStatus | "";
  showApartment?: boolean;
  showResident?: boolean;
  allowExport?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  testId?: string;
}

export function InvitationBrowser({
  role,
  periods = ["all", "today", "week", "month", "custom"],
  defaultPeriod = "all",
  statuses = ["PENDING_APPROVAL", "APPROVED", "CHECKED_IN", "COMPLETED", "REJECTED", "CANCELLED", "EXPIRED"],
  defaultStatus = "",
  showApartment = true,
  showResident = false,
  allowExport = false,
  emptyTitle = "No visitors found",
  emptyDescription = "Try a different period or clear the filters.",
  emptyAction,
  testId,
}: InvitationBrowserProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [custom, setCustom] = useState({ from: shiftDay(localDay(), -30), to: localDay() });
  const [status, setStatus] = useState<InvitationStatus | "">(defaultStatus);
  const [category, setCategory] = useState<VisitorCategory | "">("");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);
  const search = useDebounced(q.trim());
  const focus = params.get("focus");

  const range = periodRange(period, custom);
  const filters = { ...range, status: status || undefined, category: category || undefined, q: search.length >= 2 ? search : undefined };
  const pager = useCursorPager(JSON.stringify(filters));
  const list = useQuery({
    queryKey: ["invitations", role, filters, pager.cursor],
    queryFn: () => api.get<Page<Invitation>>("/invitations", { ...filters, limit: 15, cursor: pager.cursor }),
    placeholderData: keepPreviousData,
  });

  const setFocus = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("focus", id);
    else next.delete("focus");
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile("/admin/reports", filters, "gatekeeper-visitors.csv");
      toast.success("Report downloaded");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card data-testid={testId}>
      <div className="border-border flex flex-col gap-3 border-b p-4 sm:p-5 lg:flex-row lg:items-end">
        <div className="relative flex-1">
          <Label htmlFor="inv-search" className="sr-only">
            Search visitors
          </Label>
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
          <Input id="inv-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, code or vehicle" className="pl-9" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex">
          <NativeSelect aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="lg:w-36">
            {periods.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as VisitorCategory | "")} className="lg:w-40">
            <option value="">All categories</option>
            {VISITOR_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as InvitationStatus | "")} className="lg:w-40">
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
          {allowExport && (
            <Button variant="secondary" onClick={exportCsv} loading={exporting}>
              <Download /> Export CSV
            </Button>
          )}
        </div>
      </div>
      {period === "custom" && (
        <div className="border-border bg-surface-muted/40 flex flex-wrap items-end gap-3 border-b px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-1">
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              type="date"
              value={custom.from}
              max={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="date"
              value={custom.to}
              min={custom.from}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              className="w-40"
            />
          </div>
        </div>
      )}
      {list.isLoading ? (
        <TableSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data!.items.length === 0 ? (
        <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        <div className={list.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          <InvitationTable items={list.data!.items} onOpen={setFocus} showApartment={showApartment} showResident={showResident} />
        </div>
      )}
      <Pager
        page={pager.page}
        hasPrev={pager.hasPrev}
        hasNext={Boolean(list.data?.nextCursor)}
        onPrev={pager.prev}
        onNext={() => pager.next(list.data?.nextCursor ?? null)}
        count={list.data?.items.length}
      />
      <InvitationDialog invitationId={focus} role={role} onClose={() => setFocus(null)} />
    </Card>
  );
}
