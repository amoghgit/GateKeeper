"use client";

import { ChevronLeft, ChevronRight, CircleAlert, type LucideIcon, RefreshCw } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/primitives";
import { errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-primary mb-1 text-xs font-medium tracking-wider uppercase">{eyebrow}</p>}
        <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="text-muted-foreground mt-1.5 max-w-2xl text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  emphasis,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  hint?: React.ReactNode;
  emphasis?: "warning" | "danger";
  loading?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground text-[13px] font-medium">{label}</p>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            emphasis === "danger" ? "bg-danger-soft text-danger" : emphasis === "warning" ? "bg-warning-soft text-warning" : "bg-primary-softer text-primary",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-16" />
      ) : (
        <p className="text-foreground mt-2 text-[28px] leading-none font-semibold tracking-tight tabular-nums">{value}</p>
      )}
      {hint && <p className="text-muted-foreground mt-2 text-xs">{hint}</p>}
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <span className="border-border bg-surface-muted text-muted-foreground mb-4 flex size-12 items-center justify-center rounded-2xl border">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-foreground text-sm font-semibold">{title}</p>
      {description && <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span className="bg-danger-soft text-danger mb-4 flex size-12 items-center justify-center rounded-2xl">
        <CircleAlert className="size-5" aria-hidden />
      </span>
      <p className="text-foreground text-sm font-semibold">Couldn&apos;t load this data</p>
      <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-border divide-y" aria-label="Loading" role="status">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-6 px-5 py-4">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-40" : "w-24")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Pager({
  page,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  count,
}: {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  count?: number;
}) {
  if (!hasPrev && !hasNext) return null;
  return (
    <div className="border-border text-muted-foreground flex items-center justify-between border-t px-5 py-3 text-[13px]">
      <span>
        Page {page}
        {count !== undefined && ` · ${count} shown`}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onPrev} disabled={!hasPrev} aria-label="Previous page">
          <ChevronLeft /> Previous
        </Button>
        <Button variant="secondary" size="sm" onClick={onNext} disabled={!hasNext} aria-label="Next page">
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-foreground min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  );
}
