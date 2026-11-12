"use client";

import { CircleCheck, CircleX, DoorClosed, DoorOpen, ScanLine } from "lucide-react";
import type { Invitation, VerificationResult } from "@/shared/types";
import { CategoryLabel, StatusBadge } from "@/components/shared/badges";
import { DetailRow } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const INVALIDATE = [["overview"], ["inside"], ["activity"], ["invitations"], ["invitation"]];

/**
 * Result of a scan or lookup. Entry/exit buttons send the original scanned
 * payload (or the invitation id for manual lookups) — the server re-validates
 * atomically, so a stale screen can never admit someone it shouldn't.
 */
export function VerificationPanel({ result, payload, onDone }: { result: VerificationResult; payload: string | null; onDone: () => void }) {
  const target = payload ? { payload } : { invitationId: result.invitation?.invitationId };
  const entry = useAction(() => api.post<Invitation>("/security/record-entry", target), {
    success: (i) => `Entry recorded for ${i.visitor.fullName}`,
    invalidate: INVALIDATE,
    onSuccess: onDone,
  });
  const exit = useAction(() => api.post<Invitation>("/security/record-exit", target), {
    success: (i) => `Exit recorded for ${i.visitor.fullName}`,
    invalidate: INVALIDATE,
    onSuccess: onDone,
  });
  const inv = result.invitation;

  return (
    <Card
      className={cn("animate-slide-up overflow-hidden", result.valid ? "border-success/40" : "border-danger/40")}
      data-testid="verification-result"
      data-valid={result.valid}
    >
      <div className={cn("flex items-start gap-3 px-5 py-4", result.valid ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
        {result.valid ? <CircleCheck className="mt-0.5 size-6 shrink-0" /> : <CircleX className="mt-0.5 size-6 shrink-0" />}
        <div>
          <p className="text-base font-semibold" data-testid="verification-title">
            {result.valid ? (result.allowedAction === "EXIT" ? "Visitor is inside" : "Pass verified") : "Access denied"}
          </p>
          <p className="text-[13px] opacity-90" data-testid="verification-message">
            {result.message}
          </p>
        </div>
      </div>
      {inv && (
        <div className="px-5 py-2">
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-lg font-semibold tracking-tight">{inv.visitor.fullName}</p>
              <p className="text-muted-foreground text-[13px]">{inv.visitor.phone}</p>
            </div>
            <StatusBadge status={inv.status} overdue={inv.overdue} />
          </div>
          <dl className="divide-border border-border divide-y border-t">
            <DetailRow label="Visiting">{`${inv.apartmentLabel} · ${inv.residentName}`}</DetailRow>
            <DetailRow label="Category">
              <CategoryLabel category={inv.visitor.category} />
            </DetailRow>
            <DetailRow label="Purpose">{inv.visitor.purpose}</DetailRow>
            {inv.visitor.vehicleNumber && <DetailRow label="Vehicle">{inv.visitor.vehicleNumber}</DetailRow>}
            <DetailRow label="Valid">{`${formatDateTime(inv.validFrom)} – ${formatDateTime(inv.expiry)}`}</DetailRow>
            <DetailRow label="Approval">
              {inv.status === "PENDING_APPROVAL" ? "Awaiting resident" : inv.decidedAt ? `Approved ${formatDateTime(inv.decidedAt)}` : "—"}
            </DetailRow>
            {inv.notes && <DetailRow label="Resident notes">{inv.notes}</DetailRow>}
          </dl>
        </div>
      )}
      <div className="border-border bg-surface-muted/40 flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onDone}>
          <ScanLine /> Scan next
        </Button>
        {result.allowedAction === "ENTRY" && (
          <Button size="lg" onClick={() => entry.mutate(undefined)} loading={entry.isPending}>
            <DoorOpen /> Confirm identity & record entry
          </Button>
        )}
        {result.allowedAction === "EXIT" && (
          <Button size="lg" variant="dark" onClick={() => exit.mutate(undefined)} loading={exit.isPending}>
            <DoorClosed /> Record exit
          </Button>
        )}
      </div>
    </Card>
  );
}
