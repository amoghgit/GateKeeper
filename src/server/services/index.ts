import type { Deps } from "../ports";
import { AnalyticsService } from "./analytics-service";
import { AuditService } from "./audit-service";
import { GateService } from "./gate-service";
import { InvitationService } from "./invitation-service";
import { JobsService } from "./jobs-service";
import { NotificationService } from "./notification-service";
import { AnnouncementService, PropertyService } from "./property-service";
import { UserService } from "./user-service";

export function createServices(deps: Deps) {
  const audit = new AuditService(deps);
  const notifications = new NotificationService(deps);
  const invitations = new InvitationService(deps, audit, notifications);
  const gate = new GateService(deps, invitations, audit);
  const analytics = new AnalyticsService(deps, invitations, gate);
  return {
    audit,
    notifications,
    invitations,
    gate,
    analytics,
    users: new UserService(deps, audit, notifications),
    property: new PropertyService(deps, audit),
    announcements: new AnnouncementService(deps, audit, notifications),
    jobs: new JobsService(deps, invitations, analytics, audit, notifications),
  };
}

export type Services = ReturnType<typeof createServices>;
