# API contract

Steady has two distinct interface surfaces. Both are documented here; the
machine-readable OpenAPI spec for the HTTP endpoints lives in
[`openapi.yaml`](../openapi.yaml).

## 1. HTTP JSON endpoints (operational only)

Read-only, unauthenticated, no member data. Full schema in `openapi.yaml`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/companion-status` | AI companion health probe (key present + test call), cached 60s |
| GET | `/api/backup-status` | Nightly backup configuration + last success/failure |

There is no public REST API for member data by design — a stolen bearer token
can never enumerate accounts because there is no bearer-token data API.

## 2. Server Actions (the application RPC surface)

All member and clinician behaviour is delivered through React Server Actions
(`src/lib/actions.ts`, `"use server"`). They are invoked from forms/components,
receive `FormData` or typed args, and enforce authorization **inside every
action** — there is no route-level gate to bypass. The three authorization
helpers are:

- `requireUser()` — any authenticated session
- `requireMember()` — role `member`
- `requireClinician()` — role `clinician`

Every data query is scoped to the session `user.id` (IDOR-resistant); clinician
actions additionally write an audit-log entry on member-record access.

### Contract conventions

- **Inputs** are validated and clamped/whitelisted at the top of each action;
  invalid input redirects back with an error rather than throwing to the client.
- **Free-text fields** are AES-256-GCM encrypted at rest (`src/lib/crypto.ts`).
- **Mutations** call `revalidatePath()` for the affected views.
- **Safety-relevant events** are written to the hash-chained audit log
  (`src/lib/audit.ts`) as content-free coded events.

### Action inventory

| Action | Auth | Area |
|---|---|---|
| `login` / `logout` / `signOutEverywhere` | public / user | Session |
| `signup` | public (18+ DOB gate) | Account |
| `startSubscription` / `cancelSubscription` / `resumeSubscription` / `restartSubscription` | member | Billing (demo provider) |
| `grantConsent` | user | Consent ledger |
| `submitFitnessScreening` | member | Program-fit screener (hard-stop gating) |
| `submitScreening` | member | Baseline/ongoing measures (PCL-5, PHQ-9, …) |
| `saveSupportStatus` / `saveTraumaContext` / `saveTriggers` / `saveTriggerDetails` / `saveWarningSigns` / `saveReadinessAssessment` / `saveSafetyPlan` / `saveCompanionPrefs` / `completeOnboardingProfile` | member | Onboarding profile |
| `recordSessionTrigger` | member | Trigger capture |
| `logSafetyEvent` | user | Safety telemetry (coded) |
| `sendCompanionMessage` / `startDailyCompanionChat` | member | AI companion (rate-limited) |
| `setMemoryEnabled` / `deleteMemoryItem` / `clearCompanionMemory` | member | Companion memory controls |
| `submitCheckin` | member | Daily check-in (idempotent per day) |
| `startSession` / `finishSession` / `submitPostSessionCheck` | member | EMDR session lifecycle |
| `requestUnlock` / `decideUnlock` | member / clinician | Module unlock workflow |
| `clinicianOpenModule` / `clinicianCloseModule` / `reviewAlert` | clinician | Clinician overrides |
| `saveTrackIntakeAction` / `selectCareTrack` / `removeCareTrack` | member | Care paths |
| `setTriggerActive` | member | Trigger toggle |
| `acknowledgeCrisis` | user | Crisis acknowledgement |
| `deleteAccount` | member | Right-to-delete (anonymize-in-place) |

Rate limiting: model-backed actions (`sendCompanionMessage`,
`startDailyCompanionChat`) pass through the fixed-window limiter in
`src/lib/rate-limit.ts`; `login` enforces a 10-attempts / 15-minute lockout
derived from the audit trail.
