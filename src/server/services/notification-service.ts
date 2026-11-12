import type { NotificationType } from "@/shared/domain";
import type { AppNotification, Page } from "@/shared/types";
import { isConditionFailed, notFound } from "../errors";
import { newId } from "../lib/ids";
import type { Deps } from "../ports";
import { NotificationRepo } from "../repositories/activity-repo";
import { UserRepo } from "../repositories/user-repo";

export interface NotifyInput {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  /** Identical keys for the same user within 7 days are delivered once. */
  dedupeKey?: string;
}

export class NotificationService {
  private readonly repo: NotificationRepo;
  private readonly users: UserRepo;

  constructor(private readonly deps: Deps) {
    this.repo = new NotificationRepo(deps.table);
    this.users = new UserRepo(deps.table);
  }

  /**
   * Delivers in-app (always) and out-of-app (per user preference). Delivery
   * failures are logged and swallowed — a notification problem must never roll
   * back or fail the gate operation that triggered it.
   */
  async notify(communityId: string, userIds: string[], input: NotifyInput): Promise<number> {
    let delivered = 0;
    for (const userId of new Set(userIds)) {
      try {
        if (await this.deliver(communityId, userId, input)) delivered++;
      } catch (err) {
        this.deps.logger.warn("notification.failed", { communityId, userId, type: input.type, error: (err as Error).name });
      }
    }
    return delivered;
  }

  private async deliver(communityId: string, userId: string, input: NotifyInput): Promise<boolean> {
    const user = await this.users.get(communityId, userId);
    if (!user || user.status !== "ACTIVE") return false;
    const now = this.deps.clock();
    const notification: AppNotification = {
      notificationId: newId("ntf", now.getTime()),
      communityId,
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      read: false,
      createdAt: now.toISOString(),
    };
    try {
      await this.deps.table.transact(this.repo.createOps(notification, input.dedupeKey ?? null, now));
    } catch (err) {
      if (isConditionFailed(err)) return false; // duplicate — already delivered
      throw err;
    }
    const prefs = user.notificationPrefs;
    const wantsExternal = prefs.types.includes(input.type) && (prefs.email || prefs.sms);
    if (wantsExternal) {
      try {
        await this.deps.notifier.send({
          userId,
          email: user.email,
          phone: user.phone,
          subject: input.title,
          body: input.message,
          channels: { email: prefs.email, sms: prefs.sms },
        });
      } catch (err) {
        this.deps.logger.warn("notification.external_failed", { communityId, userId, type: input.type, error: (err as Error).name });
      }
    }
    return true;
  }

  list(communityId: string, userId: string, opts: { unreadOnly: boolean; limit: number; cursor?: string }): Promise<Page<AppNotification>> {
    return this.repo.list(communityId, userId, opts);
  }

  unreadCount(communityId: string, userId: string) {
    return this.repo.unreadCount(communityId, userId);
  }

  async markRead(communityId: string, userId: string, notificationId: string) {
    try {
      // Keyed by the caller's own partition — another user's id simply does not exist here.
      await this.repo.markRead(communityId, userId, notificationId);
    } catch (err) {
      if (isConditionFailed(err)) throw notFound("Notification");
      throw err;
    }
  }

  async markAllRead(communityId: string, userId: string) {
    let cursor: string | undefined;
    let count = 0;
    do {
      const page = await this.repo.list(communityId, userId, { unreadOnly: true, limit: 100, cursor });
      for (const n of page.items) {
        await this.repo.markRead(communityId, userId, n.notificationId);
        count++;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return count;
  }
}
