# API documentation

Base path: **`/api/v1`** on the web tier (browser) or **`{API_BASE_URL}/v1`** on API Gateway (server-to-server). Route definitions: `src/server/api/routes.ts`.

## Conventions

- **Authentication:** `Authorization: Bearer <Cognito access token>` (the web tier attaches it from an httpOnly cookie). Missing/invalid → `401`.
- **Tenant:** always derived from the token's user. Never send a community ID.
- **Success:** `{ "data": ... }`.
- **Error:** `{ "error": { "code", "message", "requestId", "details?" } }`. `details` maps field paths to messages on `422`. Stack traces are never returned.
- **Pagination:** `?limit=` (1–100, default 20) and `?cursor=` (opaque, from `nextCursor`). Responses: `{ items, nextCursor }`.
- **Dates:** `from`/`to` are local `YYYY-MM-DD` in the community's time zone and filter on expected arrival.
- **Rate limits:** 120 requests/min per user per route by default (lower on sensitive routes), plus API Gateway stage throttling. Exceeding returns `429 RATE_LIMITED`.

| Status | Meaning |
| --- | --- |
| 400 | Malformed request (`BAD_REQUEST`, `INVALID_JSON`, `BAD_CURSOR`) |
| 401 | Not signed in / token invalid or expired |
| 403 | Signed in but not allowed (`FORBIDDEN`, `ACCOUNT_PENDING`, `ACCOUNT_INACTIVE`, `ROLE_MISMATCH`) |
| 404 | Not found — also returned for other tenants' or apartments' records |
| 409 | State conflict (see gate codes below, `EMAIL_TAKEN`, `UNIT_EXISTS`, `STALE`, …) |
| 422 | Validation failed (`VALIDATION_FAILED` with `details`) |
| 429 | Rate limited |

## Profile

| Method & path | Roles | Description |
| --- | --- | --- |
| `GET /me` | any signed-in (incl. pending) | Profile, community name/time zone, unread count |
| `PATCH /me` | active users | `fullName`, `phone`, `emergencyContact`, `notificationPrefs`. Role, tenant, e-mail and apartment are not changeable here. |

## Residents (admin)

| Method & path | Body / query | Notes |
| --- | --- | --- |
| `GET /residents` | `status`, `q`, `pending=true`, `limit`, `cursor` | `pending=true` lists self-registrations |
| `POST /residents` | `{ fullName, email, phone, apartmentId }` | `201 { user, temporaryPassword }` — password is `null` in production (Cognito e-mails it) |
| `PATCH /residents/{id}` | `{ fullName?, phone?, apartmentId?, status? }` | Reassigning moves apartment access; status toggles the Cognito user |
| `DELETE /residents/{id}` | — | Soft delete (deactivates; history stays attributable) |
| `POST /residents/{id}/approve-registration` | `{ apartmentId }` | Adds the `RESIDENT` group and activates |
| `POST /residents/{id}/reject-registration` | — | Disables the identity |

## Visitors

| Method & path | Roles | Notes |
| --- | --- | --- |
| `GET /visitors` | resident → own apartment's known visitors; admin/security → community (paged) | |
| `GET /visitors/{id}` | as above | |

Walk-in visitors are created with `POST /security/manual-entry`.

## Invitations

| Method & path | Roles | Notes |
| --- | --- | --- |
| `POST /invitations` | resident | Body below. `201 { invitation, qrPayload }` — the only time the payload is returned besides `/pass` and `/regenerate` |
| `GET /invitations` | all | Residents: own apartment only. Query: `status`, `category`, `residentId`, `from`, `to`, `q`, `limit`, `cursor` |
| `GET /invitations/{id}` | all (scoped) | `{ invitation, timeline }` |
| `GET /invitations/{id}/pass` | owning resident | Re-display an active pass |
| `POST /invitations/{id}/approve` | owning resident | Only from `PENDING_APPROVAL` |
| `POST /invitations/{id}/reject` | owning resident | `{ reason? }` |
| `POST /invitations/{id}/cancel` | owning resident, admin | From `PENDING_APPROVAL` or `APPROVED` |
| `POST /invitations/{id}/regenerate` | owning resident | New token; the old QR stops working immediately |

```json
POST /invitations
{
  "visitor": { "fullName": "Rahul Verma", "phone": "+91 98765 43210", "category": "GUEST", "purpose": "Dinner", "vehicleNumber": "KA 01 AB 1234" },
  "expectedArrival": "2026-11-12T13:30:00.000Z",
  "expectedDeparture": "2026-11-12T17:30:00.000Z",
  "usagePolicy": "SINGLE_USE",
  "preApproved": true,
  "notes": "Please direct to visitor parking"
}
```

Categories: `GUEST`, `DELIVERY`, `CAB`, `DOMESTIC_HELP`, `MAINTENANCE`, `SERVICE_PROVIDER`, `OTHER`. Single visits may span 24 h; `MULTI_USE` passes up to 31 days. Arrival may be at most 1 h in the past and 90 days ahead.

## Security (gate)

| Method & path | Roles | Notes |
| --- | --- | --- |
| `GET /security/overview` | security, admin | Counts, expected list, recent activity |
| `POST /security/verify-qr` | security | `{ payload }` → `VerificationResult` (read-only; logs the scan) |
| `GET /security/lookup?q=` | security, admin | Gate code, invitation ID, phone or name |
| `POST /security/manual-entry` | security | Walk-in: `{ visitor, apartmentId, expectedDeparture?, notes?, photoKey? }` → `201` invitation |
| `POST /security/record-entry` | security | `{ payload }` **or** `{ invitationId }` — atomic |
| `POST /security/record-exit` | security | same body — only for visitors inside |
| `GET /security/currently-inside` | security, admin | |
| `GET /security/expected` | security, admin | Today's approved/pending visitors |
| `GET /security/activity` | security, admin | `type`, `q`, `from`, `to`, paging |
| `POST /uploads` | security | `{ contentType: image/jpeg\|png\|webp, size ≤ 2 MB }` → presigned upload ticket |
| `GET /apartments` | security, admin | For walk-in apartment selection |

```json
VerificationResult
{ "valid": false, "failure": "EXPIRED", "message": "This pass has expired.", "invitation": { ... }, "allowedAction": null }
```

Gate failure codes (also used as `409` error codes on entry): `INVALID_TOKEN`, `WRONG_COMMUNITY`, `EXPIRED`, `NOT_YET_VALID`, `CANCELLED`, `REJECTED`, `PENDING_APPROVAL`, `ALREADY_USED`, plus `DUPLICATE_ENTRY` and `NOT_INSIDE`. For `INVALID_TOKEN` and `WRONG_COMMUNITY` no invitation details are returned.

## Admin

| Method & path | Notes |
| --- | --- |
| `GET /admin/analytics` | Totals, 30-day daily series, weekly, monthly, categories |
| `GET /admin/community` · `PATCH /admin/community` | Details and gate policy (`entryGraceMinutes`, `overdueAfterMinutes`, `walkInsRequireApproval`, `remindersEnabled`) |
| `GET /admin/guards` · `POST /admin/guards` · `PATCH /admin/guards/{id}` | `{ fullName, email, phone, shift }`; patch `shift`/`status` |
| `GET/POST /admin/buildings` · `PATCH/DELETE /admin/buildings/{id}` | `{ name, floors, blocks[] }`; delete requires no apartments |
| `GET/POST /admin/apartments` · `DELETE /admin/apartments/{id}` | `{ buildingId, block?, floor, unitNumber }`; delete requires no residents |
| `GET /admin/audit-logs` | `q`, paging |
| `GET /admin/audit-logs/verify` | `{ verified, checked, brokenAtSeq }` |
| `GET /admin/reports` | Same filters as `GET /invitations`; returns `text/csv` (formula-injection safe). Export is itself audited. |
| `POST /admin/announcements` · `DELETE /admin/announcements/{id}` | `{ title, content, priority }`; publishing notifies residents and guards |

`GET /announcements` is available to every active user.

## Notifications

| Method & path | Notes |
| --- | --- |
| `GET /notifications` | `unreadOnly`, paging |
| `PATCH /notifications/{id}/read` | Only your own (others → 404) |
| `POST /notifications/read-all` | |

## Demo-only routes (LOCAL_DEMO)

`GET /demo/outbox`, `POST /demo/run-jobs` (admin), `POST /api/demo/reset` (only with `DEMO_ALLOW_RESET=true`), `PUT /api/demo-upload` (signed). All return 404 in `AWS_PRODUCTION`.

## Authentication endpoints (web tier only)

`POST /api/auth/{action}` with JSON body; responses `{ data: { status, ... } }`.

| Action | Body | Result |
| --- | --- | --- |
| `login` | `{ email, password }` | `SIGNED_IN` + `redirectTo`, or `NEW_PASSWORD_REQUIRED` + `session` |
| `new-password` | `{ email, session, newPassword }` | `SIGNED_IN` |
| `register` | `{ fullName, email, phone, joinCode, unitNumber, password, confirmPassword }` | `VERIFICATION_REQUIRED` |
| `verify-email` · `resend-code` | `{ email, code }` · `{ email }` | |
| `forgot-password` | `{ email }` | always `CODE_SENT_IF_ACCOUNT_EXISTS` (no account enumeration) |
| `reset-password` | `{ email, code, password, confirmPassword }` | |
| `logout` | — | Revokes Cognito refresh tokens (global sign-out) and clears cookies |
