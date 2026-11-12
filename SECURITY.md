# Security

GateKeeper handles residents' contact details and records of who visits whom. This document describes the controls, where they live in the code, and what remains the operator's responsibility.

## Threats considered

| Threat | Control |
| --- | --- |
| Forged or replayed QR passes | 256-bit random token; DB stores only `HMAC-SHA256(pepper, token)`; single-use enforced by state; expiry checked server-side; regenerate revokes the old token |
| Personal data leaking via QR or shared links | QR payload is `GK1.<token>` only; the visitor link puts it in the URL **fragment**, which browsers never send to servers |
| Database leak exposing usable passes | Hash + pepper (pepper in SSM, not in the DB); re-displayable copy encrypted with AES-256-GCM under a separate key |
| Double admission through concurrent scans | Version-conditioned transactional writes (`tests/integration` fires 5 parallel entries; exactly one succeeds) |
| Cross-tenant access | Tenant from verified identity only; tenant-prefixed keys; cursor partition check; foreign records answer 404; foreign QR → `WRONG_COMMUNITY` with no details |
| IDOR between apartments | `assertCanView` on every invitation read/transition; residents' list queries are apartment-keyed |
| Role escalation | Role must match **both** the Cognito group in the token and the stored record; profile updates ignore role/tenant fields; the API cannot create admins; first admin is bootstrapped by an operator script |
| Stolen browser token | Tokens never reach JS (httpOnly cookies); 1 h access tokens; logout performs Cognito global sign-out |
| CSRF | `SameSite=Lax` cookies + origin / `Sec-Fetch-Site` checks on every state-changing BFF request |
| XSS / clickjacking | React escaping; strict CSP (`default-src 'self'`, no third-party scripts, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, HSTS in production |
| Brute force / abuse | Separate per-account and per-client-IP budgets on auth actions (client IP derived from X-Forwarded-For using `TRUSTED_PROXY_COUNT`, so client-supplied values are ignored), per-user limits per route, API Gateway throttling, Cognito's own protections |
| Account enumeration | Uniform login errors, identical forgot-password responses, constant-time demo password checks; Cognito client uses `preventUserExistenceErrors` |
| Malicious uploads | Only JPEG/PNG/WebP ≤ 2 MB; presigned URL bound to exact type and size; key prefixed by tenant and validated before use; bucket blocks all public access; demo route also checks magic bytes |
| CSV / spreadsheet injection | Cells starting with `= + - @` are prefixed with `'` |
| Audit tampering | Separate table; app roles may only `PutItem/GetItem/Query` and are **explicitly denied** Update/Delete/BatchWrite; hash chain with a conditional head pointer; the chain head is **anchored every 6 h to an S3 Object Lock bucket** the app can neither delete from nor un-lock; verification compares the chain with every anchor version. See residual risks below. |
| Information disclosure in errors/logs | Unknown errors return a generic 500 with a request ID; logs contain IDs and error names, never names, phones, e-mails or tokens |
| Misconfiguration silently serving demo data | Mode must be explicit in production builds; `AWS_PRODUCTION` throws on missing settings or secrets |

## Authentication

- **Production:** Cognito user pool, e-mail verification, password policy (≥10 chars, upper, lower, digit), forced change of temporary passwords, refresh-token rotation via the BFF, token revocation enabled.
- Tokens are verified with `aws-jwt-verify` (signature via JWKS, issuer, client ID, `token_use=access`, expiry) **in Lambda**, in addition to the API Gateway JWT authorizer.
- **Demo:** HS256 tokens shaped like Cognito access tokens, signed with a development-only secret that `AWS_PRODUCTION` never uses. Demo accounts exist only in the local seed.

## Authorization model

| Role | Can |
| --- | --- |
| Resident | Manage invitations and passes for **their apartment**; approve/reject its walk-ins; read their notifications and announcements |
| Security | Verify passes, record entry/exit, register walk-ins, upload gate photos, read community activity and occupancy — **own community only** |
| Admin | Manage residents, guards, property, settings, announcements; read analytics, visitors, audit log; cancel invitations — **own community only**. Cannot record gate events. |
| Pending / deactivated | `GET /me` only |

## Infrastructure

- Least-privilege IAM per Lambda (only the admin function has Cognito admin rights; only the security function can sign uploads; only core can create SNS subscriptions; no function can update or delete audit entries).
- Encryption at rest: DynamoDB (AWS-managed keys), S3 (SSE-S3), SNS (AWS-managed KMS key), SSM SecureStrings.
- TLS enforced on the bucket; CORS limited to the configured app origin on S3 and API Gateway.
- CloudWatch logs retained 30 days; alarms on API 5xx and Lambda errors.

## Residual risks (accepted, documented)

- **Audit overwrite window.** IAM cannot force `attribute_not_exists` on `PutItem`, so a principal holding an app role could overwrite audit items. Overwrites of anything already anchored are detected; entries newer than the last anchor (≤ 6 h) could be rewritten before the next checkpoint. Governance-mode Object Lock can be bypassed by an administrator with `s3:BypassGovernanceRetention` — use **compliance mode** in production if regulations require it (compliance-mode objects cannot be deleted by anyone until retention expires).
- **In-process rate limits** are per instance; API Gateway throttling is the fleet-wide control.
- **Manual gate-code entry** admits a visitor without QR possession; the guard's identity check is the control.
- **CSP** allows inline scripts (Next.js hydration). A nonce-based CSP is a recommended hardening step.

## Operator responsibilities

- Generate secrets with `scripts/create-secrets.sh`; restrict who can read `/gatekeeper/{stage}/*`. Rotating the pepper invalidates outstanding passes (by design).
- Set a strong `DEMO_SESSION_SECRET` if you ever expose a demo instance, and never set `DEMO_ALLOW_RESET` outside tests.
- Host the web tier on HTTPS only. Review SNS SMS spend limits and country registration before enabling SMS.
- Configure an AWS Budget and subscribe the alarm topic.
- Decide a data-retention period for visit records under your local privacy law (e.g. India's DPDP Act 2023, GDPR) and inform visitors at the gate.

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainers rather than opening a public issue.
