import { FAILURE_MESSAGES, type GateAction, type VerificationFailure } from "@/shared/domain";
import type { Invitation } from "@/shared/types";

export interface PassEvaluation {
  failure: VerificationFailure | null;
  allowedAction: GateAction | null;
  message: string;
}

/**
 * The single source of truth for "can this pass be used right now?".
 * Pure function — the gate service re-checks atomically at write time.
 */
export function evaluatePass(inv: Invitation, now: Date): PassEvaluation {
  const fail = (failure: VerificationFailure): PassEvaluation => ({
    failure,
    allowedAction: null,
    message: FAILURE_MESSAGES[failure],
  });
  switch (inv.status) {
    case "CHECKED_IN":
      return { failure: null, allowedAction: "EXIT", message: "Visitor is currently inside. Record their exit." };
    case "CANCELLED":
      return fail("CANCELLED");
    case "REJECTED":
      return fail("REJECTED");
    case "PENDING_APPROVAL":
      return fail("PENDING_APPROVAL");
    case "EXPIRED":
      return fail("EXPIRED");
    case "COMPLETED":
      return fail(inv.usagePolicy === "SINGLE_USE" ? "ALREADY_USED" : "EXPIRED");
    case "APPROVED": {
      const t = now.getTime();
      if (t > Date.parse(inv.expiry)) return fail("EXPIRED");
      if (t < Date.parse(inv.validFrom)) return fail("NOT_YET_VALID");
      if (inv.usagePolicy === "SINGLE_USE" && inv.usageCount > 0) return fail("ALREADY_USED");
      return { failure: null, allowedAction: "ENTRY", message: "Pass is valid. Confirm the visitor's identity and record entry." };
    }
  }
}

export function isActive(inv: Invitation): boolean {
  return inv.status === "APPROVED" || inv.status === "PENDING_APPROVAL" || inv.status === "CHECKED_IN";
}
