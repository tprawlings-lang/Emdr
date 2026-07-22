# Steady — Go-Live Runbook

**Purpose:** the exact, ordered steps to move Steady from demo/beta to serving
real members — every flag, every gate, and who owns each. Nothing here is
"live" until a human performs these steps deliberately. This is the master
switch list; detailed context lives in [`README.md` §14](../README.md) and
[`COMPLIANCE.md`](../COMPLIANCE.md).

**Golden rule:** capabilities go live **one at a time**, each behind its own
flag, after its own gate is cleared. Never flip everything at once.

---

## 0. Roles

| Owner | Responsible for |
|---|---|
| **Founder** | Business decision to launch; provisioning outside accounts; flipping flags. |
| **Clinician** | Clinical sign-off in the Autonomous Review console. |
| **Counsel** | Legal-copy approval, voice/biometric consent, launch legal review. |
| **Engineering (Claude/you)** | Migrations, wiring, verification, evidence. |

---

## 1. Pre-flight gates (must ALL be true before ANY real member)

These are independent of which capability you turn on.

- [~] **Infrastructure: Postgres cutover** — **CODE-COMPLETE & verified on a
      local PG16 cluster** (all data access async, dialect-neutral SQL,
      pg_dump backup; app boots + round-trips + audit chain verify on Postgres).
      Remaining is OPS: provision Render Postgres, one-time data load, flip
      `EMDR_DB=postgres`, then scale to >1 instance (audit-chain serialization
      is already in code — advisory lock).
      *(Runbook §4; details in `docs/pg-migration-progress.md`; owner: Eng/Founder.)*
- [ ] **Outside accounts provisioned** (README §14.1): login/MFA provider,
      email provider (Resend key), Stripe live checkout. *(Owner: Founder.)*
- [ ] **Off-site backups verified** — `R2_*` + `BACKUP_AGE_RECIPIENT` set,
      `make restore-test` green (RPO 24h / RTO ~1h). *(Owner: Eng.)*
- [ ] **Env-guard fatal secrets present** in production: `EMDR_SESSION_SECRET`,
      `EMDR_DATA_KEY`. (App refuses to boot without them — by design.)
- [ ] **Branded domain + support email** live (fills ToS/Privacy placeholders).

---

## 2. Capability: Autonomous safety engine (governs access)

Currently: **shadow mode** (computes + logs, governs nothing).

Gate:
- [ ] **Clinician sign-off complete** in the console: all rules **Agree**, zero
      Needs-change, zero unreviewed, at the current `SAFETY_CONFIG_VERSION`.
      Verify via the CSV export. *(Owner: Clinician; confirm: Founder.)*
- [ ] **Counsel-approved legal copy staged** (already flag-aware in code:
      `*_AUTONOMOUS` consent/ToS/privacy versions). *(Owner: Counsel — done per
      founder's attorney.)*

Flip (atomic — copy + behavior together):
- [ ] Set **`EMDR_AUTONOMOUS_SAFETY=1`**. This simultaneously: engages the
      engine as the governing decision-maker AND serves the autonomous
      consent/ToS/privacy versions (the selectors switch together).
- [ ] **Re-consent existing members** to the new version (grandfather re-prompt).
- [ ] Update product microcopy that still says "waiting for your specialist's
      review" → rule-based language *(README §14.4; owner: Eng, ships with flip.)*

Verify after flip:
- [ ] Spot-check a member journey; confirm audit shows `safety_routing` (not
      `_shadow`); confirm gated modules open only per the rules.

Rollback: set `EMDR_AUTONOMOUS_SAFETY=0` — returns to shadow + current copy
instantly. Kill switches (`EMDR_KILL_*`) disable sub-capabilities per-stage.

---

## 3. Capability: Voice input & live spoken sessions

Currently: **demo-only** (`voiceAvailableFor`/`liveAvailableFor` return true only
in demo). Gate wired — see Task 1.

Gate:
- [x] **Counsel approved the voice/biometric consent** (2026-07-22, per founder's
      attorney) — finalized as `voice-consent-v1.0` in `policy.ts`; gate wired
      (`/settings/voice`, `decideVoiceAvailability`). *(Owner: Counsel — done.)*
- [ ] **Clinician sign-off** on `LIVE_SESSION_*` + `VOICE_INPUT_*` rows (in the
      console). *(Owner: Clinician.)*
- [ ] Confirm the **on-device recognition** story for the shipped app if/when
      native (the web build uses the browser recognizer — disclosed in consent).

Flip (voice and live are independent — do voice first, watch, then live):
- [ ] Set **`EMDR_VOICE_INPUT=1`** (typed-reflection dictation). Real members now
      see voice only after granting consent at `/settings/voice`.
- [ ] Later, set **`EMDR_LIVE_SESSION=1`** (hands-free + dynamic responder), same
      consent gate.

Verify:
- [ ] A test member without consent sees **no** mic; after granting at
      `/settings/voice`, the mic appears; withdrawing removes it immediately.
- [ ] Audit shows `voice_consent_granted` / `session_spoken_response` (content-free).

Rollback: `EMDR_VOICE_INPUT=0` / `EMDR_LIVE_SESSION=0` — mic disappears for
everyone at once.

---

## 4. Infrastructure: Postgres zero-downtime cutover (pre-flight blocker §1)

Owner: Engineering. Detail in [ADR 0007](adr/0007-scaling-zero-downtime.md) and
[`docs/pg-migration-progress.md`](pg-migration-progress.md).

- [x] Port all data-access call sites to the async layer (done; getDb() gone
      from app code).
- [x] Dialect-neutral SQL (no SQLite-only datetime/julianday/INSERT OR IGNORE).
- [x] Backup pg_dump path.
- [x] Verified on a real local Postgres 16 cluster (boot + round-trip + audit
      chain + backup).
- [ ] **OPS:** provision the managed Render Postgres (~$7/mo), set `DATABASE_URL`
      + `EMDR_DB=postgres`.
- [ ] **OPS:** one-time load of existing SQLite data into Postgres, then flip.
- [x] Audit-chain serialization for concurrent writers — **done in code**
      (transaction-scoped Postgres advisory lock in `audit()`; empty-table safe).
- [ ] **OPS:** scale past one instance and confirm rolling deploys drop no
      requests (no code change left — set `numInstances ≥ 2`).

---

## 5. Launch order (recommended)

1. Clear all of **§1 pre-flight** (Postgres first).
2. Turn on **§2 autonomous engine** (with legal-copy flip + re-consent). Watch.
3. Turn on **§3 voice input** (after counsel consent). Watch.
4. Turn on **§3 live sessions**. Watch.

Each step is independently reversible. Stop and reassess on any anomaly — the
kill switches and per-flag rollback exist precisely for this.

---

## 6. What is TRUE about the current build (as of this runbook)

- Autonomous engine: **shadow mode**, flag off.
- Voice / live sessions: **demo-only**, consent gate wired, flags off.
- Legal copy: current human-in-loop copy live; autonomous copy staged behind
  the flag; voice/biometric consent **counsel-approved** (`voice-consent-v1.0`),
  gate wired — enforced automatically when the voice/live flag flips.
- Database: **single-instance SQLite** (Postgres migration outstanding).
- No real members are governed by, or exposed to, any of the above.
