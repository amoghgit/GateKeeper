# GateKeeper — Build Progress

| Phase | Status | Notes |
| ----- | ------ | ----- |
| 1. Project initialization | done | Next.js 16.4 (App Router, Turbopack), React 19.3, Tailwind 4, TS strict + `noUncheckedIndexedAccess`, ESLint, Prettier, dedicated git repo |
| 2. Design system | done | Tokens in `globals.css`; shadcn-style primitives on Radix; validated chart palette; landing page |
| 3. Database & backend | done | Storage port with MemoryTable + DynamoTable, repositories, services, shared router |
| 4. Authentication | done | Demo + Cognito gateways, httpOnly-cookie BFF, refresh, `proxy.ts` guard, role layouts |
| 5. Resident application | done | Dashboard, invitations (tabs), invite form + QR pass, history, notifications, profile |
| 6. Security application | done | Dashboard, camera scanner + manual fallback, walk-ins with photo upload, currently inside, activity log |
| 7. Admin application | done | Overview, analytics, residents (+registrations), guards, buildings, apartments, visitors + CSV, announcements, audit log, settings + demo tools |
| 8. AWS integration | done (not deployed) | Cognito/SNS/S3/SSM adapters, Lambda handlers, CDK stack (synth OK), bootstrap + secrets scripts |
| 9. Testing | done | 53 server + 12 frontend Vitest, 14 Playwright, 8 CDK — all passing (see TESTING.md) |
| 10. Final polish | done | All 27 pages screenshotted with zero console errors at desktop and phone widths; lint/type clean |
| 11. Documentation & delivery | done | README, ARCHITECTURE, DATABASE, API_DOCUMENTATION, SECURITY, DEPLOYMENT, TESTING, .env.example |

## Decisions

- **One router, two hosts.** `src/server/api/router.ts` is called in-process by `/api/v1/*` in LOCAL_DEMO and by `src/lambda/api.ts` in AWS_PRODUCTION — authorization and validation exist once.
- **BFF pattern.** Tokens live in httpOnly cookies; the browser never sees them.
- **Single-table DynamoDB + separate append-only audit table** (hash-chained).
- **Optimistic concurrency** (`version` condition) on every invitation transition → simultaneous scans cannot double-enter.
- **Resident invitations are pre-approved by default**; residents can turn that off to require explicit approval, and walk-ins always go through approval (configurable per community).
- **Overdue visitors are flagged, never auto-exited.**
- `cacheComponents` disabled: every page is per-user and dynamic. Next 16 renamed middleware to `src/proxy.ts`.

## Log

- Workspace inspected: empty directory, Node 20.20.0, npm 10.8.2, no AWS CLI → no deployment possible from this machine.
- The enclosing git repo was rooted at the user's home directory, so a dedicated repo was initialised in the project folder (nothing committed).
- Dev server verified end-to-end (login → cookie session → API, CSRF rejection, redirects).
- Found and fixed during review: stale CSS from a missed file-watch event; chart tokens; monthly chart leading empty months; demo buttons lacking accessible names; one intermittent E2E failure in demo reset (reset now builds from an empty table).
- Final run: lint 0 problems, typecheck 0 errors, Vitest 65/65, Playwright 14/14, CDK 8/8.

## Production-readiness audit (2026-11-12)

See PRODUCTION_READINESS_AUDIT.md. Fixed: 1 critical (Cognito triggers crashed on cold start), 6 high (audit-chain rewrite → Object Lock anchoring + IAM denies; demo UI baked at build; XFF rate-limit bypass; ineffective SMS IAM; over-broad IAM; runtime-provided SDK), 4 medium. Final: lint 0, typecheck 0, Vitest 88/88, Playwright 18/18, CDK 12/12, synth dev+prod OK, npm audit 0 (app).
