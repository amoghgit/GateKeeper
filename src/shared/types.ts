import type {
  GateAction,
  InvitationSource,
  InvitationStatus,
  NotificationPreferences,
  NotificationType,
  Role,
  Shift,
  UsagePolicy,
  UserStatus,
  VerificationFailure,
  VisitEventType,
  VisitorCategory,
} from "./domain";

/** Every API success response is `{ data: T }`. */
export interface ApiSuccess<T> {
  data: T;
}

/** Every API error response is `{ error: {...} }`. Stack traces are never included. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: Record<string, string[]>;
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CommunitySettings {
  /** Minutes before expected arrival that a pass becomes valid. */
  entryGraceMinutes: number;
  /** Minutes after expected departure before an inside visitor is flagged overdue. */
  overdueAfterMinutes: number;
  /** Whether walk-ins registered by security need resident approval before entry. */
  walkInsRequireApproval: boolean;
  /** Send reminders to residents for visitors arriving within the hour. */
  remindersEnabled: boolean;
}

export interface Community {
  communityId: string;
  name: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  timezone: string;
  /** Short code residents use to self-register. */
  joinCode: string;
  settings: CommunitySettings;
  createdAt: string;
}

export interface Building {
  buildingId: string;
  communityId: string;
  name: string;
  blocks: string[];
  floors: number;
  createdAt: string;
}

export interface Apartment {
  apartmentId: string;
  communityId: string;
  buildingId: string;
  buildingName: string;
  block: string | null;
  floor: number;
  unitNumber: string;
  createdAt: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
}

export interface UserProfile {
  userId: string;
  communityId: string;
  fullName: string;
  email: string;
  phone: string;
  role: Role | null;
  status: UserStatus;
  apartmentId: string | null;
  apartmentLabel: string | null;
  shift: Shift | null;
  emergencyContact: EmergencyContact | null;
  notificationPrefs: NotificationPreferences;
  /** Self-registration details awaiting admin review. */
  requestedUnit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VisitorDetails {
  fullName: string;
  phone: string;
  category: VisitorCategory;
  purpose: string;
  vehicleNumber: string | null;
}

export interface Invitation {
  invitationId: string;
  /** Short human-friendly code for manual lookup at the gate, e.g. "K7Q-4MX". */
  code: string;
  communityId: string;
  visitorId: string;
  visitor: VisitorDetails;
  residentId: string;
  residentName: string;
  apartmentId: string;
  apartmentLabel: string;
  expectedArrival: string;
  expectedDeparture: string;
  validFrom: string;
  expiry: string;
  status: InvitationStatus;
  usagePolicy: UsagePolicy;
  usageCount: number;
  source: InvitationSource;
  notes: string | null;
  /** Object key of a photo captured at the gate (walk-ins), if any. */
  photoKey: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  lastEntryAt: string | null;
  lastEntryGuardName: string | null;
  lastExitAt: string | null;
  lastExitGuardName: string | null;
  overdue: boolean;
}

/** Returned exactly once — on creation or regeneration — to the owning resident. */
export interface IssuedPass {
  invitation: Invitation;
  qrPayload: string;
}

export interface VisitEvent {
  eventId: string;
  communityId: string;
  invitationId: string | null;
  visitorName: string | null;
  apartmentId: string | null;
  apartmentLabel: string | null;
  eventType: VisitEventType;
  actorId: string;
  actorName: string;
  timestamp: string;
  detail: string | null;
}

export interface AppNotification {
  notificationId: string;
  communityId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface Announcement {
  announcementId: string;
  communityId: string;
  title: string;
  content: string;
  priority: "NORMAL" | "IMPORTANT";
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface AuditLogEntry {
  auditId: string;
  communityId: string;
  seq: number;
  actorId: string;
  actorName: string;
  actorRole: Role | "SYSTEM";
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  metadata: Record<string, string | number | boolean | null>;
  prevHash: string;
  hash: string;
}

export interface AuditChainReport {
  verified: boolean;
  checked: number;
  brokenAtSeq: number | null;
  /** Checkpoints from write-once storage that were compared against the chain. */
  anchorsChecked: number;
  reason: "OK" | "HASH_MISMATCH" | "SEQUENCE_GAP" | "HEAD_MISMATCH" | "ANCHOR_MISMATCH" | "ANCHOR_CONFLICT" | "TRUNCATED";
}

export interface VerificationResult {
  valid: boolean;
  failure: VerificationFailure | null;
  message: string;
  invitation: Invitation | null;
  /** The gate action a guard may take next, if any. */
  allowedAction: GateAction | null;
}

export interface DailySummary {
  date: string;
  entries: number;
  exits: number;
  denied: number;
  invitations: number;
  categories: Partial<Record<VisitorCategory, number>>;
}

export interface ResidentOverview {
  visitorsThisMonth: number;
  insideNow: number;
  pendingRequests: number;
  upcoming: Invitation[];
  recentActivity: VisitEvent[];
  announcements: Announcement[];
}

export interface SecurityOverview {
  insideNow: number;
  expectedToday: number;
  pendingApprovals: number;
  entriesToday: number;
  exitsToday: number;
  overdue: number;
  expectedList: Invitation[];
  recentActivity: VisitEvent[];
}

export interface AdminAnalytics {
  totals: {
    residents: number;
    securityStaff: number;
    pendingRegistrations: number;
    entriesToday: number;
    insideNow: number;
    visitorsThisMonth: number;
    deniedThisMonth: number;
  };
  daily: DailySummary[];
  weekly: { week: string; entries: number; exits: number }[];
  monthly: { month: string; visitors: number }[];
  categories: { category: VisitorCategory; count: number }[];
}

export interface SessionUser {
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  communityId: string;
  communityName: string;
}

export interface CreatedAccount {
  user: UserProfile;
  /** Present only in LOCAL_DEMO, where no invitation e-mail can be sent. */
  temporaryPassword: string | null;
}

export interface UploadTicket {
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  objectKey: string;
  expiresAt: string;
}

export interface DemoOutboxEntry {
  id: string;
  channel: "EMAIL" | "SMS" | "AUTH";
  to: string;
  subject: string;
  body: string;
  createdAt: string;
}

export interface InvitationDetail {
  invitation: Invitation;
  timeline: VisitEvent[];
}

export interface KnownVisitor {
  visitorId: string;
  apartmentId: string;
  fullName: string;
  phone: string;
  category: VisitorCategory;
  purpose: string;
  vehicleNumber: string | null;
  visitCount: number;
  lastVisitAt: string;
}

export interface MeResponse {
  profile: UserProfile;
  community: Pick<Community, "communityId" | "name" | "timezone">;
  unreadNotifications: number;
}
