# GateKeeper — Production-Readiness & Security Audit

**Date:** 2026-11-12 · **Scope:** application (`src/`), infrastructure (`infrastructure/`), build and dependencies · **Method:** code review, synthesized-template inspection, executed tests and probes. **No AWS resources were deployed.**

Every "Verified" statement below refers to something that was actually executed in this audit; items reasoned about but not executed are marked **not executed**.

---

## 1. Summary

| Severity | Found | Fixed in this audit | Open |
| --- | --- | --- | --- |
| Critical | 1 | 1 | 0 |
| High | 6 | 6 | 0 (residual risks documented) |
| Medium | 13 | 4 | 9 |
| Low | 12 | 1 | 11 |

**Headline:** the most serious issue was a **deployment-time crash of both Cognito trigger Lambdas**, which would have broken every self-registration. It was found by executing the dependency's constructor, fixed, and verified by loading the synthesized Lambda bundle. The second most important finding: the audit trail was **tamper-evident only against naive edits** — a principal holding an app role could rewrite the chain consistently. Write-once anchoring in S3 Object Lock now closes that gap, apart from a documented window of up to 6 hours.

**Final executed results** (after fixes):

| Check | Result |
| --- | --- |
| ESLint | 0 problems |
| TypeScript — app and infrastructure | 0 errors |
| Vitest — 7 files (server unit, integration, security audit, frontend) | **88 / 88 passed** |
| Coverage (`src/server`, `src/shared`) | 74.1 % statements · 64.2 % branches · 78.8 % functions · 76.8 % lines |
| Playwright E2E on a production build | **18 / 18 passed** |
| CDK assertion tests | **12 / 12 passed** |
| `cdk synth` — `dev` and `prod` | both succeed (output directory outside OneDrive, see M-10) |
| `npm audit` — app, all dependencies | 0 vulnerabilities (after the minimatch override, L-1) |
| `npm audit` — infrastructure | 2 moderate (minimatch bundled inside `aws-cdk-lib`, build-time only; L-1) |
| `next build` with `GATEKEEPER_MODE` **unset** | succeeds; mode-dependent pages are dynamic (`ƒ`) |

---

## 2. Critical vulnerabilities

### C-1 · Cognito trigger Lambdas crash on every cold start — **FIXED**
- **Where:** `src/server/auth/tokens.ts` (`CognitoTokenVerifier`), `infrastructure/lib/gatekeeper-stack.ts` (trigger environment).
- **Issue:** to avoid a CloudFormation dependency cycle, the trigger functions receive a placeholder `COGNITO_USER_POOL_ID`. The runtime constructs a `CognitoJwtVerifier` eagerly, and `aws-jwt-verify` validates the pool ID format in its constructor.
- **Evidence (executed):** `CognitoJwtVerifier.create({ userPoolId: "not-used-by-triggers", … })` → `Error: Invalid Cognito User Pool ID`.
- **Impact:** the pre-sign-up trigger throws for every sign-up, so no resident could self-register. The post-confirmation trigger would also fail.
- **Fix:** the verifier is now created lazily on first `verify()` (triggers never call it).
- **Verification:** unit test (construction with the placeholder succeeds; malformed tokens still return 401). The **synthesized trigger bundle was loaded in Node with production configuration**: both handlers load, early-return paths work, and the sign-up path gets past runtime construction to its first real AWS call (rejected only because fake credentials were used).

---

## 3. High-priority issues

### H-1 · Audit trail could be rewritten consistently by an application role — **FIXED (residual risk documented)**
- **Issue:** IAM can't make `PutItem` conditional, so any Lambda role could overwrite audit items. Because the chain head lives in the writable main table, an attacker could edit entry *n* and re-hash every later entry and the head. **A plain hash chain cannot detect this** — demonstrated by an executed test in which a full rewrite still reported `verified: true`.
- **Fixes:**
  1. Explicit **IAM `Deny`** on `UpdateItem`, `DeleteItem`, `BatchWriteItem`, `DeleteTable`, `UpdateTable` against the audit table, for every function.
  2. New **S3 Object Lock bucket** (versioned, governance mode, 400-day retention, always retained). A new `audit-anchor` job writes the chain head there every 6 hours, using `If-None-Match: *`.
  3. App roles are explicitly denied `DeleteObject*`, `BypassGovernanceRetention`, `PutObjectRetention`, `PutObjectLegalHold` and `PutBucketObjectLockConfiguration` on that bucket.
  4. Verification now reads **every version** of every anchor and reports one of `HASH_MISMATCH`, `SEQUENCE_GAP`, `ANCHOR_MISMATCH`, `ANCHOR_CONFLICT`, `TRUNCATED` or `HEAD_MISMATCH`.
- **Verification (executed):**
  - Integration tests: a full rewrite is caught as `ANCHOR_MISMATCH`; truncation is caught even when the head is rolled back; a forged second anchor is caught as `ANCHOR_CONFLICT`; re-anchoring is idempotent.
  - Unit tests: the S3 store uses `If-None-Match`, treats 412 as success, and surfaces overwritten versions.
  - CDK tests: explicit denies exist for all 6 functions; Object Lock configuration is present.
- **Residual risk:**
  - Entries newer than the last anchor (≤ 6 h) can be rewritten before the next checkpoint.
  - Governance mode can be bypassed by an administrator holding `s3:BypassGovernanceRetention`. Use compliance mode in production if regulation requires it.

### H-2 · Demo UI decided at build time — production could ship demo banner, credentials panel and demo tools — **FIXED**
- **Evidence (executed):** the `next build` route table showed `/login` and `/admin/settings` as **static (○)**, so `process.env.GATEKEEPER_MODE` was evaluated during the build. A production build made without that variable (common in CI) would have baked in the demo UI.
- **Fix:** a new `isDemoDisplay()` helper awaits `connection()` (request-time rendering) and treats misconfiguration as "not demo". Used by the root layout, the login page and the settings page.
- **Verification (executed):** a build with `GATEKEEPER_MODE` unset succeeds and lists those routes as dynamic (`ƒ`). A new E2E test confirms the demo panel renders per request in demo mode.

### H-3 · Sign-in rate limiting could be bypassed with a spoofed `X-Forwarded-For` — **FIXED**
- **Issue:** the limiter keyed on the **left-most** XFF value, which the client controls, combined with the e-mail in a single key. Changing either value gave a fresh budget.
- **Fix:**
  - The client IP is now taken from the entry appended by the outermost trusted proxy (`TRUSTED_PROXY_COUNT`, default 1; 0 ignores XFF entirely).
  - Two independent budgets: per account (10/min for login) and per client IP (5× that).
- **Verification (executed):** unit tests show spoofed left-most entries are ignored and the header is not trusted without proxies.
- **Residual:** limits are per instance (M-8). In production, Cognito's own throttling also applies.

### H-4 · SMS could never be sent when enabled (ineffective IAM condition) — **FIXED**
- **Issue:** the SMS statement allowed `sns:Publish` on `*` conditioned on `sns:Protocol = sms`. That key applies to `Subscribe`, not `Publish`, so the condition never matches and the statement grants nothing.
- **Fix:** `Allow sns:Publish` with `NotResource: arn:aws:sns:*:*:*`. This allows direct-to-phone publishes while still forbidding publishing to any other topic.
- **Verification (executed):** CDK test with `smsEnabled: true`, and absence of the statement by default. **Live SMS delivery: not executed.**

### H-5 · Over-broad IAM permissions — **FIXED**
- **Evidence (executed):** dump of every IAM statement from the synthesized template.
- **Findings:**
  - The pre-sign-up trigger had full read/write on the main table plus audit-table write, but only needs to read one item.
  - All functions had `BatchWriteItem` and stream-read actions (from `grantReadWriteData`), which are unused.
  - The security function had `PutObjectRetention`, `PutObjectLegalHold`, tagging and abort rights on uploads (from `grantPut`).
  - Both triggers had audit-table access.
- **Fix:** explicit action lists:
  - main table: `GetItem`, `Query`, `PutItem`, `UpdateItem`, `DeleteItem`, `ConditionCheckItem`;
  - pre-sign-up trigger: `GetItem`, `Query` only;
  - uploads: `s3:PutObject` on `uploads/*` only;
  - the triggers lose audit access.
- **Verification (executed):** CDK tests assert each of these.

### H-6 · Lambda relied on the AWS SDK version bundled with the Node runtime — **FIXED**
- **Issue:** `@aws-sdk/*` was externalized, so `s3-request-presigner`, `lib-dynamodb` and the client versions would be whatever the managed runtime provides. That risks a missing module or behaviour drift at deploy time.
- **Fix:** the SDK is now bundled and version-pinned via `package-lock.json` (bundles are 1.7 MB).
- **Verification (executed):** all three GateKeeper bundles were synthesized and loaded standalone in Node; the trigger bundle reached its first AWS call. **Running the bundles in the actual Lambda environment: not executed.**

---

## 4. Medium-priority issues

| ID | Issue | Status |
| --- | --- | --- |
| M-1 | **Scheduled-job failures were swallowed.** `run()` caught per-community errors and returned success, so the Jobs error alarm could never fire and EventBridge never retried. Now healthy communities are processed and then a `JobFailedError` is thrown. *Executed test:* one failing tenant → error raised, the other tenant still anchored. | **Fixed** |
| M-2 | A pre-sign-up rejection (unknown community code) surfaced as 502 "sign-in service unavailable". Now mapped to 400 with a `joinCode` field error. *Executed unit test.* | **Fixed** |
| M-3 | The presigned upload signed an `x-amz-server-side-encryption` header the browser does not send, which risks `SignatureDoesNotMatch`. Removed; bucket default SSE-S3 still encrypts. **Real-S3 upload: not executed.** | **Fixed** |
| M-4 | **Dashboard polling cost.** The gate overview (every 10 s per screen) and daily summaries ran 3 separate COUNT queries over the same day of events. Replaced with a single-pass tally. The polling architecture itself still dominates read cost at scale (see §6). | **Partly fixed** |
| M-5 | CSP allows `'unsafe-inline'` scripts (Next.js hydration). Recommend a nonce-based CSP set in `proxy.ts`. | Open |
| M-6 | Audit entries are written after the business transaction commits; after 6 contention retries the entry is dropped and only logged (`audit.append_failed`). Recommend writing the audit entry in the same transaction for gate events, or using an outbox. | Open |
| M-7 | Chain verification is O(n) inside a 15 s Lambda, so large chains will time out. Recommend incremental verification from the last verified anchor. | Open |
| M-8 | In-process rate limits are per Lambda/Next instance, not fleet-wide. API Gateway stage throttling is the fleet control; consider a DynamoDB-backed limiter for auth. | Open |
| M-9 | **Node 20 is end-of-life** (April 2026); the build machine runs 20.20 and the AWS SDK warns about it. Lambdas already use Node 22. Run the web tier and CI on Node 22. | Open (documented) |
| M-10 | **Windows + OneDrive:** `cdk synth` failed with `EPERM … rename` inside `cdk.out` (OneDrive locks new folders). *Reproduced.* Workaround: `-o` to a non-synced directory (used for all synths in this audit), or move the repo. | Open (documented) |
| M-11 | Cognito's default e-mail sender allows only ~50 e-mails/day. Invitations, verification codes and password resets will stall in real use without SES. | Open (operator config) |
| M-12 | API Gateway stage throttle (50 rps, burst 100) may be too low at high usage given dashboard polling (see §6). | Open |
| M-13 | Manual gate-code entry admits a visitor by invitation ID without QR possession; the guard's ID check is the only control. Recommend matching the visitor's phone number or requiring resident confirmation for code-only entries. | Open (design) |

## 5. Low-priority improvements

| ID | Item | Status |
| --- | --- | --- |
| L-1 | Moderate ReDoS in `minimatch` (dev tooling). The app is fixed via an npm `overrides` entry pinning `minimatch@^11.0.8` under `@typescript-eslint/typescript-estree` (lint verified). Infrastructure: minimatch is **bundled inside** `aws-cdk-lib` 2.276.0 (the latest release, so it can't be overridden). Build-time only, and exploitation needs attacker-supplied glob patterns. | Fixed (app) / accepted (CDK) |
| L-2 | The demo outbox is a single global partition, so a demo admin sees other demo tenants' simulated messages. Demo only. | Open |
| L-3 | The visitor upsert overwrites `createdAt` on each visit (should be `if_not_exists`). | Open |
| L-4 | Transactions have no `ClientRequestToken`. An SDK retry after an ambiguous commit can report `DUPLICATE_ENTRY`/`STALE` for the request that actually succeeded. State stays correct. | Open |
| L-5 | User lookup by Cognito `sub` uses a GSI (eventually consistent), so a just-created account can see "not provisioned" for about a second. | Open |
| L-6 | The CDK auto-delete-objects custom-resource Lambda's log group has no retention (dev stage only). | Open |
| L-7 | The refresh-token cookie is scoped to `/`; it could be limited to `/api`. | Open |
| L-8 | `LOCAL_DEMO` falls back to published development secrets. Never expose a demo instance publicly without setting `DEMO_SESSION_SECRET`, `QR_TOKEN_PEPPER` and `APP_ENCRYPTION_KEY`. | Open (documented) |
| L-9 | Multi-use passes can be shared by the visitor (inherent). Regeneration revokes them. | Accepted |
| L-10 | Uploaded gate photos aren't checked for existence before being referenced, and aren't yet viewable. | Open |
| L-11 | `appOrigin` defaults to `http://localhost:3000` for a `dev` synth without context, which affects CORS. `prod` already requires HTTPS. | Open |
| L-12 | Unhandled-error logs include the raw error message. This is safe for current code paths (verified no PII/tokens in logs in an executed test), but future SDK errors could echo request data. | Open |

---

## 6. AWS cost risks

### Resources that can incur charges

| Resource (from the synthesized `prod` template) | Count | Charge driver |
| --- | --- | --- |
| DynamoDB tables (on-demand, 3 GSIs on main) | 2 | read/write request units; storage > 25 GB; **PITR (prod)** |
| Lambda functions (Node 22, arm64, 512 MB) | 6 (+1 CDK helper in dev) | requests, GB-seconds beyond the free tier |
| API Gateway HTTP API | 1 | per request |
| S3 buckets (uploads, audit anchors) | 2 | storage, requests; anchor versions retained 400 days |
| SNS topics | 2 | publishes, e-mail deliveries; **SMS per message** |
| Cognito user pool | 1 | MAU above the free tier |
| CloudWatch log groups / alarms | 7 / 4 | log ingestion and storage; alarms beyond 10 free |
| EventBridge scheduled rules | 6 | no charge |
| SSM SecureString parameters (standard), AWS-managed KMS keys | 2 / — | free tier; KMS API calls negligible |
| Web tier (Amplify Hosting SSR or other) | — | requests, compute, data transfer |

### Cost amplifiers specific to this design
- **Dashboard polling.** The gate overview refreshes every 10 s per open screen (~260k requests and reads per screen per month). This dominates cost at scale.
- **Transactional writes cost 2× write units**, and invitation items project to 3 GSIs, so each gate event costs roughly 25–35 write units including events, audit and notifications.
- **Full-chain audit verification** reads the whole chain (rate-limited to 10/min).
- **SMS** (off by default) can exceed everything else combined.

### Estimates (approximate us-east-1 on-demand prices as of late 2026; legacy free tier assumed; not a quote — verify with the AWS Pricing Calculator)

| | Low | Medium | High |
| --- | --- | --- | --- |
| Profile | 1 community, ~100 units, 30 visits/day, 2 guard screens × 12 h | ~1,000 units, 300 visits/day, 6 guard screens 24/7 | ~50 communities / 20,000 units, 6,000 visits/day, 100 guard screens 24/7 |
| API requests / month | ~0.35 M | ~2 M | ~33 M |
| API Gateway | ~$0.35 | ~$2 | ~$33 |
| Lambda | $0 (free tier) | ~$0.20 | ~$35 |
| DynamoDB reads (mostly polling) | ~$0.75 | ~$13 | ~$300–400 |
| DynamoDB writes + storage | ~$0.10 | ~$0.60 | ~$12 |
| CloudWatch logs / alarms | $0 | $0–1 | ~$10 |
| SNS e-mail (if residents opt in) | $0 | ~$0.50 | ~$7 |
| Cognito | $0 | $0 | $0–150 (only if MAU > 10,000; depends on plan) |
| S3, KMS, SSM, EventBridge | < $0.10 | < $0.50 | ~$2 |
| PITR (prod) | < $0.10 | < $0.50 | ~$3 |
| **AWS subtotal (excl. web hosting & SMS)** | **≈ $1–3 / month** | **≈ $15–25 / month** | **≈ $400–650 / month** |
| Web hosting (Amplify SSR, est.) | ~$1–5 | ~$5–15 | ~$50–150 |
| SMS (if enabled), e.g. 2 msgs/visit | country-dependent | ~$20–200 | ~$400–4,000 |

### Recommendations
- Before high usage, replace polling with pushed updates (WebSockets/AppSync), or maintain per-community counters updated in the gate transaction.
- Raise polling intervals for idle tabs.
- Set an AWS Budget alert before deploying, and an SNS SMS spend limit if SMS is enabled.

---

## 7. Deployment blockers

| Blocker | Status |
| --- | --- |
| Cognito triggers crash on cold start (C-1) | **Fixed and verified** |
| Lambda depends on runtime-provided SDK modules (H-6) | **Fixed** (bundled) |
| Production build shows demo UI if built without the mode variable (H-2) | **Fixed and verified** |
| SMS IAM policy grants nothing (H-4) | **Fixed** (only matters if SMS is enabled) |
| `cdk synth/deploy` fails from the OneDrive folder (`EPERM`) on this machine (M-10) | Open — use `-o <non-synced dir>` or move the repo |
| No AWS CLI or credentials on this machine; CDK bootstrap not done | Prerequisite (operator) |
| SSM secrets (`/gatekeeper/{stage}/qr-token-pepper`, `encryption-key`) must exist **before** the first API call or sign-up | Ordering documented in DEPLOYMENT.md |
| Cognito default e-mail sender ~50/day (M-11) | Operator: configure SES for real use |
| SNS SMS sandbox / country registration (India: DLT) | Operator, only if SMS enabled |
| Web tier must run Node 22 with `GATEKEEPER_MODE`, `COGNITO_CLIENT_ID`, `COGNITO_USER_POOL_ID`, `API_BASE_URL`, `AWS_REGION` (+ `TRUSTED_PROXY_COUNT`) | Documented |
| Bootstrap script now also needs `AUDIT_ANCHOR_BUCKET` | Documented |
| Retained resources: audit table and Object Lock anchor bucket survive `cdk destroy` (anchors undeletable for 400 days without bypass permission) | By design; documented |

---

## 8. Verified passing checks

All of the following were **executed** during this audit.

### 1 · Role workflows end to end
- Playwright against a production build, 18/18. Covered:
  - Admin creates an apartment and a resident, and the resident's forced password change.
  - Resident invites, then approves; guard verifies, records entry (duplicate refused); admin sees the visitor inside; guard records exit; resident history shows the visit.
  - Negative paths: invalid, expired, cancelled, rejected walk-in, unauthorized access, cross-tenant.
- Integration tests cover the same flows through the API router.

### 2 · Multi-tenant isolation
- **Sweep test:** another community's admin, guard and resident attempted 18 ID-addressed operations against Lakeview records — invitations (read, cancel, regenerate, pass), visitor profile, resident edit/delete, registration approve/reject, guard update, building edit/delete, apartment delete, announcement delete, entry/exit by ID, walk-in into a foreign apartment, notification read.
- Every attempt was refused with 400/403/404, and Lakeview data was **re-read and confirmed unchanged**.
- A forged cross-tenant pagination cursor was refused with `400 BAD_CURSOR`.
- List and aggregate endpoints return only the caller's community.
- **Code review:** every repository key is derived from `actor.communityId` (taken from the verified user record). The global lookup partitions (`SUB#`, `EMAIL#`, `QR#`, `COMMUNITIES`) each lead to a tenant check.

### 3 · JWT validation and role authorization
- The following were all rejected with 401:
  - an expired token;
  - a token signed with another key;
  - a token with the wrong issuer;
  - a token with the wrong audience;
  - a refresh token used as an access token;
  - an `alg=none` token;
  - a malformed token sent to the Cognito verifier.
- A resident's token claiming the `ADMIN` group → `403 ROLE_MISMATCH`, because the stored role must also match.
- A valid token for an unknown subject → 403.
- Per-route role checks are covered by integration tests.
- **Not executed:** live Cognito JWKS verification, and the API Gateway JWT authorizer accepting access tokens via `client_id`.

### 4 · QR tokens
- 256-bit random tokens; uniqueness over 500 samples; format and payload parsing.
- Peppered HMAC; AES-GCM tamper detection.
- **Raw token absent from every stored item and from all logs**; visitor phone and name absent from logs.
- Expiry, not-yet-valid, cancellation and already-used checks.
- Concurrent replay: 5 simultaneous entries produce exactly 1 success.
- Regeneration revokes the old QR.

### 5 · DynamoDB conditional writes and transactions
- MemoryTable: conditional writes, all-or-nothing transactions, failed-index reporting.
- DynamoTable (mocked SDK): `ConditionExpression` compilation, mapping of `ConditionalCheckFailed` and `TransactionCanceled` (with index), audit-table routing.
- Unique units and e-mails, version-guarded transitions, overlapping expiry runs.

### 6 · Audit log
- IAM: no Update/Delete/BatchWrite allowed, and explicit denies present for all 6 functions (CDK test).
- Hash chain detects an edited entry.
- Anchors detect a full rewrite, truncation and conflicting anchors.
- The S3 anchor store's conditional create and version-aware listing (mocked).

### 7 · IAM
- All statements dumped from the synthesized template and reviewed.
- Assertions:
  - Cognito admin actions only on the admin function;
  - S3 upload signing only on the security function, with exactly `s3:PutObject`;
  - pre-sign-up trigger read-only;
  - no `BatchWriteItem`, `GetRecords` or `Scan`;
  - SMS restricted by `NotResource`.

### 8 · S3 and uploads
- Both buckets: all public access blocked, TLS-only bucket policy, SSE-S3; the uploads bucket's CORS is limited to the app origin.
- Upload validation: content type limited to JPEG/PNG/WebP, size ≤ 2 MB, tenant-prefixed key validated server-side.
- Demo route: signature, expiry, magic bytes and path traversal checks.
- API responses strip storage-only fields (`qrTokenHash`, `qrTokenCipher`, `cognitoSub`, `version`, key attributes).

### 9 · API Gateway, CORS and headers
- CDK tests: JWT authorizer on all 28 routes; stage throttle of 50 rps / burst 100; CORS restricted to the app origin.
- E2E against the production build:
  - security headers on pages: CSP with `default-src 'self'` and `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS, and no `X-Powered-By`;
  - API responses are `no-store` with no stack trace;
  - a cross-site POST is rejected with `CSRF_REJECTED`;
  - session cookies are `httpOnly` and `SameSite=Lax`, and not readable from JavaScript.

### 10 · Lambda errors, timeouts and logs
- API functions have a 15 s timeout (under API Gateway's 29 s); jobs have 300 s.
- All function and API access log groups have 30-day retention.
- The router converts unknown errors into a generic 500 with a request ID.
- Job failures now surface as Lambda errors.

### 11 · EventBridge
- 6 schedules.
- Idempotency of expiry (including two concurrent runs), overdue flagging, summaries and anchoring is covered by tests.
- Notifications are deduplicated.
- Overdue visitors are never auto-exited.

### 13 · Synthesis
- `cdk synth` succeeds for `dev` and `prod`.
- The `prod` template has PITR, deletion protection and `Retain` on both tables.

### 14 · Build and dependencies
- `next build` succeeds, including with the mode variable unset.
- `npm audit`: 0 vulnerabilities in the app (all and production-only).
- Infrastructure: 2 moderate findings, explained in L-1.

---

## 9. Recommended fixes (prioritised)

1. **Before the first real deployment:**
   - deploy from a non-OneDrive path or use `-o` (M-10);
   - configure SES for Cognito (M-11);
   - create the SSM secrets immediately after `cdk deploy`;
   - set a budget alert;
   - run the web tier on Node 22 (M-9).
2. **Before onboarding many guards:** replace 10-second polling with pushed updates or counters, and revisit the API Gateway throttle (M-4, M-12).
3. **Audit completeness:** write gate-event audit entries in the same transaction (M-6); add incremental verification (M-7); consider compliance-mode Object Lock in production (H-1 residual).
4. **Hardening:** nonce-based CSP (M-5); a distributed rate limiter for auth (M-8); a phone match or resident confirmation for code-only gate entries (M-13).
5. **Hygiene:** L-3, L-4, L-6, L-7, L-11; track the `aws-cdk-lib` minimatch fix (L-1).
6. **First-deploy smoke tests** (not executable without an account):
   - Cognito sign-up with an unknown and a valid community code;
   - forced password change for an admin-created user;
   - an API Gateway call with a real access token;
   - a presigned photo upload from a browser;
   - SNS e-mail subscription confirmation;
   - an EventBridge job run and anchor object creation;
   - `/admin/audit-logs/verify` showing `anchorsChecked > 0`.

---

## 10. Files changed in this audit

- **App:**
  - `src/server/auth/tokens.ts` (lazy verifier)
  - `src/server/auth/gateway.ts` (trigger error mapping)
  - `src/server/display-mode.ts` (new), `src/app/layout.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/admin/settings/page.tsx` (request-time demo UI)
  - `src/server/bff.ts`, `src/app/api/auth/[action]/route.ts` (trusted client IP, split budgets)
  - `src/server/ports.ts`, `src/server/adapters/{aws,demo}.ts`, `src/server/services/audit-service.ts`, `src/server/runtime.ts`, `src/server/config.ts` (audit anchoring; `AUDIT_ANCHOR_BUCKET`)
  - `src/server/services/jobs-service.ts` (`audit-anchor` job, failure surfacing)
  - `src/server/repositories/activity-repo.ts`, `src/server/services/{analytics,gate}-service.ts` (single-pass tally)
  - `src/features/admin/community.tsx` (verification message)
  - `src/shared/types.ts`
- **Infrastructure:** `infrastructure/lib/gatekeeper-stack.ts` (anchor bucket, explicit IAM, denies, SMS policy, SDK bundling, 6th schedule, output), `infrastructure/test/stack.test.ts`.
- **Tests:** `tests/integration/security-audit.test.ts` (new), `tests/unit/audit-fixes.test.ts` (new), `tests/e2e/visitor-journey.spec.ts` (+4 tests).
- **Dependencies:** `package.json` (`overrides` for minimatch).
- **Docs:** README, SECURITY, DEPLOYMENT, `.env.example`, `scripts/bootstrap-community.ts` usage, TESTING, BUILD_PROGRESS.
