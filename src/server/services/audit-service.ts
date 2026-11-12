import type { AuditChainReport, AuditLogEntry, Page } from "@/shared/types";
import type { Actor, SystemActor } from "../auth/actor";
import { isConditionFailed } from "../errors";
import { newId } from "../lib/ids";
import { sha256 } from "../lib/crypto";
import type { Deps } from "../ports";
import { AuditRepo } from "../repositories/activity-repo";

type Meta = AuditLogEntry["metadata"];

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

export function auditHash(entry: Omit<AuditLogEntry, "hash">): string {
  return sha256(canonical(entry));
}

/**
 * Tamper-evident audit trail.
 * - Entries are written to a dedicated table that application roles can only
 *   append to (PutItem with attribute_not_exists — no Update/Delete grants).
 * - Each entry stores the hash of its predecessor, forming a hash chain; any
 *   edit or deletion breaks verification from that point on.
 * - A per-community head pointer is advanced with a conditional write so two
 *   writers can never fork the chain.
 */
export class AuditService {
  private readonly repo: AuditRepo;

  constructor(private readonly deps: Deps) {
    this.repo = new AuditRepo(deps.table);
  }

  async record(actor: Actor | SystemActor, action: string, entityType: string, entityId: string, metadata: Meta = {}) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const head = await this.repo.head(actor.communityId);
      const base: Omit<AuditLogEntry, "hash"> = {
        auditId: newId("aud", this.deps.clock().getTime()),
        communityId: actor.communityId,
        seq: head.seq + 1,
        actorId: actor.userId,
        actorName: actor.fullName,
        actorRole: actor.role,
        action,
        entityType,
        entityId,
        timestamp: this.deps.clock().toISOString(),
        metadata,
        prevHash: head.hash,
      };
      const entry: AuditLogEntry = { ...base, hash: auditHash(base) };
      try {
        await this.deps.table.transact(this.repo.appendOps(entry, head.seq));
        return entry;
      } catch (err) {
        if (!isConditionFailed(err)) throw err;
      }
    }
    // The business operation already succeeded; surface the failure loudly in logs.
    this.deps.logger.error("audit.append_failed", { communityId: actor.communityId, action, entityType, entityId });
    return null;
  }

  list(communityId: string, opts: { limit: number; cursor?: string; q?: string }): Promise<Page<AuditLogEntry>> {
    return this.repo.list(communityId, opts);
  }

  /**
   * Checkpoints the current chain head into write-once storage. Run on a
   * schedule; re-running for an already-anchored sequence number is a no-op.
   */
  async anchor(communityId: string): Promise<boolean> {
    const head = await this.repo.head(communityId);
    if (head.seq === 0) return false;
    await this.deps.anchors.put({ communityId, seq: head.seq, hash: head.hash, anchoredAt: this.deps.clock().toISOString() });
    return true;
  }

  /**
   * Walks the chain from genesis, recomputing every hash, and compares it with
   * the anchors. The hash chain alone detects an edited entry; the anchors also
   * detect a wholesale rewrite (an attacker re-hashing every later entry).
   */
  async verifyChain(communityId: string): Promise<AuditChainReport> {
    const anchors = await this.deps.anchors.list(communityId);
    const anchorBySeq = new Map<number, string>();
    for (const a of anchors) {
      const seen = anchorBySeq.get(a.seq);
      if (seen !== undefined && seen !== a.hash) {
        return { verified: false, checked: 0, brokenAtSeq: a.seq, anchorsChecked: 0, reason: "ANCHOR_CONFLICT" };
      }
      anchorBySeq.set(a.seq, a.hash);
    }
    let prevHash = "GENESIS";
    let expectedSeq = 1;
    let checked = 0;
    let anchorsChecked = 0;
    let cursor: string | undefined;
    const fail = (seq: number, reason: AuditChainReport["reason"]): AuditChainReport => ({
      verified: false,
      checked,
      brokenAtSeq: seq,
      anchorsChecked,
      reason,
    });
    do {
      const page = await this.repo.list(communityId, { limit: 100, cursor, ascending: true });
      for (const entry of page.items) {
        const { hash, ...rest } = entry;
        if (entry.seq !== expectedSeq) return fail(expectedSeq, "SEQUENCE_GAP");
        if (entry.prevHash !== prevHash || auditHash(rest) !== hash) return fail(entry.seq, "HASH_MISMATCH");
        const anchored = anchorBySeq.get(entry.seq);
        if (anchored !== undefined) {
          if (anchored !== hash) return fail(entry.seq, "ANCHOR_MISMATCH");
          anchorsChecked++;
        }
        prevHash = hash;
        expectedSeq++;
        checked++;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const maxAnchored = Math.max(0, ...anchorBySeq.keys());
    if (maxAnchored > checked) return fail(checked + 1, "TRUNCATED");
    const head = await this.repo.head(communityId);
    if (head.seq !== checked || head.hash !== prevHash) return fail(checked + 1, "HEAD_MISMATCH");
    return { verified: true, checked, brokenAtSeq: null, anchorsChecked, reason: "OK" };
  }
}
