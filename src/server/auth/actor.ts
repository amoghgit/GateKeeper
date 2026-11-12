import type { Role } from "@/shared/domain";
import type { Invitation } from "@/shared/types";
import { forbidden, notFound } from "../errors";

/**
 * The verified caller. Built server-side from the identity token's subject and
 * the stored user record — never from anything the browser sends.
 */
export interface Actor {
  userId: string;
  communityId: string;
  role: Role;
  fullName: string;
  email: string;
  apartmentId: string | null;
  apartmentLabel: string | null;
}

export interface SystemActor {
  userId: "system";
  communityId: string;
  role: "SYSTEM";
  fullName: "GateKeeper automation";
}

export const systemActor = (communityId: string): SystemActor => ({
  userId: "system",
  communityId,
  role: "SYSTEM",
  fullName: "GateKeeper automation",
});

export function requireRole(actor: Actor, ...roles: Role[]): void {
  if (!roles.includes(actor.role)) throw forbidden();
}

/** Residents need an apartment assignment before they can manage visitors. */
export function requireApartment(actor: Actor): string {
  if (actor.role !== "RESIDENT" || !actor.apartmentId) {
    throw forbidden("Your account is not linked to an apartment yet. Contact your administrator.");
  }
  return actor.apartmentId;
}

/**
 * Object-level authorization (IDOR protection). Records from other tenants or —
 * for residents — other apartments are reported as "not found" so their
 * existence is not disclosed.
 */
export function assertCanView(actor: Actor, inv: Pick<Invitation, "communityId" | "apartmentId">): void {
  if (inv.communityId !== actor.communityId) throw notFound("Invitation");
  if (actor.role === "RESIDENT" && inv.apartmentId !== actor.apartmentId) throw notFound("Invitation");
}

export function assertSameCommunity(actor: Actor, communityId: string, entity = "Record"): void {
  if (communityId !== actor.communityId) throw notFound(entity);
}
