/**
 * Centralised validation. The same schemas validate browser forms and server
 * requests, so a rule can never drift between the two.
 */
import { z } from "zod";
import { INVITATION_STATUSES, NOTIFICATION_TYPES, SHIFTS, USAGE_POLICIES, VISITOR_CATEGORIES, VISIT_EVENT_TYPES } from "./domain";

const trimmed = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be at most ${max} characters`);

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{6,18}[0-9]$/, "Enter a valid phone number, e.g. +91 98765 43210");

export const emailSchema = z.email("Enter a valid e-mail address").trim().toLowerCase().max(254);

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128)
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number");

const vehicleSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9 -]{4,15}$/, "Use 4–15 letters, digits, spaces or dashes")
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .optional()
    .or(z.literal("").transform(() => undefined));

const isoDateTime = z.iso.datetime({ offset: true, message: "Invalid timestamp" });

// ───────────────────────────── Auth ─────────────────────────────

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const newPasswordChallengeSchema = z.object({
  email: emailSchema,
  session: z.string().min(1).max(4096),
  newPassword: passwordSchema,
});

export const registerSchema = z
  .object({
    fullName: trimmed(2, 80, "Full name"),
    email: emailSchema,
    phone: phoneSchema,
    joinCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{6,10}$/, "Enter the community code provided by your association"),
    unitNumber: trimmed(1, 20, "Unit number"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, "Enter the 6-digit code"),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    code: z
      .string()
      .trim()
      .regex(/^[0-9]{6}$/, "Enter the 6-digit code"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

// ─────────────────────────── Profiles ───────────────────────────

export const emergencyContactSchema = z.object({
  name: trimmed(2, 80, "Contact name"),
  phone: phoneSchema,
});

export const updateProfileSchema = z.object({
  fullName: trimmed(2, 80, "Full name").optional(),
  phone: phoneSchema.optional(),
  emergencyContact: emergencyContactSchema.nullable().optional(),
  notificationPrefs: z
    .object({
      email: z.boolean(),
      sms: z.boolean(),
      types: z.array(z.enum(NOTIFICATION_TYPES)).max(NOTIFICATION_TYPES.length),
    })
    .optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const createResidentSchema = z.object({
  fullName: trimmed(2, 80, "Full name"),
  email: emailSchema,
  phone: phoneSchema,
  apartmentId: z.string().min(1, "Choose an apartment").max(64),
});
export type CreateResidentInput = z.infer<typeof createResidentSchema>;

export const updateResidentSchema = z.object({
  fullName: trimmed(2, 80, "Full name").optional(),
  phone: phoneSchema.optional(),
  apartmentId: z.string().min(1).max(64).optional(),
  status: z.enum(["ACTIVE", "DEACTIVATED"]).optional(),
});
export type UpdateResidentInput = z.infer<typeof updateResidentSchema>;

export const createGuardSchema = z.object({
  fullName: trimmed(2, 80, "Full name"),
  email: emailSchema,
  phone: phoneSchema,
  shift: z.enum(SHIFTS),
});
export type CreateGuardInput = z.infer<typeof createGuardSchema>;

export const updateGuardSchema = z.object({
  fullName: trimmed(2, 80, "Full name").optional(),
  phone: phoneSchema.optional(),
  shift: z.enum(SHIFTS).optional(),
  status: z.enum(["ACTIVE", "DEACTIVATED"]).optional(),
});
export type UpdateGuardInput = z.infer<typeof updateGuardSchema>;

export const approveRegistrationSchema = z.object({
  apartmentId: z.string().min(1, "Choose an apartment").max(64),
});

// ────────────────────────── Property ───────────────────────────

export const buildingSchema = z.object({
  name: trimmed(1, 60, "Building name"),
  floors: z.coerce.number().int().min(1).max(200),
  blocks: z.array(trimmed(1, 30, "Block name")).max(20),
});
export type BuildingInput = z.infer<typeof buildingSchema>;

export const apartmentSchema = z.object({
  buildingId: z.string().min(1, "Choose a building").max(64),
  block: optionalText(30),
  floor: z.coerce.number().int().min(0).max(200),
  unitNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,12}$/, "Use letters, digits and dashes, e.g. A-1204"),
});
export type ApartmentInput = z.infer<typeof apartmentSchema>;

export const communitySettingsSchema = z.object({
  name: trimmed(2, 100, "Community name").optional(),
  address: trimmed(5, 200, "Address").optional(),
  contactEmail: emailSchema.optional(),
  contactPhone: phoneSchema.optional(),
  settings: z
    .object({
      entryGraceMinutes: z.coerce.number().int().min(0).max(240),
      overdueAfterMinutes: z.coerce.number().int().min(15).max(1440),
      walkInsRequireApproval: z.boolean(),
      remindersEnabled: z.boolean(),
    })
    .optional(),
});
export type CommunitySettingsInput = z.infer<typeof communitySettingsSchema>;

// ────────────────────────── Visitors ───────────────────────────

export const visitorDetailsSchema = z.object({
  fullName: trimmed(2, 80, "Visitor name"),
  phone: phoneSchema,
  category: z.enum(VISITOR_CATEGORIES),
  purpose: trimmed(2, 200, "Purpose"),
  vehicleNumber: vehicleSchema,
});

/** Server contract for POST /invitations. */
export const createInvitationSchema = z
  .object({
    visitor: visitorDetailsSchema,
    expectedArrival: isoDateTime,
    expectedDeparture: isoDateTime,
    usagePolicy: z.enum(USAGE_POLICIES).default("SINGLE_USE"),
    preApproved: z.boolean().default(true),
    notes: optionalText(500),
  })
  .superRefine((v, ctx) => {
    const arrival = Date.parse(v.expectedArrival);
    const departure = Date.parse(v.expectedDeparture);
    if (departure <= arrival) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedDeparture"],
        message: "Departure must be after arrival",
      });
    }
    const maxSpanHours = v.usagePolicy === "MULTI_USE" ? 24 * 31 : 24;
    if (departure - arrival > maxSpanHours * 3_600_000) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedDeparture"],
        message: v.usagePolicy === "MULTI_USE" ? "Recurring passes can be valid for at most 31 days" : "A single visit can last at most 24 hours",
      });
    }
  });
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/** Browser form for inviting a visitor; converted to the server contract on submit. */
export const inviteFormSchema = z
  .object({
    fullName: trimmed(2, 80, "Visitor name"),
    phone: phoneSchema,
    category: z.enum(VISITOR_CATEGORIES),
    purpose: trimmed(2, 200, "Purpose"),
    arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    arrivalTime: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time"),
    departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    departureTime: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time"),
    vehicleNumber: z.string().trim().max(15),
    notes: z.string().trim().max(500, "Keep notes under 500 characters"),
    usagePolicy: z.enum(USAGE_POLICIES),
    preApproved: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const arrival = new Date(`${v.arrivalDate}T${v.arrivalTime}`).getTime();
    const departure = new Date(`${v.departureDate}T${v.departureTime}`).getTime();
    if (Number.isNaN(arrival) || Number.isNaN(departure)) return;
    if (departure <= arrival) {
      ctx.addIssue({
        code: "custom",
        path: ["departureTime"],
        message: "Departure must be after arrival",
      });
    }
    if (arrival < Date.now() - 60 * 60 * 1000) {
      ctx.addIssue({ code: "custom", path: ["arrivalTime"], message: "Arrival is in the past" });
    }
    if (v.vehicleNumber && !/^[A-Za-z0-9 -]{4,15}$/.test(v.vehicleNumber)) {
      ctx.addIssue({
        code: "custom",
        path: ["vehicleNumber"],
        message: "Use 4–15 letters, digits, spaces or dashes",
      });
    }
  });
export type InviteFormValues = z.infer<typeof inviteFormSchema>;

export const decisionSchema = z.object({
  reason: optionalText(200),
});

export const walkInSchema = z.object({
  visitor: visitorDetailsSchema,
  apartmentId: z.string().min(1, "Choose the apartment being visited").max(64),
  expectedDeparture: isoDateTime.optional(),
  notes: optionalText(500),
  photoKey: z
    .string()
    .regex(/^uploads\/[A-Za-z0-9/_-]+\.(jpg|png|webp)$/)
    .optional(),
});
export type WalkInInput = z.infer<typeof walkInSchema>;

export const walkInFormSchema = z.object({
  fullName: trimmed(2, 80, "Visitor name"),
  phone: phoneSchema,
  category: z.enum(VISITOR_CATEGORIES),
  purpose: trimmed(2, 200, "Purpose"),
  vehicleNumber: z.string().trim().max(15),
  apartmentId: z.string().min(1, "Choose the apartment being visited"),
  notes: z.string().trim().max(500),
});
export type WalkInFormValues = z.infer<typeof walkInFormSchema>;

// ─────────────────────────── Gate ops ──────────────────────────

export const verifyQrSchema = z.object({
  payload: z.string().trim().min(1, "Scan or paste a pass").max(512),
});

/** Gate actions identify the invitation either by scanned payload or by id. */
export const gateActionSchema = z
  .object({
    payload: z.string().trim().max(512).optional(),
    invitationId: z.string().trim().max(64).optional(),
  })
  .refine((v) => Boolean(v.payload) !== Boolean(v.invitationId), {
    message: "Provide either a scanned pass or an invitation id",
  });

export const lookupSchema = z.object({
  q: z.string().trim().min(2, "Enter at least 2 characters").max(80),
});

export const uploadRequestSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.coerce
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024, "Images must be 2 MB or smaller"),
});

// ───────────────────────── Announcements ───────────────────────

export const announcementSchema = z.object({
  title: trimmed(3, 120, "Title"),
  content: trimmed(10, 2000, "Message"),
  priority: z.enum(["NORMAL", "IMPORTANT"]).default("NORMAL"),
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;

// ─────────────────────────── Queries ───────────────────────────

const limit = z.coerce.number().int().min(1).max(100).default(20);
const cursor = z.string().max(2048).optional();
const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

export const invitationQuerySchema = z.object({
  status: z.enum(INVITATION_STATUSES).optional(),
  category: z.enum(VISITOR_CATEGORIES).optional(),
  residentId: z.string().max(64).optional(),
  from: dateParam,
  to: dateParam,
  q: z.string().trim().max(80).optional(),
  limit,
  cursor,
});
export type InvitationQuery = z.infer<typeof invitationQuerySchema>;

export const activityQuerySchema = z.object({
  type: z.enum(VISIT_EVENT_TYPES).optional(),
  q: z.string().trim().max(80).optional(),
  from: dateParam,
  to: dateParam,
  limit,
  cursor,
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export const pageQuerySchema = z.object({ limit, cursor });
export const userQuerySchema = z.object({
  status: z.enum(["ACTIVE", "PENDING", "DEACTIVATED"]).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor,
});
export const notificationQuerySchema = z.object({
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  limit,
  cursor,
});
