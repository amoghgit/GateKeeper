/**
 * Single-table key layout. See DATABASE.md for the full access-pattern matrix.
 * Every tenant-owned key begins with `C#{communityId}` so that a query can
 * never span communities: the communityId always comes from the verified
 * principal, never from the request.
 */
const c = (communityId: string) => `C#${communityId}`;

export const keys = {
  communityRegistry: (communityId: string) => ({ PK: "COMMUNITIES", SK: c(communityId) }),
  communityJoinIndex: (joinCode: string) => `JOIN#${joinCode}`,

  building: (cid: string, buildingId: string) => ({ PK: c(cid), SK: `BLDG#${buildingId}` }),
  apartment: (cid: string, apartmentId: string) => ({ PK: c(cid), SK: `APT#${apartmentId}` }),
  apartmentsByBuilding: (cid: string, buildingId: string) => `${c(cid)}#BLDG#${buildingId}`,
  apartmentResident: (cid: string, apartmentId: string, userId: string) => ({
    PK: c(cid),
    SK: `APTRES#${apartmentId}#${userId}`,
  }),

  user: (cid: string, userId: string) => ({ PK: c(cid), SK: `USER#${userId}` }),
  userBySub: (sub: string) => `SUB#${sub}`,
  usersByRole: (cid: string, roleOrPending: string) => `${c(cid)}#ROLE#${roleOrPending}`,
  emailClaim: (email: string) => ({ PK: `EMAIL#${email.toLowerCase()}`, SK: "EMAIL" }),
  demoCredential: (email: string) => ({ PK: `DEMOAUTH#${email.toLowerCase()}`, SK: "CREDENTIAL" }),

  visitor: (cid: string, visitorId: string) => ({ PK: c(cid), SK: `VISITOR#${visitorId}` }),
  visitorsByApartment: (cid: string, apartmentId: string) => `${c(cid)}#APT#${apartmentId}#VISITORS`,

  invitation: (cid: string, invitationId: string) => ({ PK: c(cid), SK: `INV#${invitationId}` }),
  invitationsByApartment: (cid: string, apartmentId: string) => `${c(cid)}#APT#${apartmentId}#INV`,
  invitationsByStatus: (cid: string, status: string) => `${c(cid)}#STATUS#${status}`,
  invitationsByDate: (cid: string) => `${c(cid)}#INVDATE`,
  invitationCode: (cid: string, code: string) => ({ PK: c(cid), SK: `CODE#${code}` }),
  qrToken: (hash: string) => ({ PK: `QR#${hash}`, SK: "QR" }),

  events: (cid: string) => `${c(cid)}#EVENTS`,
  eventsByInvitation: (cid: string, invitationId: string) => `${c(cid)}#INV#${invitationId}#EVENTS`,

  notifications: (cid: string, userId: string) => `${c(cid)}#USER#${userId}`,
  notificationDedupe: (cid: string, userId: string, dedupeKey: string) => ({
    PK: `${c(cid)}#USER#${userId}`,
    SK: `DEDUPE#${dedupeKey}`,
  }),

  announcement: (cid: string, id: string) => ({ PK: c(cid), SK: `ANN#${id}` }),
  summary: (cid: string, day: string) => ({ PK: `${c(cid)}#SUMMARY`, SK: day }),
  summaries: (cid: string) => `${c(cid)}#SUMMARY`,

  auditHead: (cid: string) => ({ PK: c(cid), SK: "AUDITHEAD" }),
  auditEntry: (cid: string, seq: number) => ({ PK: c(cid), SK: String(seq).padStart(12, "0") }),
  auditPartition: (cid: string) => c(cid),
};

/** Attributes that exist only for storage and are stripped before data leaves the server. */
const INTERNAL = new Set([
  "PK",
  "SK",
  "GSI1PK",
  "GSI1SK",
  "GSI2PK",
  "GSI2SK",
  "GSI3PK",
  "GSI3SK",
  "entity",
  "ttl",
  "searchText",
  "version",
  "qrTokenHash",
  "qrTokenCipher",
  "cognitoSub",
  "passwordHash",
]);

export function strip<T>(item: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) if (!INTERNAL.has(k)) out[k] = v;
  return out as T;
}

export const ttlSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export const digits = (s: string) => s.replace(/\D/g, "");
