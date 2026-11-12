/**
 * LOCAL_DEMO seed data. Never runs in AWS_PRODUCTION (it is only imported by
 * buildDemoRuntime). Accounts use the reserved .demo TLD.
 */
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type InvitationStatus,
  type Role,
  type Shift,
  type UsagePolicy,
  type VisitEventType,
  type VisitorCategory,
} from "@/shared/domain";
import type { Apartment, Building, Community, VisitEvent } from "@/shared/types";
import { addDays, localDate, startOfLocalDay } from "@/shared/time";
import type { DemoCredentialStore } from "../adapters/demo";
import { systemActor } from "../auth/actor";
import { digits } from "../db/keys";
import type { TxOp } from "../db/table";
import { encrypt, generateQrToken, hashPassword, hashQrToken, sha256 } from "../lib/crypto";
import { newId, shortCode } from "../lib/ids";
import type { Deps } from "../ports";
import { AnnouncementRepo, EventRepo, NotificationRepo, SummaryRepo, VisitorRepo } from "../repositories/activity-repo";
import { CommunityRepo, PropertyRepo } from "../repositories/community-repo";
import { InvitationRepo, type StoredInvitation } from "../repositories/invitation-repo";
import { type StoredUser, UserRepo } from "../repositories/user-repo";
import type { Services } from "../services";

export const DEMO_PASSWORD = "GateKeeper@2026";
export const DEMO_ACCOUNTS = {
  admin: "admin@gatekeeper.demo",
  security: "security@gatekeeper.demo",
  resident: "resident@gatekeeper.demo",
  otherTenantAdmin: "admin@harborpoint.demo",
  otherTenantSecurity: "security@harborpoint.demo",
  otherTenantResident: "resident@harborpoint.demo",
} as const;

/** Deterministic PRNG so the demo looks the same on every machine. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VISITOR_NAMES = [
  "Rahul Verma",
  "Sneha Iyer",
  "Imran Khan",
  "Deepa Nair",
  "Vikram Singh",
  "Pooja Hegde",
  "Arvind Rao",
  "Fatima Sheikh",
  "Manoj Pillai",
  "Kavya Reddy",
  "Sanjay Gupta",
  "Nisha Menon",
  "Rohan Das",
  "Anjali Joshi",
  "Farhan Ali",
  "Lakshmi Devi",
  "Ganesh Murthy",
  "Divya Krishnan",
  "Aditya Bose",
  "Ritu Saxena",
  "Harish Babu",
  "Meera Kapoor",
  "Tarun Malhotra",
  "Zoya Mirza",
];
const PURPOSES: Record<VisitorCategory, string[]> = {
  GUEST: ["Family visit", "Dinner with friends", "Weekend stay", "Birthday celebration"],
  DELIVERY: ["Amazon parcel", "Swiggy order", "Zepto groceries", "Flipkart delivery", "Courier – documents"],
  CAB: ["Uber pickup", "Ola airport drop", "Rapido pickup"],
  DOMESTIC_HELP: ["Housekeeping", "Cooking", "Child care"],
  MAINTENANCE: ["AC servicing", "Plumbing repair", "Electrical work", "Pest control"],
  SERVICE_PROVIDER: ["Internet installation", "Water purifier service", "Appliance repair"],
  OTHER: ["Society meeting", "Property viewing"],
};
const CATEGORY_WEIGHTS: [VisitorCategory, number][] = [
  ["DELIVERY", 0.35],
  ["GUEST", 0.25],
  ["CAB", 0.12],
  ["DOMESTIC_HELP", 0.1],
  ["MAINTENANCE", 0.08],
  ["SERVICE_PROVIDER", 0.07],
  ["OTHER", 0.03],
];

interface SeedUser {
  email: string;
  fullName: string;
  phone: string;
  role: Role | null;
  unit?: string;
  shift?: Shift;
  status?: "ACTIVE" | "PENDING";
  requestedUnit?: string;
}

interface CommunitySpec {
  communityId: string;
  name: string;
  address: string;
  joinCode: string;
  contactEmail: string;
  contactPhone: string;
  buildings: { name: string; floors: number; blocks: string[]; units: { unit: string; floor: number; block?: string }[] }[];
  users: SeedUser[];
}

const LAKEVIEW: CommunitySpec = {
  communityId: "cmty_lakeview",
  name: "Lakeview Residences",
  address: "14 Lakeshore Road, Whitefield, Bengaluru 560066",
  joinCode: "LAKE2026",
  contactEmail: "office@lakeview.demo",
  contactPhone: "+91 80 4123 9000",
  buildings: [
    {
      name: "Tower A",
      floors: 18,
      blocks: ["North Wing", "South Wing"],
      units: [
        { unit: "A-101", floor: 1, block: "North Wing" },
        { unit: "A-204", floor: 2, block: "North Wing" },
        { unit: "A-507", floor: 5, block: "South Wing" },
        { unit: "A-812", floor: 8, block: "South Wing" },
        { unit: "A-1204", floor: 12, block: "North Wing" },
        { unit: "A-1508", floor: 15, block: "South Wing" },
      ],
    },
    {
      name: "Tower B",
      floors: 14,
      blocks: ["East", "West"],
      units: [
        { unit: "B-302", floor: 3, block: "East" },
        { unit: "B-605", floor: 6, block: "West" },
        { unit: "B-901", floor: 9, block: "East" },
        { unit: "B-1103", floor: 11, block: "West" },
      ],
    },
    {
      name: "Garden Villas",
      floors: 2,
      blocks: [],
      units: [
        { unit: "V-01", floor: 0 },
        { unit: "V-02", floor: 0 },
        { unit: "V-03", floor: 0 },
      ],
    },
  ],
  users: [
    { email: DEMO_ACCOUNTS.admin, fullName: "Priya Raman", phone: "+91 98450 11001", role: "ADMIN" },
    { email: DEMO_ACCOUNTS.security, fullName: "Ravi Kumar", phone: "+91 98450 22002", role: "SECURITY", shift: "MORNING" },
    { email: "night.guard@lakeview.demo", fullName: "Suresh Naidu", phone: "+91 98450 22003", role: "SECURITY", shift: "NIGHT" },
    { email: DEMO_ACCOUNTS.resident, fullName: "Ananya Sharma", phone: "+91 99001 33001", role: "RESIDENT", unit: "A-1204" },
    { email: "arjun.mehta@lakeview.demo", fullName: "Arjun Mehta", phone: "+91 99001 33002", role: "RESIDENT", unit: "A-101" },
    { email: "neha.kulkarni@lakeview.demo", fullName: "Neha Kulkarni", phone: "+91 99001 33003", role: "RESIDENT", unit: "A-204" },
    { email: "david.thomas@lakeview.demo", fullName: "David Thomas", phone: "+91 99001 33004", role: "RESIDENT", unit: "A-507" },
    { email: "sana.qureshi@lakeview.demo", fullName: "Sana Qureshi", phone: "+91 99001 33005", role: "RESIDENT", unit: "A-812" },
    { email: "vivek.anand@lakeview.demo", fullName: "Vivek Anand", phone: "+91 99001 33006", role: "RESIDENT", unit: "A-1508" },
    { email: "isha.patel@lakeview.demo", fullName: "Isha Patel", phone: "+91 99001 33007", role: "RESIDENT", unit: "B-302" },
    { email: "rahul.bhat@lakeview.demo", fullName: "Rahul Bhat", phone: "+91 99001 33008", role: "RESIDENT", unit: "B-901" },
    { email: "maria.dsouza@lakeview.demo", fullName: "Maria D'Souza", phone: "+91 99001 33009", role: "RESIDENT", unit: "B-1103" },
    { email: "kiran.shetty@lakeview.demo", fullName: "Kiran Shetty", phone: "+91 99001 33010", role: "RESIDENT", unit: "V-01" },
    { email: "aisha.khan@lakeview.demo", fullName: "Aisha Khan", phone: "+91 99001 33011", role: "RESIDENT", unit: "V-02" },
    { email: "karthik.iyer@lakeview.demo", fullName: "Karthik Iyer", phone: "+91 99001 33012", role: null, status: "PENDING", requestedUnit: "B-605" },
  ],
};

const HARBOR: CommunitySpec = {
  communityId: "cmty_harbor",
  name: "Harbor Point Towers",
  address: "2 Marine Drive, Kochi 682031",
  joinCode: "HARBOR26",
  contactEmail: "office@harborpoint.demo",
  contactPhone: "+91 484 400 1200",
  buildings: [
    {
      name: "Harbor Tower",
      floors: 22,
      blocks: [],
      units: [
        { unit: "H-1001", floor: 10 },
        { unit: "H-1402", floor: 14 },
      ],
    },
  ],
  users: [
    { email: DEMO_ACCOUNTS.otherTenantAdmin, fullName: "Thomas George", phone: "+91 97440 10001", role: "ADMIN" },
    { email: DEMO_ACCOUNTS.otherTenantSecurity, fullName: "Biju Varghese", phone: "+91 97440 10002", role: "SECURITY", shift: "MORNING" },
    { email: DEMO_ACCOUNTS.otherTenantResident, fullName: "Anita Joseph", phone: "+91 97440 10003", role: "RESIDENT", unit: "H-1001" },
  ],
};

export async function seedDemoData(deps: Deps, services: Services, creds: DemoCredentialStore) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const spec of [LAKEVIEW, HARBOR]) {
    const ctx = await seedCommunity(deps, services, creds, spec, passwordHash);
    await seedHistory(deps, services, ctx, spec === LAKEVIEW ? 120 : 20, spec === LAKEVIEW ? 1 : 7);
    await seedToday(deps, ctx, spec === LAKEVIEW);
  }
  deps.logger.info("demo.seeded", { communities: 2 });
}

interface SeedContext {
  community: Community;
  apartments: Map<string, Apartment>;
  users: StoredUser[];
}

async function seedCommunity(deps: Deps, services: Services, creds: DemoCredentialStore, spec: CommunitySpec, passwordHash: string): Promise<SeedContext> {
  const now = deps.clock();
  const created = new Date(now.getTime() - 200 * 86_400_000).toISOString();
  const community: Community = {
    communityId: spec.communityId,
    name: spec.name,
    address: spec.address,
    contactEmail: spec.contactEmail,
    contactPhone: spec.contactPhone,
    timezone: "Asia/Kolkata",
    joinCode: spec.joinCode,
    settings: { entryGraceMinutes: 60, overdueAfterMinutes: 60, walkInsRequireApproval: true, remindersEnabled: true },
    createdAt: created,
  };
  await deps.table.transact([new CommunityRepo(deps.table).putOp(community)]);
  const property = new PropertyRepo(deps.table);
  const apartments = new Map<string, Apartment>();
  for (const b of spec.buildings) {
    const building: Building = {
      buildingId: newId("bld"),
      communityId: spec.communityId,
      name: b.name,
      floors: b.floors,
      blocks: b.blocks,
      createdAt: created,
    };
    await property.putBuilding(building, true);
    for (const u of b.units) {
      const apt: Apartment = {
        apartmentId: newId("apt"),
        communityId: spec.communityId,
        buildingId: building.buildingId,
        buildingName: building.name,
        block: u.block ?? null,
        floor: u.floor,
        unitNumber: u.unit,
        createdAt: created,
      };
      await property.createApartment(apt);
      apartments.set(u.unit, apt);
    }
  }
  const users: StoredUser[] = [];
  const userRepo = new UserRepo(deps.table);
  for (const s of spec.users) {
    const apt = s.unit ? apartments.get(s.unit)! : null;
    const sub = `demo-${sha256(s.email).slice(0, 24)}`;
    const user: StoredUser = {
      userId: newId("usr"),
      communityId: spec.communityId,
      cognitoSub: sub,
      fullName: s.fullName,
      email: s.email,
      phone: s.phone,
      role: s.role,
      status: s.status ?? "ACTIVE",
      apartmentId: apt?.apartmentId ?? null,
      apartmentLabel: apt ? `${apt.buildingName} · ${apt.unitNumber}` : null,
      shift: s.shift ?? null,
      emergencyContact: s.role === "RESIDENT" ? { name: "Family contact", phone: "+91 90000 00000" } : null,
      notificationPrefs: DEFAULT_NOTIFICATION_PREFERENCES,
      requestedUnit: s.requestedUnit ?? null,
      createdAt: s.status === "PENDING" ? new Date(now.getTime() - 2 * 86_400_000).toISOString() : created,
      updatedAt: created,
    };
    const ops: TxOp[] = [...userRepo.createOps(user)];
    if (apt) ops.push(property.linkResidentOp(spec.communityId, apt.apartmentId, user.userId));
    await deps.table.transact(ops);
    await creds.create({
      email: s.email,
      sub,
      passwordHash,
      groups: s.role ? [s.role] : [],
      confirmed: true,
      mustChangePassword: false,
      enabled: true,
      pendingCode: null,
      pendingCodePurpose: null,
      pendingCodeExpires: null,
      signupProfile: null,
    });
    users.push(user);
  }
  const sys = systemActor(spec.communityId);
  await services.audit.record(sys, "COMMUNITY_CREATED", "Community", spec.communityId, { name: spec.name });
  for (const u of users) {
    if (u.role)
      await services.audit.record(
        sys,
        u.role === "RESIDENT" ? "RESIDENT_CREATED" : u.role === "SECURITY" ? "GUARD_CREATED" : "ADMIN_CREATED",
        "User",
        u.userId,
        { role: u.role },
      );
  }
  return { community, apartments, users };
}

function pickCategory(r: () => number, weekend: boolean): VisitorCategory {
  let x = r();
  if (weekend && x < 0.15) return "GUEST";
  for (const [c, w] of CATEGORY_WEIGHTS) {
    if (x < w) return c;
    x -= w;
  }
  return "OTHER";
}

interface BuildInvitation {
  ctx: SeedContext;
  apartment: Apartment;
  resident: StoredUser;
  visitorName: string;
  category: VisitorCategory;
  purpose: string;
  arrival: Date;
  departure: Date;
  status: InvitationStatus;
  usagePolicy?: UsagePolicy;
  source?: "RESIDENT_INVITE" | "WALK_IN";
  createdAt: Date;
  entry?: { at: Date; guard: StoredUser };
  exit?: { at: Date; guard: StoredUser };
  overdue?: boolean;
  usageCount?: number;
}

function buildInvitation(deps: Deps, p: BuildInvitation, phoneSeed: number): { inv: StoredInvitation; visitorOps: TxOp } {
  const { token, payload } = generateQrToken();
  const phone = `+91 9${String(100000000 + Math.floor(phoneSeed * 899999999)).slice(0, 4)} ${String(10000 + Math.floor(phoneSeed * 89999)).slice(0, 5)}`;
  const createdBy = p.source === "WALK_IN" ? (p.entry?.guard ?? p.ctx.users.find((u) => u.role === "SECURITY")!) : p.resident;
  const inv: StoredInvitation = {
    invitationId: newId("inv", p.createdAt.getTime()),
    code: shortCode(),
    communityId: p.ctx.community.communityId,
    visitorId: `vis_${sha256(`${p.ctx.community.communityId}|${p.apartment.apartmentId}|${digits(phone)}`).slice(0, 24)}`,
    visitor: {
      fullName: p.visitorName,
      phone,
      category: p.category,
      purpose: p.purpose,
      vehicleNumber: p.category === "CAB" ? `KA 0${1 + Math.floor(phoneSeed * 8)} AB ${1000 + Math.floor(phoneSeed * 8999)}` : null,
    },
    residentId: p.resident.userId,
    residentName: p.resident.fullName,
    apartmentId: p.apartment.apartmentId,
    apartmentLabel: `${p.apartment.buildingName} · ${p.apartment.unitNumber}`,
    expectedArrival: p.arrival.toISOString(),
    expectedDeparture: p.departure.toISOString(),
    validFrom: new Date(p.arrival.getTime() - 60 * 60_000).toISOString(),
    expiry: p.departure.toISOString(),
    status: p.status,
    usagePolicy: p.usagePolicy ?? "SINGLE_USE",
    usageCount: p.usageCount ?? (p.entry ? 1 : 0),
    source: p.source ?? "RESIDENT_INVITE",
    notes: null,
    photoKey: null,
    createdBy: createdBy.userId,
    createdByName: createdBy.fullName,
    createdAt: p.createdAt.toISOString(),
    updatedAt: (p.exit?.at ?? p.entry?.at ?? p.createdAt).toISOString(),
    decidedAt: ["APPROVED", "CHECKED_IN", "COMPLETED", "REJECTED", "EXPIRED"].includes(p.status) ? p.createdAt.toISOString() : null,
    rejectionReason: p.status === "REJECTED" ? "Not expecting anyone" : null,
    lastEntryAt: p.entry?.at.toISOString() ?? null,
    lastEntryGuardName: p.entry?.guard.fullName ?? null,
    lastExitAt: p.exit?.at.toISOString() ?? null,
    lastExitGuardName: p.exit?.guard.fullName ?? null,
    overdue: p.overdue ?? false,
    qrTokenHash: hashQrToken(token, deps.secrets.qrPepper),
    qrTokenCipher: encrypt(payload, deps.secrets.encryptionKey),
    version: 1,
  };
  const visitorOps = new VisitorRepo(deps.table).upsertOp({
    visitorId: inv.visitorId,
    communityId: inv.communityId,
    apartmentId: inv.apartmentId,
    fullName: inv.visitor.fullName,
    phone,
    category: inv.visitor.category,
    purpose: inv.visitor.purpose,
    vehicleNumber: inv.visitor.vehicleNumber,
    createdBy: createdBy.userId,
    visitCount: 0,
    lastVisitAt: inv.expectedArrival,
    createdAt: inv.createdAt,
  });
  return { inv, visitorOps };
}

function event(inv: StoredInvitation, type: VisitEventType, at: Date, actor: { userId: string; fullName: string }, detail: string | null = null): VisitEvent {
  return {
    eventId: newId("evt", at.getTime()),
    communityId: inv.communityId,
    invitationId: inv.invitationId,
    visitorName: inv.visitor.fullName,
    apartmentId: inv.apartmentId,
    apartmentLabel: inv.apartmentLabel,
    eventType: type,
    actorId: actor.userId,
    actorName: actor.fullName,
    timestamp: at.toISOString(),
    detail,
  };
}

async function persist(deps: Deps, inv: StoredInvitation, visitorOps: TxOp, events: VisitEvent[]) {
  const invRepo = new InvitationRepo(deps.table);
  const evRepo = new EventRepo(deps.table);
  await deps.table.transact([...invRepo.createOps(inv), visitorOps, ...events.map((e) => evRepo.putOp(e))]);
}

async function seedHistory(deps: Deps, services: Services, ctx: SeedContext, days: number, seed: number) {
  const r = prng(seed * 7919);
  const tz = ctx.community.timezone;
  const today = localDate(deps.clock(), tz);
  const residents = ctx.users.filter((u) => u.role === "RESIDENT" && u.apartmentId);
  const guards = ctx.users.filter((u) => u.role === "SECURITY");
  const aptById = new Map([...ctx.apartments.values()].map((a) => [a.apartmentId, a]));
  const summaries = new SummaryRepo(deps.table);

  for (let offset = days; offset >= 1; offset--) {
    const day = addDays(today, -offset);
    const dayStart = startOfLocalDay(day, tz).getTime();
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const growth = 1 + (days - offset) / (days * 1.6);
    const count = Math.round((weekend ? 9 : 7) * growth + r() * 5);
    for (let i = 0; i < count; i++) {
      const resident = residents[Math.floor(r() * residents.length)]!;
      const apartment = aptById.get(resident.apartmentId!)!;
      const category = pickCategory(r, weekend);
      const purposes = PURPOSES[category];
      const arrival = new Date(dayStart + (8 + r() * 13) * 3_600_000);
      const stay = category === "DELIVERY" || category === "CAB" ? 10 + r() * 20 : category === "GUEST" ? 90 + r() * 240 : 45 + r() * 150;
      const departure = new Date(arrival.getTime() + Math.max(stay * 2, 120) * 60_000);
      const guard = guards[Math.floor(r() * guards.length)]!;
      const roll = r();
      const walkIn = category === "DELIVERY" && r() < 0.4;
      const createdAt = new Date(arrival.getTime() - (walkIn ? 2 * 60_000 : (2 + r() * 40) * 3_600_000));
      let status: InvitationStatus = "COMPLETED";
      if (roll < 0.04) status = "CANCELLED";
      else if (roll < 0.08 && walkIn) status = "REJECTED";
      else if (roll < 0.12) status = "EXPIRED";
      const entryAt = new Date(arrival.getTime() + (r() - 0.3) * 20 * 60_000);
      const exitAt = new Date(entryAt.getTime() + stay * 60_000);
      const { inv, visitorOps } = buildInvitation(
        deps,
        {
          ctx,
          apartment,
          resident,
          visitorName: VISITOR_NAMES[Math.floor(r() * VISITOR_NAMES.length)]!,
          category,
          purpose: purposes[Math.floor(r() * purposes.length)]!,
          arrival,
          departure,
          status,
          source: walkIn ? "WALK_IN" : "RESIDENT_INVITE",
          createdAt,
          entry: status === "COMPLETED" ? { at: entryAt, guard } : undefined,
          exit: status === "COMPLETED" ? { at: exitAt, guard } : undefined,
        },
        r(),
      );
      const events: VisitEvent[] = [];
      if (walkIn) events.push(event(inv, "WALK_IN_REGISTERED", createdAt, guard));
      if (walkIn && status !== "REJECTED") events.push(event(inv, "APPROVED", new Date(createdAt.getTime() + 60_000), resident));
      if (status === "REJECTED") events.push(event(inv, "REJECTED", new Date(createdAt.getTime() + 60_000), resident, "Not expecting anyone"));
      if (status === "CANCELLED") events.push(event(inv, "CANCELLED", new Date(createdAt.getTime() + 30 * 60_000), resident));
      if (status === "EXPIRED") events.push(event(inv, "EXPIRED", new Date(departure.getTime() + 10 * 60_000), systemActor(ctx.community.communityId)));
      if (status === "COMPLETED") {
        if (!walkIn) events.push(event(inv, "QR_SCAN_OK", new Date(entryAt.getTime() - 30_000), guard));
        events.push(event(inv, "ENTRY", entryAt, guard), event(inv, "EXIT", exitAt, guard));
      }
      await persist(deps, inv, visitorOps, events);
    }
    // A few failed verifications per week (expired or invalid passes).
    if (r() < 0.35) {
      const guard = guards[Math.floor(r() * guards.length)]!;
      const at = new Date(dayStart + (9 + r() * 10) * 3_600_000);
      await deps.table.transact([
        new EventRepo(deps.table).putOp({
          eventId: newId("evt", at.getTime()),
          communityId: ctx.community.communityId,
          invitationId: null,
          visitorName: null,
          apartmentId: null,
          apartmentLabel: null,
          eventType: "QR_SCAN_FAILED",
          actorId: guard.userId,
          actorName: guard.fullName,
          timestamp: at.toISOString(),
          detail: r() < 0.5 ? "INVALID_TOKEN" : "EXPIRED",
        }),
      ]);
    }
    await summaries.put(ctx.community.communityId, await services.analytics.computeDailySummary(ctx.community.communityId, day, tz));
  }
}

async function seedToday(deps: Deps, ctx: SeedContext, primary: boolean) {
  const now = deps.clock();
  const t = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  const r = prng(primary ? 42 : 99);
  const resident = ctx.users.find((u) => u.role === "RESIDENT")!;
  const residentApt = [...ctx.apartments.values()].find((a) => a.apartmentId === resident.apartmentId)!;
  const guard = ctx.users.find((u) => u.role === "SECURITY")!;
  const others = ctx.users.filter((u) => u.role === "RESIDENT" && u.userId !== resident.userId);
  const aptOf = (u: StoredUser) => [...ctx.apartments.values()].find((a) => a.apartmentId === u.apartmentId)!;

  type Plan = Omit<BuildInvitation, "ctx" | "createdAt"> & { createdAt?: Date; events: (inv: StoredInvitation) => VisitEvent[] };
  const plans: Plan[] = [
    {
      apartment: residentApt,
      resident,
      visitorName: "Rahul Verma",
      category: "GUEST",
      purpose: "Dinner with friends",
      arrival: t(120),
      departure: t(360),
      status: "APPROVED",
      events: () => [],
    },
    {
      apartment: residentApt,
      resident,
      visitorName: "Meera Kapoor",
      category: "GUEST",
      purpose: "Weekend stay",
      arrival: t(26 * 60),
      departure: t(30 * 60),
      status: "APPROVED",
      events: () => [],
    },
    {
      apartment: residentApt,
      resident,
      visitorName: "Lakshmi Devi",
      category: "DOMESTIC_HELP",
      purpose: "Housekeeping",
      arrival: t(-150),
      departure: t(29 * 24 * 60),
      status: "CHECKED_IN",
      usagePolicy: "MULTI_USE",
      usageCount: 1,
      entry: { at: t(-140), guard },
      createdAt: t(-6 * 24 * 60),
      events: (inv) => [event(inv, "QR_SCAN_OK", t(-141), guard), event(inv, "ENTRY", t(-140), guard)],
    },
    {
      apartment: residentApt,
      resident,
      visitorName: "Imran Khan",
      category: "DELIVERY",
      purpose: "Swiggy order",
      arrival: t(-4),
      departure: t(30),
      status: "PENDING_APPROVAL",
      source: "WALK_IN",
      createdAt: t(-4),
      events: (inv) => [event(inv, "WALK_IN_REGISTERED", t(-4), guard)],
    },
  ];
  if (others.length >= 4) {
    const [o1, o2, o3, o4] = others as [StoredUser, StoredUser, StoredUser, StoredUser];
    plans.push(
      {
        apartment: aptOf(o1),
        resident: o1,
        visitorName: "Vikram Singh",
        category: "MAINTENANCE",
        purpose: "AC servicing",
        arrival: t(-75),
        departure: t(45),
        status: "CHECKED_IN",
        entry: { at: t(-70), guard },
        events: (inv) => [event(inv, "QR_SCAN_OK", t(-71), guard), event(inv, "ENTRY", t(-70), guard)],
      },
      {
        apartment: aptOf(o2),
        resident: o2,
        visitorName: "Sneha Iyer",
        category: "GUEST",
        purpose: "Family visit",
        arrival: t(-300),
        departure: t(-150),
        status: "CHECKED_IN",
        entry: { at: t(-295), guard },
        overdue: true,
        events: (inv) => [event(inv, "QR_SCAN_OK", t(-296), guard), event(inv, "ENTRY", t(-295), guard)],
      },
      {
        apartment: aptOf(o3),
        resident: o3,
        visitorName: "Arvind Rao",
        category: "SERVICE_PROVIDER",
        purpose: "Internet installation",
        arrival: t(-40),
        departure: t(80),
        status: "CHECKED_IN",
        entry: { at: t(-35), guard },
        events: (inv) => [event(inv, "QR_SCAN_OK", t(-36), guard), event(inv, "ENTRY", t(-35), guard)],
      },
      {
        apartment: aptOf(o4),
        resident: o4,
        visitorName: "Kavya Reddy",
        category: "GUEST",
        purpose: "Birthday celebration",
        arrival: t(180),
        departure: t(420),
        status: "APPROVED",
        events: () => [],
      },
      {
        apartment: aptOf(o1),
        resident: o1,
        visitorName: "Farhan Ali",
        category: "DELIVERY",
        purpose: "Amazon parcel",
        arrival: t(-200),
        departure: t(-170),
        status: "COMPLETED",
        entry: { at: t(-198), guard },
        exit: { at: t(-188), guard },
        events: (inv) => [event(inv, "ENTRY", t(-198), guard), event(inv, "EXIT", t(-188), guard)],
      },
      {
        apartment: aptOf(o3),
        resident: o3,
        visitorName: "Rohan Das",
        category: "CAB",
        purpose: "Uber pickup",
        arrival: t(60),
        departure: t(120),
        status: "APPROVED",
        events: () => [],
      },
    );
  }
  for (const p of plans) {
    const { inv, visitorOps } = buildInvitation(deps, { ...p, ctx, createdAt: p.createdAt ?? t(-24 * 60) }, r());
    await persist(deps, inv, visitorOps, p.events(inv));
  }

  if (!primary) return;
  const admin = ctx.users.find((u) => u.role === "ADMIN")!;
  const ann = new AnnouncementRepo(deps.table);
  const announcements = [
    {
      title: "Scheduled water supply maintenance",
      content:
        "Water supply to Tower A will be paused on Saturday between 10:00 and 14:00 while the overhead tanks are cleaned. Please store water in advance.",
      priority: "IMPORTANT" as const,
      ago: 26,
    },
    {
      title: "Visitor parking update",
      content:
        "Visitor vehicles must now be registered with the vehicle number on the invitation. Security will direct registered vehicles to the basement visitor bays.",
      priority: "NORMAL" as const,
      ago: 72,
    },
    {
      title: "Community Diwali celebration",
      content:
        "Join us at the central lawn on the evening of the festival for lights, music and food stalls. Guests are welcome — please invite them through GateKeeper.",
      priority: "NORMAL" as const,
      ago: 170,
    },
  ];
  for (const a of announcements) {
    const at = t(-a.ago * 60);
    await ann.put({
      announcementId: newId("ann", at.getTime()),
      communityId: ctx.community.communityId,
      title: a.title,
      content: a.content,
      priority: a.priority,
      createdBy: admin.userId,
      createdByName: admin.fullName,
      createdAt: at.toISOString(),
    });
  }
  const notifications = new NotificationRepo(deps.table);
  const seeded = [
    {
      type: "VISITOR_REQUEST" as const,
      title: "Visitor waiting at the gate",
      message: "Imran Khan (Swiggy order) is at the gate and needs your approval.",
      ago: 4,
      read: false,
    },
    {
      type: "VISITOR_ENTRY" as const,
      title: "Visitor entered",
      message: `Lakshmi Devi entered the premises (checked in by ${guard.fullName}).`,
      ago: 140,
      read: false,
    },
    { type: "ANNOUNCEMENT" as const, title: "Important: Scheduled water supply maintenance", message: announcements[0]!.content, ago: 26 * 60, read: true },
    { type: "VISITOR_EXIT" as const, title: "Visitor left", message: "Deepa Nair left the premises.", ago: 30 * 60, read: true },
  ];
  for (const n of seeded) {
    const at = t(-n.ago);
    await deps.table.transact(
      notifications.createOps(
        {
          notificationId: newId("ntf", at.getTime()),
          communityId: ctx.community.communityId,
          userId: resident.userId,
          type: n.type,
          title: n.title,
          message: n.message,
          link: n.type === "VISITOR_REQUEST" ? "/resident/invitations" : null,
          read: n.read,
          createdAt: at.toISOString(),
        },
        null,
        now,
      ),
    );
  }
}
