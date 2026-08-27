# 7 — Identity, tenant, and privilege model

**Phase 2 security package**, item 7 of 10. The role map is in
[`../architecture/current-vs-target.md`](../architecture/current-vs-target.md) §4; this
document is the *enforcement* view — how each boundary is actually held, and where it is
not held yet.

---

## 1. Authentication

| Property | Implementation | Notes |
|---|---|---|
| Credential | Password, hashed | Per-account lockout after repeated failures |
| Session | **Stateless HMAC-SHA256 cookie** (ADR 0006) | No server-side session store, which is why the single instance scales at all |
| Cookie flags | `httpOnly`, `SameSite=Lax`, `Secure` in production | |
| Expiry | Idle max-age **plus a 30-day absolute cap** carried in the signed payload | The absolute cap matters: idle-only expiry means a stolen token can be refreshed indefinitely |
| Revocation | `users.token_epoch` — incrementing it invalidates every existing token for that account | The one piece of server-side state a stateless scheme needs, and it is the right one |
| MFA | ❌ **None, for any role** | The notable gap for clinician and admin accounts (§164.312(d)) |

**The tradeoff to state honestly:** stateless sessions cannot be revoked individually — only
per account, via `token_epoch`. "Sign out my other devices" is all-or-nothing. That is
acceptable now and should be reconsidered before a clinical surface where a clinician may
have many devices.

---

## 2. Authorization, as it exists today

Three checks, in this order:

1. **Authenticated?** Signed cookie, unexpired, epoch matches.
2. **Role?** `requireMember()` / `requireClinician()` / admin checks read `users.role`.
3. **Clinically permitted?** `checkModuleAccess` — 14 ordered gates. This is the check that
   does the real work, and it is about *safety*, not permissions.

### What is missing at layer 2

| Gap | Consequence |
|---|---|
| **No caseload scoping** | A clinician account reads every member in the instance |
| **No tenant scoping on the request path** | Every request implicitly acts on the platform tenant |
| **No MFA** | A clinician password is the only barrier to every member's record |
| **Role is a single column** | A person cannot hold different roles in different organizations |

The first is the one that matters for a pilot, and it is a permission model gap rather than
an infrastructure one — it does not wait on Postgres.

---

## 3. Tenant isolation — the four layers, and which are live

| Layer | Mechanism | Built | **Live** |
|---|---|---|---|
| L1 Application | `Repository` cannot be constructed without a `TenantContext`; ANDs `tenant_id` onto every statement; `insert` stamps tenant from context and ignores caller-supplied values; `update` strips `tenant_id` so a record cannot change tenants via a field write; tables absent from `TENANT_SCOPED_TABLES` are refused rather than silently unscoped | ✅ | ❌ **Product call sites use `data()` directly** |
| L2 Transaction | `withTenantTransaction` binds one tenant per transaction; a nested call naming a different tenant throws; on Postgres sets `app.tenant_id` via `set_config(..., true)` | ✅ *(2026-08-27)* | ◐ Available, not yet on product paths |
| L3 Database | Postgres RLS enabled **and forced** on every table carrying `tenant_id`; policies generated from the system catalog so a new table cannot be added unprotected; application role is non-owner, non-superuser | ✅ | ❌ **Dormant — the app runs on SQLite** |
| L4 Privilege | Cross-tenant access is a database **role** (`steady_platform_admin`), not a session flag, so an application-layer compromise cannot grant itself the policy; the event log and audit log are granted only `SELECT, INSERT` | ✅ | ❌ Dormant with L3 |

**Verified by:** `tests/tenant-isolation.test.ts` (18 application attack cases),
`tests/tenant-transaction.test.ts` (12 transaction cases), `scripts/verify-rls.sh` (12
database attack cases against a real Postgres cluster, CI-blocking).

> **The sentence a reviewer needs.** All four layers are built and adversarially tested.
> **None of them is enforcing anything in the running application.** L1 and L2 are bypassed
> because product code has not been migrated; L3 and L4 require the Postgres cutover. The
> repository contains tenant-safe building blocks; the running SQLite application does not
> enforce end-to-end tenant isolation.

### Why the failure direction is right

A statement issued with no tenant context matches **no rows**, not all rows. The repository
throws without a context; the RLS policy compares against an unset variable and matches
nothing. Forgetting the tenant is therefore an outage, never a breach — which is the correct
direction for a control to fail in and is asserted directly in the tests rather than assumed.

---

## 4. Privilege escalation paths, and what blocks each

| Path | Blocked by | Residual |
|---|---|---|
| Member → another member's data | Row scoping by `user_id`; L1–L4 once live | **Medium** until call sites migrate |
| Member → clinician | `users.role` checked server-side on every clinician route | Low |
| Clinician → another tenant | L1–L4 once live | **N/A today** — one tenant exists |
| Clinician → all members **in the tenant** | ❌ **Nothing** | **High** — by design today, unacceptable at pilot |
| Application → cross-tenant | `crossTenantContext()`: named, greppable, audited with a reason; on Postgres additionally gated by a role the application role cannot assume | Low once on Postgres |
| Application → mutate history | Event log and audit log are `SELECT, INSERT` only for the application role | Low once on Postgres |
| Compromised process → everything | ❌ **Nothing** — one process holds the data key, the session secret, and the provider credential | **High**; mitigated only by moving keys out of the process environment |
| Operator → everything | ❌ Nothing technical | **High** — administrative control only |

The last two are the honest limits of a single-process architecture. Neither is fixed by
more application code; both need custody and account controls.

---

## 5. Audit coverage

Hash-chained, append-only, verifiable (ADR 0005), across eight families: `clinical`,
`billing`, `identity`, `specialist_action`, `safety`, `module_runtime`, `consent`,
`security`.

**Covered:** logins and failures, consent grants and withdrawals, clinical actions, module
runtime events, clinician decisions and overrides, cross-tenant access with its stated
reason, safety events.

**Not covered:**

- **Reads.** The log records what was *done*, not what was *seen*. For a clinical surface,
  "who viewed this member's record" is itself an auditable event and does not exist yet.
- **Direct database access.** An operator bypassing the application leaves no application
  trail (item 3, T2.4).
- **Model calls.** No per-inference provenance record until the AI Gateway lands (ADR 0012).

Read auditing is the one to add with the clinical surface, not after it — retrofitting it
means the pilot's own access history is unreconstructable.

---

## 6. Target state, and what closes each gap

| # | Gap | Closes with | Acceptance test |
|---|---|---|---|
| 1 | Call sites bypass L1/L2 | ADR 0013 §3 call-site migration (Phase 3) | No product write reaches `data()` outside `withTenantTransaction`, enforced by test — gate **G3** |
| 2 | L3/L4 dormant | Postgres cutover (Phase 3) | `verify-rls.sh` green against the deployed schema — gate **G4** |
| 3 | No caseload scoping | Clinical surface (Phase 4) | Out-of-caseload request returns not-found **and is audited** |
| 4 | No MFA | Clinical surface (Phase 4) | MFA required for every non-member role |
| 5 | Role is a column, not a relationship | ADR 0011 step 5/7 | `users.role` no longer read anywhere |
| 6 | Reads unaudited | Clinical surface (Phase 4) | Every clinician view of a member record produces an audit entry |
| 7 | Keys in the process environment | Secret manager (Phase 2) | Neither key readable from the application environment at rest; rotation rehearsed |
