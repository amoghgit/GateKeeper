# Testing

| Layer | Tool | Location | Command |
| --- | --- | --- | --- |
| Unit (server, shared) | Vitest | `tests/unit` | `npm run test:unit` |
| Integration (real router + services + in-memory DynamoDB emulation) | Vitest | `tests/integration` | `npm run test:integration` |
| Frontend components | Vitest + React Testing Library (jsdom) | `tests/frontend` | `npm run test:frontend` |
| End-to-end | Playwright (Chromium) against a **production build** | `tests/e2e` | `npm run test:e2e` |
| Infrastructure | Vitest + CDK assertions | `infrastructure/test` | `cd infrastructure && npm test` |
| Static | ESLint, `tsc --noEmit` | — | `npm run lint && npm run typecheck` |

`npm test` runs all three Vitest projects. Coverage: `npm run test:coverage` (HTML report in `coverage/`).

## Recorded results

Latest run: 2026-11-12, during the production-readiness audit (see [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md)), Windows 11, Node 20.20.0. These are actual runs.

| Suite | Result |
| --- | --- |
| ESLint | 0 problems |
| TypeScript — app and infrastructure | 0 errors |
| Vitest — server unit + integration + security audit (6 files) | **76 / 76 passed** |
| Vitest — frontend (1 file) | **12 / 12 passed** |
| Coverage of `src/server` + `src/shared` | 74.1% statements · 64.2% branches · 78.8% functions · 76.8% lines |
| Playwright E2E (production build) | **18 / 18 passed** |
| CDK assertions | **12 / 12 passed**; `cdk synth` succeeds for `dev` and `prod` |
| `npm audit` (app) | 0 vulnerabilities |

**Not tested against live AWS:** Cognito, SNS, S3 and DynamoDB are exercised through mocks, the DynamoDB emulation, CDK template assertions and by loading the synthesized Lambda bundles locally — not against deployed services.

## What is covered

### Unit (`tests/unit`)
- QR token generation (uniqueness, format), payload parsing, peppered hashing
- AES-GCM encryption round-trip and tamper detection; demo password hashing
- ULID ordering and range bounds; unambiguous gate codes
- Pass policy: valid window, **expiry**, not-yet-valid, cancelled, rejected, pending, already-used single-use, multi-use re-entry, exit
- CSV formula-injection protection
- `MemoryTable`: conditional writes, all-or-nothing transactions, GSIs, ranges, pagination with filters, **rejection of cross-partition cursors**
- `DynamoTable` with mocked AWS SDK: condition compilation, error mapping (`ConditionalCheckFailed`, `TransactionCanceled`), audit-table routing, key conditions
- Configuration: production never falls back to demo; invalid modes rejected

### Integration (`tests/integration`) — through the real API router
- Resident creates an invitation (no PII in the QR), server-side validation (422)
- Full lifecycle: approval → verification → **entry** → admin sees visitor inside → **exit** → resident history and timeline
- Walk-in **rejection** blocks entry; multi-use passes re-enter
- **Invalid**, **expired** and **cancelled** passes refused; failed scans logged
- **Duplicate entry prevention**, sequential and with 5 concurrent requests (exactly one succeeds)
- Exit only for visitors inside; regenerate revokes the old QR
- Unauthenticated / tampered tokens → 401; **role authorization** on every role boundary
- **Tenant isolation**: foreign guard scan → `WRONG_COMMUNITY` with no details; foreign records → 404; lists are tenant-scoped
- **IDOR**: another apartment's resident gets 404 on read and pass
- Role/tenant escalation via profile update ignored
- Admin creates apartment (unique unit) and resident; forced password change; duplicate e-mail refused
- Deactivated residents lose access and cannot sign in
- Self-registration → e-mail verification → pending → admin approval
- CSV export; **audit chain verifies**, and a tampered entry is detected at the right sequence number
- Jobs: expiry is idempotent; overdue is flagged **without auto-exit**; summaries are deterministic
- Notifications: exactly one arrival/entry notification despite repeated scans; **SNS failure does not fail the gate operation**; e-mail per preferences; users cannot mark others' notifications

### Frontend (`tests/frontend`)
- Login form validation, demo account fill + redirect, forced password-change step
- Invite form validation and ISO-timestamp payload; QR shown on success
- QR scanner fallback: input normalisation (code / payload / link), "no camera" state, manual verification result
- Approval controls: approve, reject with reason; guards never see approval controls
- Filtering: period/category/status sent to the API
- Role-specific navigation; wrong-role redirect hides content; resident dashboard rendering

### End-to-end (`tests/e2e`)
Scenarios 1–8 from the specification in order (admin creates apartment and resident — including the new resident's first sign-in — resident invites, resident approves, guard verifies, guard records entry and a duplicate is refused, admin sees the visitor inside, guard records exit, resident sees the completed visit), plus negative scenarios: **invalid QR, expired QR, cancelled invitation, rejected walk-in, unauthorized access (UI redirect, API 403, anonymous 401/redirect), cross-tenant pass use**.

The E2E server runs `next build && next start` on port 3200 with `GATEKEEPER_MODE=LOCAL_DEMO`, its own data file (`.data/e2e-store.json`) and `DEMO_ALLOW_RESET=true`; each run begins with `POST /api/demo/reset`.

### Security audit (`tests/integration/security-audit.test.ts`, `tests/unit/audit-fixes.test.ts`)
Tenant-isolation sweep over 18 ID-addressed operations (data verified unchanged), forged cross-tenant cursors, JWT edge cases (expired, foreign key, wrong issuer/audience, refresh-as-access, alg=none, token-only role claims), raw QR token never stored or logged, audit anchoring (full-chain rewrite, truncation, conflicting anchors), job failure surfacing, overlapping job runs, trusted-proxy client IP, Cognito trigger cold start, S3 anchor store semantics. E2E adds security headers, CSRF rejection, httpOnly/SameSite cookies and request-time demo UI.

### Infrastructure (`infrastructure/test`)
No EC2/RDS/NAT/load balancer; on-demand encrypted tables with TTL and GSIs; private, TLS-only bucket with origin-restricted CORS; Cognito groups and secretless client; Cognito admin rights only on the admin function; S3 signing only on the security function; no update/delete on the audit table; every route JWT-authorized; stage throttling; 5 schedules; 30-day log retention; tagging.

## Adding tests

- Server behaviour: use `createHarness()` from `tests/helpers/harness.ts` — it gives a seeded runtime, a controllable clock (`h.clock.advance(minutes)`) and `h.call(email, method, path, body)` that goes through the real router with a real token.
- Components: `mockFetch()` and `renderWithClient()` from `tests/helpers/render.tsx`.
