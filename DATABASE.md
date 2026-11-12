# Database design

GateKeeper uses **two DynamoDB tables**, both on-demand and encrypted at rest:

- **Main table** — single-table design for every tenant entity, with three overloaded GSIs and TTL on `ttl`.
- **Audit table** — append-only, hash-chained audit entries. Application roles are granted only `PutItem`, `GetItem` and `Query` on it.

The same key schema runs in `LOCAL_DEMO` through `MemoryTable`, which emulates key conditions, GSIs, filters, conditional writes and transactions.

## Tenant isolation

Every tenant-owned key starts with `C#{communityId}`. The community ID is taken from the **verified identity's user record**, never from a request, so a query physically cannot address another tenant's partition. Pagination cursors are rejected if they reference a different partition key (`decodeCursor`), so a forged cursor can't be used to read across tenants. Object-level checks (`assertCanView`) return 404 for records belonging to another community or, for residents, another apartment.

The only global partitions are look-up items that must be resolved before the tenant is known — `SUB#` (identity → user), `EMAIL#` (uniqueness), `QR#` (token hash → invitation), `COMMUNITIES` (registry for jobs). Every one of them leads to a tenant check: e.g. a QR hash from another community returns `WRONG_COMMUNITY` without revealing any details.

## Key schema (main table)

| Entity | PK | SK | GSI1 (PK / SK) | GSI2 (PK / SK) | GSI3 (PK / SK) |
| --- | --- | --- | --- | --- | --- |
| Community | `COMMUNITIES` | `C#{cid}` | `JOIN#{joinCode}` / `C#{cid}` | | |
| Building | `C#{cid}` | `BLDG#{bid}` | | | |
| Apartment | `C#{cid}` | `APT#{aid}` | `C#{cid}#BLDG#{bid}` / `APT#{unit}` | | |
| Unit-number claim | `C#{cid}` | `UNIT#{bid}#{unit}` | | | |
| Apartment ↔ resident link | `C#{cid}` | `APTRES#{aid}#{uid}` | | | |
| User | `C#{cid}` | `USER#{uid}` | `SUB#{cognitoSub}` / `USER` | `C#{cid}#ROLE#{role\|PENDING}` / `{name}#{uid}` | |
| E-mail claim | `EMAIL#{email}` | `EMAIL` | | | |
| Visitor (known visitor per apartment) | `C#{cid}` | `VISITOR#{vid}` | `C#{cid}#APT#{aid}#VISITORS` / `{name}` | | |
| Invitation | `C#{cid}` | `INV#{iid}` | `C#{cid}#APT#{aid}#INV` / `{arrival}#{iid}` | `C#{cid}#STATUS#{status}` / `{arrival}#{iid}` | `C#{cid}#INVDATE` / `{arrival}#{iid}` |
| Gate-code claim | `C#{cid}` | `CODE#{code}` | | | |
| QR token lookup | `QR#{hmac}` | `QR` *(TTL: expiry + 30 d)* | | | |
| Visit event | `C#{cid}#EVENTS` | `{ulid}` | `C#{cid}#INV#{iid}#EVENTS` / `{ulid}` | | |
| Notification | `C#{cid}#USER#{uid}` | `NOTIF#{ulid}` *(TTL 180 d)* | | | |
| Notification dedupe marker | `C#{cid}#USER#{uid}` | `DEDUPE#{key}` *(TTL 7 d)* | | | |
| Announcement | `C#{cid}` | `ANN#{ulid}` | | | |
| Daily summary | `C#{cid}#SUMMARY` | `{YYYY-MM-DD}` | | | |
| Audit chain head | `C#{cid}` | `AUDITHEAD` | | | |

**Audit table:** `PK = C#{cid}`, `SK = {seq, zero-padded to 12}`.

IDs are prefixed ULIDs (`inv_01J…`, `evt_01J…`) — lexicographic order equals creation order, so sort keys double as time indexes and time ranges become key conditions (`ulidBound`). ISO-8601 UTC timestamps are used for `expectedArrival` so they sort correctly as strings.

## Access patterns

| # | Pattern | Operation |
| --- | --- | --- |
| 1 | Resolve the caller from a token | GSI1 `SUB#{sub}` |
| 2 | Resident's visitor history / upcoming / pending | GSI1 `C#…#APT#{aid}#INV`, `between` on arrival, optional status filter |
| 3 | Currently inside, pending approvals, expiry candidates | GSI2 `C#…#STATUS#{status}` (+ range on arrival) |
| 4 | Expected today | GSI2 `APPROVED` and `PENDING_APPROVAL` with arrival ≤ end of day, filter `expiry ≥ start of day` |
| 5 | Admin visitor list / CSV export by date | GSI3 `C#…#INVDATE`, `between` on arrival, optional filters |
| 6 | Verify a scanned QR | `GetItem QR#{hmac}` → `GetItem` invitation |
| 7 | Manual lookup by gate code | `GetItem CODE#{code}` → invitation |
| 8 | Manual lookup by phone/name | GSI3 over a bounded window (−31 to +7 days) with `contains(searchText)` |
| 9 | Activity log / today's entries | `Query C#…#EVENTS` with ULID-bounded `between` |
| 10 | Invitation timeline | GSI1 `C#…#INV#{iid}#EVENTS` |
| 11 | Residents of an apartment (for notifications) | `Query C#… begins_with APTRES#{aid}#` |
| 12 | Users by role / pending registrations | GSI2 `C#…#ROLE#…` |
| 13 | Notifications / unread count | `Query C#…#USER#{uid}` `begins_with NOTIF#` |
| 14 | Analytics series | `Query C#…#SUMMARY between` dates |
| 15 | Audit log (paged) and chain verification | audit table `Query C#…` descending / ascending |
| 16 | Communities for scheduled jobs | `Query COMMUNITIES` |

No normal request performs a `Scan`.

## Conditional writes and transactions

| Guarantee | Mechanism |
| --- | --- |
| E-mail unique across the platform | `EMAIL#` claim with `attribute_not_exists`, same transaction as the user |
| Unit number unique per building | `UNIT#` claim in the apartment transaction |
| Gate code unique per community | `CODE#` claim; on collision the service retries with a new code |
| QR token unique | `QR#` claim with `attribute_not_exists` |
| No double entry/exit, no lost updates | invitation `Put` conditioned on `version = expected`, in a transaction with the visit event |
| Pass regeneration revokes the old QR atomically | one transaction: replace invitation, put new `QR#`, delete old `QR#` |
| Audit chain cannot fork | head update conditioned on `seq = previous`, entry put with `attribute_not_exists` |
| Notification sent once | `DEDUPE#{key}` put with `attribute_not_exists` in the notification transaction |

## TTL strategy

| Item | Expires |
| --- | --- |
| QR lookup | invitation expiry + 30 days (verification still reports "expired" until then, then "invalid") |
| Notifications | 180 days |
| Dedupe markers | 7 days |
| Demo outbox (demo only) | 7 days |

Invitations, visit events, summaries and audit entries are **not** TTL'd — they are the community's record. Add a retention job if your data-protection policy requires deletion after a fixed period.

## Entities

Field-level definitions live in `src/shared/types.ts` (`Community`, `Building`, `Apartment`, `UserProfile`, `Invitation` (which embeds the visitor's details), `VisitEvent`, `AppNotification`, `Announcement`, `AuditLogEntry`, `DailySummary`). Storage-only fields — key attributes, `searchText`, `version`, `qrTokenHash`, `qrTokenCipher`, `cognitoSub`, `passwordHash` — are stripped by `strip()` before any record leaves the server.
