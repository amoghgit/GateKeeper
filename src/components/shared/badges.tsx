import { Briefcase, Car, CircleHelp, Hammer, House, Package, UserRound, type LucideIcon } from "lucide-react";
import { CATEGORY_LABELS, EVENT_LABELS, STATUS_LABELS, type InvitationStatus, type VisitEventType, type VisitorCategory } from "@/shared/domain";
import { Badge } from "@/components/ui/primitives";

const STATUS_TONES: Record<InvitationStatus, "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "dark"> = {
  PENDING_APPROVAL: "warning",
  APPROVED: "primary",
  CHECKED_IN: "success",
  COMPLETED: "neutral",
  REJECTED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

export function StatusBadge({ status, overdue }: { status: InvitationStatus; overdue?: boolean }) {
  if (status === "CHECKED_IN" && overdue) {
    return (
      <Badge tone="danger" dot>
        Overdue
      </Badge>
    );
  }
  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export const CATEGORY_ICONS: Record<VisitorCategory, LucideIcon> = {
  GUEST: UserRound,
  DELIVERY: Package,
  CAB: Car,
  DOMESTIC_HELP: House,
  MAINTENANCE: Hammer,
  SERVICE_PROVIDER: Briefcase,
  OTHER: CircleHelp,
};

export function CategoryLabel({ category }: { category: VisitorCategory }) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <span className="text-ink-soft inline-flex items-center gap-1.5">
      <Icon className="text-muted-foreground size-3.5" aria-hidden />
      {CATEGORY_LABELS[category]}
    </span>
  );
}

const EVENT_TONES: Record<VisitEventType, "neutral" | "primary" | "success" | "warning" | "danger" | "info"> = {
  QR_SCAN_OK: "primary",
  QR_SCAN_FAILED: "danger",
  ENTRY: "success",
  EXIT: "info",
  ENTRY_DENIED: "danger",
  WALK_IN_REGISTERED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

export function EventBadge({ type }: { type: VisitEventType }) {
  return <Badge tone={EVENT_TONES[type]}>{EVENT_LABELS[type]}</Badge>;
}
