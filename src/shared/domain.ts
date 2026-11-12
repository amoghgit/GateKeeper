/**
 * Domain vocabulary shared by the browser and the server.
 * This module must stay free of Node-only or browser-only imports.
 */

export const ROLES = ["RESIDENT", "SECURITY", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "PENDING", "DEACTIVATED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const VISITOR_CATEGORIES = ["GUEST", "DELIVERY", "CAB", "DOMESTIC_HELP", "MAINTENANCE", "SERVICE_PROVIDER", "OTHER"] as const;
export type VisitorCategory = (typeof VISITOR_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<VisitorCategory, string> = {
  GUEST: "Guest",
  DELIVERY: "Delivery",
  CAB: "Cab / Transport",
  DOMESTIC_HELP: "Domestic Help",
  MAINTENANCE: "Maintenance",
  SERVICE_PROVIDER: "Service Provider",
  OTHER: "Other",
};

/**
 * Invitation lifecycle.
 *
 *   PENDING_APPROVAL ──approve──► APPROVED ──entry──► CHECKED_IN ──exit──► COMPLETED
 *          │                         │  ▲                                   │
 *          └──reject──► REJECTED     │  └──────── (multi-use pass) ◄────────┘
 *                                    ├──cancel──► CANCELLED
 *                                    └──expiry job──► EXPIRED
 */
export const INVITATION_STATUSES = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED", "CHECKED_IN", "COMPLETED"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const STATUS_LABELS: Record<InvitationStatus, string> = {
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  CHECKED_IN: "Inside",
  COMPLETED: "Completed",
};

export const USAGE_POLICIES = ["SINGLE_USE", "MULTI_USE"] as const;
export type UsagePolicy = (typeof USAGE_POLICIES)[number];

export const INVITATION_SOURCES = ["RESIDENT_INVITE", "WALK_IN"] as const;
export type InvitationSource = (typeof INVITATION_SOURCES)[number];

export const VISIT_EVENT_TYPES = [
  "QR_SCAN_OK",
  "QR_SCAN_FAILED",
  "ENTRY",
  "EXIT",
  "ENTRY_DENIED",
  "WALK_IN_REGISTERED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type VisitEventType = (typeof VISIT_EVENT_TYPES)[number];

export const EVENT_LABELS: Record<VisitEventType, string> = {
  QR_SCAN_OK: "QR verified",
  QR_SCAN_FAILED: "Verification failed",
  ENTRY: "Entry recorded",
  EXIT: "Exit recorded",
  ENTRY_DENIED: "Entry denied",
  WALK_IN_REGISTERED: "Walk-in registered",
  APPROVED: "Approved by resident",
  REJECTED: "Rejected by resident",
  CANCELLED: "Invitation cancelled",
  EXPIRED: "Invitation expired",
};

export const NOTIFICATION_TYPES = [
  "VISITOR_REQUEST",
  "VISITOR_APPROVED",
  "VISITOR_REJECTED",
  "VISITOR_ARRIVAL",
  "VISITOR_ENTRY",
  "VISITOR_EXIT",
  "INVITATION_EXPIRED",
  "VISITOR_OVERDUE",
  "ANNOUNCEMENT",
  "ACCOUNT",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const SHIFTS = ["MORNING", "EVENING", "NIGHT", "UNASSIGNED"] as const;
export type Shift = (typeof SHIFTS)[number];

export const SHIFT_LABELS: Record<Shift, string> = {
  MORNING: "Morning · 06:00–14:00",
  EVENING: "Evening · 14:00–22:00",
  NIGHT: "Night · 22:00–06:00",
  UNASSIGNED: "Unassigned",
};

/** Machine-readable reasons returned when a pass cannot be used. */
export const VERIFICATION_FAILURES = [
  "INVALID_TOKEN",
  "WRONG_COMMUNITY",
  "EXPIRED",
  "NOT_YET_VALID",
  "CANCELLED",
  "REJECTED",
  "PENDING_APPROVAL",
  "ALREADY_USED",
] as const;
export type VerificationFailure = (typeof VERIFICATION_FAILURES)[number];

export const FAILURE_MESSAGES: Record<VerificationFailure, string> = {
  INVALID_TOKEN: "This QR code is not a valid GateKeeper pass.",
  WRONG_COMMUNITY: "This pass belongs to a different community.",
  EXPIRED: "This pass has expired.",
  NOT_YET_VALID: "This pass is not valid yet. Check the expected arrival time.",
  CANCELLED: "The resident cancelled this invitation.",
  REJECTED: "The resident rejected this visitor.",
  PENDING_APPROVAL: "The resident has not approved this visitor yet.",
  ALREADY_USED: "This single-use pass has already been used.",
};

export type GateAction = "ENTRY" | "EXIT";

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  /** Event types the user wants delivered outside the app. In-app is always on. */
  types: NotificationType[];
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  email: false,
  sms: false,
  types: ["VISITOR_REQUEST", "VISITOR_ENTRY", "VISITOR_EXIT", "VISITOR_OVERDUE", "ANNOUNCEMENT"],
};

/** Landing page for a signed-in account. Accounts without an active role wait on /pending. */
export function dashboardFor(role: Role | null): string {
  if (role === "ADMIN") return "/admin/dashboard";
  if (role === "SECURITY") return "/security/dashboard";
  if (role === "RESIDENT") return "/resident/dashboard";
  return "/pending";
}
