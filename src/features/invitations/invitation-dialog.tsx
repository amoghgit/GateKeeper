"use client";

import { useQuery } from "@tanstack/react-query";
import { Ban, Check, DoorClosed, DoorOpen, QrCode, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { EVENT_LABELS, type Role } from "@/shared/domain";
import type { Invitation, InvitationDetail, IssuedPass } from "@/shared/types";
import { CategoryLabel, StatusBadge } from "@/components/shared/badges";
import { DetailRow, ErrorState } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { Field, Skeleton, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { QrPass } from "./qr-pass";

const INVALIDATE = [["invitations"], ["invitation"], ["overview"], ["me"], ["inside"], ["activity"]];

export function InvitationDialog({ invitationId, role, onClose }: { invitationId: string | null; role: Role; onClose: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pass, setPass] = useState<IssuedPass | null>(null);

  const detail = useQuery({
    queryKey: ["invitation", invitationId],
    queryFn: () => api.get<InvitationDetail>(`/invitations/${invitationId}`),
    enabled: Boolean(invitationId),
  });
  const inv = detail.data?.invitation;

  const reset = () => {
    setRejecting(false);
    setReason("");
    setPass(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const approve = useAction(() => api.post<Invitation>(`/invitations/${invitationId}/approve`), {
    success: "Visitor approved — the gate can admit them now.",
    invalidate: INVALIDATE,
  });
  const reject = useAction(() => api.post<Invitation>(`/invitations/${invitationId}/reject`, { reason }), {
    success: "Visitor rejected",
    invalidate: INVALIDATE,
    onSuccess: reset,
  });
  const cancel = useAction(() => api.post<Invitation>(`/invitations/${invitationId}/cancel`), { success: "Invitation cancelled", invalidate: INVALIDATE });
  const showPass = useAction(() => api.get<IssuedPass>(`/invitations/${invitationId}/pass`), { onSuccess: setPass });
  const regenerate = useAction(() => api.post<IssuedPass>(`/invitations/${invitationId}/regenerate`), {
    success: "New pass issued. The previous QR code no longer works.",
    invalidate: INVALIDATE,
    onSuccess: setPass,
  });
  const entry = useAction(() => api.post<Invitation>("/security/record-entry", { invitationId }), { success: "Entry recorded", invalidate: INVALIDATE });
  const exit = useAction(() => api.post<Invitation>("/security/record-exit", { invitationId }), { success: "Exit recorded", invalidate: INVALIDATE });

  const active = inv && ["PENDING_APPROVAL", "APPROVED"].includes(inv.status);

  return (
    <Dialog open={Boolean(invitationId)} onOpenChange={(o) => !o && close()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{inv ? inv.visitor.fullName : "Visitor details"}</DialogTitle>
          <DialogDescription>{inv ? `${inv.apartmentLabel} · Invitation ${inv.code}` : "Loading invitation…"}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {detail.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {detail.isError && <ErrorState error={detail.error} onRetry={() => detail.refetch()} />}
          {inv && pass && (
            <div className="mb-6">
              <QrPass invitation={pass.invitation} payload={pass.qrPayload} />
            </div>
          )}
          {inv && (
            <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
              <dl className="divide-border divide-y">
                <DetailRow label="Status">
                  <StatusBadge status={inv.status} overdue={inv.overdue} />
                </DetailRow>
                <DetailRow label="Category">
                  <CategoryLabel category={inv.visitor.category} />
                </DetailRow>
                <DetailRow label="Purpose">{inv.visitor.purpose}</DetailRow>
                <DetailRow label="Phone">{inv.visitor.phone}</DetailRow>
                {inv.visitor.vehicleNumber && <DetailRow label="Vehicle">{inv.visitor.vehicleNumber}</DetailRow>}
                <DetailRow label="Expected">
                  {formatDateTime(inv.expectedArrival)} – {formatDateTime(inv.expectedDeparture)}
                </DetailRow>
                <DetailRow label="Pass">
                  {inv.usagePolicy === "MULTI_USE" ? `Recurring · used ${inv.usageCount}×` : inv.usageCount ? "Single use · used" : "Single use"}
                </DetailRow>
                <DetailRow label="Created by">
                  {inv.createdByName}
                  {inv.source === "WALK_IN" && " (walk-in at gate)"}
                </DetailRow>
                {inv.lastEntryAt && <DetailRow label="Entered">{`${formatDateTime(inv.lastEntryAt)} · ${inv.lastEntryGuardName}`}</DetailRow>}
                {inv.lastExitAt && <DetailRow label="Left">{`${formatDateTime(inv.lastExitAt)} · ${inv.lastExitGuardName}`}</DetailRow>}
                {inv.rejectionReason && <DetailRow label="Reason">{inv.rejectionReason}</DetailRow>}
                {inv.notes && <DetailRow label="Notes">{inv.notes}</DetailRow>}
                {inv.photoKey && <DetailRow label="Gate photo">Captured and stored securely</DetailRow>}
              </dl>
              <div>
                <p className="text-muted-foreground mb-3 text-xs font-medium tracking-wider uppercase">Gate verification timeline</p>
                {detail.data!.timeline.length === 0 ? (
                  <p className="text-muted-foreground text-[13px]">No gate activity yet.</p>
                ) : (
                  <ol className="border-border relative space-y-4 border-l pl-5">
                    {detail.data!.timeline.map((e) => (
                      <li key={e.eventId} className="relative">
                        <span className="bg-primary ring-surface absolute top-1.5 -left-[25px] size-2 rounded-full ring-4" aria-hidden />
                        <p className="text-foreground text-[13px] font-medium">{EVENT_LABELS[e.eventType]}</p>
                        <p className="text-muted-foreground text-xs">
                          {formatDateTime(e.timestamp)} · {e.actorName}
                          {e.detail ? ` · ${e.detail.replaceAll("_", " ").toLowerCase()}` : ""}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
          {rejecting && (
            <div className="border-border bg-surface-muted/50 mt-6 rounded-xl border p-4">
              <Field label="Reason for rejection" htmlFor="reject-reason" optional hint="Shared with the gate so security can turn the visitor away politely.">
                <Textarea id="reject-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="min-h-16" />
              </Field>
            </div>
          )}
        </DialogBody>
        {inv && (
          <DialogFooter>
            {role === "RESIDENT" && inv.status === "PENDING_APPROVAL" && !rejecting && (
              <>
                <Button variant="danger-outline" onClick={() => setRejecting(true)}>
                  <X /> Reject
                </Button>
                <Button onClick={() => approve.mutate(undefined)} loading={approve.isPending}>
                  <Check /> Approve entry
                </Button>
              </>
            )}
            {rejecting && (
              <>
                <Button variant="ghost" onClick={() => setRejecting(false)}>
                  Back
                </Button>
                <Button variant="danger" onClick={() => reject.mutate(undefined)} loading={reject.isPending}>
                  Confirm rejection
                </Button>
              </>
            )}
            {(role === "RESIDENT" || role === "ADMIN") && active && !rejecting && (
              <Button variant="ghost" className="sm:mr-auto" onClick={() => cancel.mutate(undefined)} loading={cancel.isPending}>
                <Ban /> Cancel invitation
              </Button>
            )}
            {role === "RESIDENT" && active && !rejecting && (
              <>
                <Button variant="secondary" onClick={() => regenerate.mutate(undefined)} loading={regenerate.isPending}>
                  <RefreshCw /> New QR
                </Button>
                {!pass && (
                  <Button variant="secondary" onClick={() => showPass.mutate(undefined)} loading={showPass.isPending}>
                    <QrCode /> Show pass
                  </Button>
                )}
              </>
            )}
            {role === "RESIDENT" && inv.status === "CHECKED_IN" && !pass && (
              <Button variant="secondary" onClick={() => showPass.mutate(undefined)} loading={showPass.isPending}>
                <QrCode /> Show pass
              </Button>
            )}
            {role === "SECURITY" && inv.status === "APPROVED" && (
              <Button onClick={() => entry.mutate(undefined)} loading={entry.isPending}>
                <DoorOpen /> Record entry
              </Button>
            )}
            {role === "SECURITY" && inv.status === "CHECKED_IN" && (
              <Button variant="dark" onClick={() => exit.mutate(undefined)} loading={exit.isPending}>
                <DoorClosed /> Record exit
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
