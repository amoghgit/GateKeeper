import { z } from "zod";
import {
  activityQuerySchema,
  announcementSchema,
  apartmentSchema,
  approveRegistrationSchema,
  buildingSchema,
  communitySettingsSchema,
  createGuardSchema,
  createInvitationSchema,
  createResidentSchema,
  decisionSchema,
  gateActionSchema,
  invitationQuerySchema,
  lookupSchema,
  notificationQuerySchema,
  pageQuerySchema,
  updateGuardSchema,
  updateProfileSchema,
  updateResidentSchema,
  uploadRequestSchema,
  userQuerySchema,
  verifyQrSchema,
  walkInSchema,
} from "@/shared/schemas";
import { localDate } from "@/shared/time";
import { requireRole } from "../auth/actor";
import { forbidden } from "../errors";
import { JOB_NAMES } from "../services/jobs-service";
import { parseWith, queryObject, readJson, type RouteDef } from "./http";

const id = (ctx: { params: Record<string, string> }) => z.string().min(1).max(64).parse(ctx.params.id);
const q = (ctx: { req: { query: URLSearchParams } }) => queryObject(ctx.req.query);

export const routes: RouteDef[] = [
  // ───────────────────────────── Profile ─────────────────────────────
  {
    method: "GET",
    path: "/me",
    access: "authenticated",
    handler: async ({ runtime, user }) => ({ data: await runtime.services.users.me(user) }),
  },
  {
    method: "PATCH",
    path: "/me",
    access: "active",
    handler: async ({ runtime, actor, req }) => ({ data: await runtime.services.users.updateMe(actor, parseWith(updateProfileSchema, readJson(req))) }),
  },

  // ───────────────────────────── Residents ─────────────────────────────
  {
    method: "GET",
    path: "/residents",
    access: ["ADMIN"],
    handler: async (ctx) => {
      const query = parseWith(userQuerySchema, q(ctx));
      const pending = ctx.req.query.get("pending") === "true";
      return { data: await ctx.runtime.services.users.list(ctx.actor, pending ? "PENDING" : "RESIDENT", query) };
    },
  },
  {
    method: "POST",
    path: "/residents",
    access: ["ADMIN"],
    rateLimit: 30,
    handler: async ({ runtime, actor, req }) => ({
      status: 201,
      data: await runtime.services.users.createResident(actor, parseWith(createResidentSchema, readJson(req))),
    }),
  },
  {
    method: "PATCH",
    path: "/residents/:id",
    access: ["ADMIN"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.users.updateResident(ctx.actor, id(ctx), parseWith(updateResidentSchema, readJson(ctx.req))) }),
  },
  {
    method: "DELETE",
    path: "/residents/:id",
    access: ["ADMIN"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.users.deactivateResident(ctx.actor, id(ctx)) }),
  },
  {
    method: "POST",
    path: "/residents/:id/approve-registration",
    access: ["ADMIN"],
    handler: async (ctx) => ({
      data: await ctx.runtime.services.users.approveRegistration(ctx.actor, id(ctx), parseWith(approveRegistrationSchema, readJson(ctx.req)).apartmentId),
    }),
  },
  {
    method: "POST",
    path: "/residents/:id/reject-registration",
    access: ["ADMIN"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.users.rejectRegistration(ctx.actor, id(ctx)) }),
  },

  // ───────────────────────────── Visitors ─────────────────────────────
  {
    method: "GET",
    path: "/visitors",
    access: "active",
    handler: async (ctx) => {
      if (ctx.actor.role === "RESIDENT") return { data: { items: await ctx.runtime.services.invitations.knownVisitors(ctx.actor), nextCursor: null } };
      return { data: await ctx.runtime.services.invitations.communityVisitors(ctx.actor, parseWith(pageQuerySchema, q(ctx))) };
    },
  },
  {
    method: "GET",
    path: "/visitors/:id",
    access: "active",
    handler: async (ctx) => ({ data: await ctx.runtime.services.invitations.visitorProfile(ctx.actor, id(ctx)) }),
  },

  // ───────────────────────────── Invitations ─────────────────────────────
  {
    method: "POST",
    path: "/invitations",
    access: ["RESIDENT"],
    rateLimit: 30,
    handler: async ({ runtime, actor, req }) => ({
      status: 201,
      data: await runtime.services.invitations.create(actor, parseWith(createInvitationSchema, readJson(req))),
    }),
  },
  {
    method: "GET",
    path: "/invitations",
    access: "active",
    handler: async (ctx) => ({ data: await ctx.runtime.services.invitations.list(ctx.actor, parseWith(invitationQuerySchema, q(ctx))) }),
  },
  {
    method: "GET",
    path: "/invitations/:id",
    access: "active",
    handler: async (ctx) => ({ data: await ctx.runtime.services.invitations.detail(ctx.actor, id(ctx)) }),
  },
  {
    method: "GET",
    path: "/invitations/:id/pass",
    access: ["RESIDENT"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.invitations.pass(ctx.actor, id(ctx)) }),
  },
  {
    method: "POST",
    path: "/invitations/:id/approve",
    access: ["RESIDENT"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.invitations.approve(ctx.actor, id(ctx)) }),
  },
  {
    method: "POST",
    path: "/invitations/:id/reject",
    access: ["RESIDENT"],
    handler: async (ctx) => ({
      data: await ctx.runtime.services.invitations.reject(ctx.actor, id(ctx), parseWith(decisionSchema, readJson(ctx.req)).reason),
    }),
  },
  {
    method: "POST",
    path: "/invitations/:id/cancel",
    access: ["RESIDENT", "ADMIN"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.invitations.cancel(ctx.actor, id(ctx)) }),
  },
  {
    method: "POST",
    path: "/invitations/:id/regenerate",
    access: ["RESIDENT"],
    rateLimit: 20,
    handler: async (ctx) => ({ data: await ctx.runtime.services.invitations.regeneratePass(ctx.actor, id(ctx)) }),
  },

  {
    method: "GET",
    path: "/resident/overview",
    access: ["RESIDENT"],
    handler: async ({ runtime, actor }) => ({ data: await runtime.services.analytics.residentOverview(actor) }),
  },

  // ───────────────────────────── Security ─────────────────────────────
  {
    method: "GET",
    path: "/security/overview",
    access: ["SECURITY", "ADMIN"],
    handler: async ({ runtime, actor }) => ({ data: await runtime.services.analytics.securityOverview(actor) }),
  },
  {
    method: "POST",
    path: "/security/verify-qr",
    access: ["SECURITY"],
    rateLimit: 90,
    handler: async ({ runtime, actor, req }) => ({ data: await runtime.services.gate.verify(actor, parseWith(verifyQrSchema, readJson(req)).payload) }),
  },
  {
    method: "GET",
    path: "/security/lookup",
    access: ["SECURITY", "ADMIN"],
    rateLimit: 90,
    handler: async (ctx) => ({ data: await ctx.runtime.services.gate.lookup(ctx.actor, parseWith(lookupSchema, q(ctx)).q) }),
  },
  {
    method: "POST",
    path: "/security/manual-entry",
    access: ["SECURITY"],
    rateLimit: 30,
    handler: async ({ runtime, actor, req }) => ({
      status: 201,
      data: await runtime.services.invitations.registerWalkIn(actor, parseWith(walkInSchema, readJson(req))),
    }),
  },
  {
    method: "POST",
    path: "/security/record-entry",
    access: ["SECURITY"],
    rateLimit: 90,
    handler: async ({ runtime, actor, req }) => ({ data: await runtime.services.gate.recordEntry(actor, parseWith(gateActionSchema, readJson(req))) }),
  },
  {
    method: "POST",
    path: "/security/record-exit",
    access: ["SECURITY"],
    rateLimit: 90,
    handler: async ({ runtime, actor, req }) => ({ data: await runtime.services.gate.recordExit(actor, parseWith(gateActionSchema, readJson(req))) }),
  },
  {
    method: "GET",
    path: "/security/currently-inside",
    access: ["SECURITY", "ADMIN"],
    handler: async ({ runtime, actor }) => ({ data: await runtime.services.gate.currentlyInside(actor) }),
  },
  {
    method: "GET",
    path: "/security/expected",
    access: ["SECURITY", "ADMIN"],
    handler: async ({ runtime, actor }) => ({ data: await runtime.services.gate.expectedToday(actor) }),
  },
  {
    method: "GET",
    path: "/security/activity",
    access: ["SECURITY", "ADMIN"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.gate.activity(ctx.actor, parseWith(activityQuerySchema, q(ctx))) }),
  },
  {
    method: "POST",
    path: "/uploads",
    access: ["SECURITY"],
    rateLimit: 20,
    handler: async ({ runtime, actor, req }) => {
      const input = parseWith(uploadRequestSchema, readJson(req));
      return { status: 201, data: await runtime.deps.files.createUploadTicket({ communityId: actor.communityId, ...input }) };
    },
  },
  {
    method: "GET",
    path: "/apartments",
    access: ["SECURITY", "ADMIN"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.property.listApartments(ctx.actor, ctx.req.query.get("buildingId") ?? undefined) }),
  },
  {
    method: "GET",
    path: "/announcements",
    access: "active",
    handler: async (ctx) => ({ data: await ctx.runtime.services.announcements.list(ctx.actor, parseWith(pageQuerySchema, q(ctx))) }),
  },

  // ───────────────────────────── Admin ─────────────────────────────
  {
    method: "GET",
    path: "/admin/analytics",
    access: ["ADMIN"],
    handler: async ({ runtime, actor }) => ({ data: await runtime.services.analytics.adminAnalytics(actor) }),
  },
  {
    method: "GET",
    path: "/admin/community",
    access: ["ADMIN"],
    handler: async ({ runtime, actor }) => ({ data: await runtime.services.property.community(actor) }),
  },
  {
    method: "PATCH",
    path: "/admin/community",
    access: ["ADMIN"],
    handler: async ({ runtime, actor, req }) => ({
      data: await runtime.services.property.updateCommunity(actor, parseWith(communitySettingsSchema, readJson(req))),
    }),
  },
  {
    method: "GET",
    path: "/admin/guards",
    access: ["ADMIN"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.users.list(ctx.actor, "SECURITY", parseWith(userQuerySchema, q(ctx))) }),
  },
  {
    method: "POST",
    path: "/admin/guards",
    access: ["ADMIN"],
    rateLimit: 30,
    handler: async ({ runtime, actor, req }) => ({
      status: 201,
      data: await runtime.services.users.createGuard(actor, parseWith(createGuardSchema, readJson(req))),
    }),
  },
  {
    method: "PATCH",
    path: "/admin/guards/:id",
    access: ["ADMIN"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.users.updateGuard(ctx.actor, id(ctx), parseWith(updateGuardSchema, readJson(ctx.req))) }),
  },
  {
    method: "GET",
    path: "/admin/buildings",
    access: ["ADMIN"],
    handler: async ({ runtime, actor }) => ({ data: await runtime.services.property.listBuildings(actor) }),
  },
  {
    method: "POST",
    path: "/admin/buildings",
    access: ["ADMIN"],
    handler: async ({ runtime, actor, req }) => ({
      status: 201,
      data: await runtime.services.property.saveBuilding(actor, parseWith(buildingSchema, readJson(req))),
    }),
  },
  {
    method: "PATCH",
    path: "/admin/buildings/:id",
    access: ["ADMIN"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.property.saveBuilding(ctx.actor, parseWith(buildingSchema, readJson(ctx.req)), id(ctx)) }),
  },
  {
    method: "DELETE",
    path: "/admin/buildings/:id",
    access: ["ADMIN"],
    handler: async (ctx) => {
      await ctx.runtime.services.property.deleteBuilding(ctx.actor, id(ctx));
      return { data: { deleted: true } };
    },
  },
  {
    method: "GET",
    path: "/admin/apartments",
    access: ["ADMIN"],
    handler: async (ctx) => ({ data: await ctx.runtime.services.property.listApartments(ctx.actor, ctx.req.query.get("buildingId") ?? undefined) }),
  },
  {
    method: "POST",
    path: "/admin/apartments",
    access: ["ADMIN"],
    handler: async ({ runtime, actor, req }) => ({
      status: 201,
      data: await runtime.services.property.createApartment(actor, parseWith(apartmentSchema, readJson(req))),
    }),
  },
  {
    method: "DELETE",
    path: "/admin/apartments/:id",
    access: ["ADMIN"],
    handler: async (ctx) => {
      await ctx.runtime.services.property.deleteApartment(ctx.actor, id(ctx));
      return { data: { deleted: true } };
    },
  },
  {
    method: "GET",
    path: "/admin/audit-logs",
    access: ["ADMIN"],
    handler: async (ctx) => {
      const query = parseWith(pageQuerySchema.extend({ q: z.string().trim().max(80).optional() }), q(ctx));
      return { data: await ctx.runtime.services.audit.list(ctx.actor.communityId, query) };
    },
  },
  {
    method: "GET",
    path: "/admin/audit-logs/verify",
    access: ["ADMIN"],
    rateLimit: 10,
    handler: async ({ runtime, actor }) => ({ data: await runtime.services.audit.verifyChain(actor.communityId) }),
  },
  {
    method: "GET",
    path: "/admin/reports",
    access: ["ADMIN"],
    rateLimit: 10,
    handler: async (ctx) => {
      const csv = await ctx.runtime.services.analytics.reportCsv(ctx.actor, parseWith(invitationQuerySchema, q(ctx)));
      await ctx.runtime.services.audit.record(ctx.actor, "REPORT_EXPORTED", "Report", "visitors", { filters: ctx.req.query.toString().slice(0, 200) });
      return { csv, filename: `gatekeeper-visitors-${localDate(new Date(), "UTC")}.csv` };
    },
  },
  {
    method: "POST",
    path: "/admin/announcements",
    access: ["ADMIN"],
    rateLimit: 10,
    handler: async ({ runtime, actor, req }) => ({
      status: 201,
      data: await runtime.services.announcements.publish(actor, parseWith(announcementSchema, readJson(req))),
    }),
  },
  {
    method: "DELETE",
    path: "/admin/announcements/:id",
    access: ["ADMIN"],
    handler: async (ctx) => {
      await ctx.runtime.services.announcements.remove(ctx.actor, id(ctx));
      return { data: { deleted: true } };
    },
  },

  // ───────────────────────────── Notifications ─────────────────────────────
  {
    method: "GET",
    path: "/notifications",
    access: "active",
    handler: async (ctx) => ({
      data: await ctx.runtime.services.notifications.list(ctx.actor.communityId, ctx.actor.userId, parseWith(notificationQuerySchema, q(ctx))),
    }),
  },
  {
    method: "PATCH",
    path: "/notifications/:id/read",
    access: "active",
    handler: async (ctx) => {
      await ctx.runtime.services.notifications.markRead(ctx.actor.communityId, ctx.actor.userId, id(ctx));
      return { data: { read: true } };
    },
  },
  {
    method: "POST",
    path: "/notifications/read-all",
    access: "active",
    handler: async ({ runtime, actor }) => ({ data: { updated: await runtime.services.notifications.markAllRead(actor.communityId, actor.userId) } }),
  },

  // ───────────────────────── LOCAL_DEMO only ─────────────────────────
  {
    method: "GET",
    path: "/demo/outbox",
    access: ["ADMIN"],
    demoOnly: true,
    handler: async ({ runtime }) => ({ data: await runtime.demo!.outbox.list() }),
  },
  {
    method: "POST",
    path: "/demo/run-jobs",
    access: ["ADMIN"],
    demoOnly: true,
    rateLimit: 10,
    handler: async ({ runtime, actor }) => {
      requireRole(actor, "ADMIN");
      if (!runtime.demo) throw forbidden();
      const reports = [];
      for (const job of JOB_NAMES) reports.push(await runtime.services.jobs.run(job, actor.communityId));
      return { data: reports };
    },
  },
];
