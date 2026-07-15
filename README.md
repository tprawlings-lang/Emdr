# Steady — self-guided wellness program built on the EMDR method (prototype)

A calm, private, **self-guided wellness program** for adults: guided EMDR-based sessions,
daily readiness check-ins, grounding tools, goal-based care paths, an AI companion with
member-controlled memory, and engineered safety rails. Launching in the **wellness lane**
(see [`COMPLIANCE.md`](COMPLIANCE.md)): not therapy, not medical care, no diagnosis or
treatment claims. Membership is **$34.99/month** after a 7-day free trial.

> **This is a development prototype.** It is not a medical device and is **not for
> emergency use** — US users in crisis should call/text 988 or 911. Remaining launch
> gates are tracked item-by-item in [`COMPLIANCE.md`](COMPLIANCE.md).

**Who this document is for.** This README is the handoff spec for anyone building
skills/automation on top of Steady. It documents the **entire member workflow**, every
**instrument and questionnaire**, exactly **how each is scored**, and **how ongoing scores
open and close modules**. Everything described in §1–§9 is implemented and live. §10
describes the **planned fully-autonomous direction** (replacing clinician oversight with
rules) — that is a design target only; it is **not built and must not be assumed** by
skills until it ships.

---

## 1. The member workflow, end to end

Every member moves through this pipeline in order. Each stage is a hard gate: the next
stage is unreachable until the current one is satisfied, and every block reason is shown
to the member with a link to resolve it (never a dead end).

```
Signup (18+ DOB gate, wellness acknowledgment)
  → Subscribe ($34.99/mo, 7-day trial; demo billing provider)
    → Informed consent (versioned stepper → consent ledger, scope care_program_full)
      → Program-fit screener (8 yes/no items; hard stop ⇒ 24h cooldown + auto-refund)
        → Baseline measures (PC-PTSD-5, PCL-5, ITQ, PHQ-9, GAD-7)
          → Profile onboarding (11 steps, below)
            → Dashboard
              → Daily loop: check-in → (companion daily chat) → modules/sessions
                → post-session check → weekly measures → program plan refresh
```

**Profile onboarding steps** (`/onboarding/profile`, resumable, in order):
`welcome → support → background → triggers → trigger-details → warning-signs →
readiness → safety-plan → companion → focus-chat → summary`

| Step | What is captured | Where it lands |
|---|---|---|
| support | Current therapist status, prior EMDR experience, goals (multi-select) | `user_profiles` |
| background | Trauma areas (broad strokes only — never event detail), restricted topics the companion must not raise | `user_profiles` (restricted topics are honored by the companion system prompt) |
| triggers | Trigger selection from a fixed catalog (5 categories) + custom entries | `user_triggers` |
| trigger-details | Per trigger: intensity **0–10** + typical responses (multi-select) | `user_triggers.intensity_score`, `common_responses_json` |
| warning-signs | Early somatic warning signs (multi-select from 15) | `early_warning_signs` |
| readiness | The readiness assessment (scored — see §4) | `readiness_assessments` |
| safety-plan | Grounding tools, support contact, reminder phrase, stop signs, careful topics | `safety_plans` (free text encrypted) |
| companion | Preferred name, tone, support modes, avoidances, memory on/off | `ai_companion_preferences` |
| focus-chat | Intake-style conversation with the AI companion; focus areas extracted to memory | `ai_conversations` / `ai_memory_items` (type `focus_area`) |

After onboarding, the member may optionally pick **care paths** (`/paths`, §7) — goal-based
routes over the module catalog. Paths shape recommendations and focus options; they never
loosen a gate.

---

## 2. Instruments & questionnaires — what is used and how each is scored

All instruments are public-domain, versioned, and stored per-response in `screenings`
(raw answers encrypted; risk flags in the clear for gating). Interpretation language
everywhere is "screen, not diagnosis."

### 2.1 Program-fit screener (`fitness-screener`, version `fit-v1-placeholder`)

Eight yes/no items, mandatory before baseline measures and any session. **Cannot be
skipped.** Answers are stored as coded 0/1 only, never free text.

| Item id | Question (abridged) | A "yes" means |
|---|---|---|
| `selfharm_30d` | Suicidal thoughts / self-harm urges, past 30 days | **hard stop** |
| `hospitalization_12m` | Psychiatric hospitalization, past 12 months | **hard stop** |
| `psychotic_dissociative_dx` | Diagnosed psychotic or dissociative disorder | **hard stop** |
| `substance_coping` | Currently dependent on substances to cope with memories | **hard stop** |
| `seizure_disorder` | Seizure disorder / photosensitive epilepsy | soft flag → sessions default to **audio-only** bilateral stimulation |
| `unsafe_situation` | Currently in crisis or an unsafe living situation | **hard stop** |
| `under_18` | Under 18 | **hard stop** (also blocked at signup by DOB) |
| `acute_medical` | Acute unstable medical condition / pregnancy-related severe distress | soft flag → gentler pacing + resources |

**Scoring:** any hard-stop "yes" ⇒ outcome `hard_stop`; otherwise any soft-flag "yes" ⇒
`soft_flag`; otherwise `pass`. **Effect of hard stop:** all sessions closed, member routed
to crisis resources, **24-hour cooldown** before retake (`RETAKE_COOLDOWN_HOURS = 24`),
and the current billing period is auto-refunded. After cooldown the screener may be
retaken. Wording/thresholds are placeholders pending EMDR-trained advisor sign-off.

### 2.2 Baseline & ongoing measures

| Instrument | Items | Scale | Total | Positive screen | Risk items |
|---|---|---|---|---|---|
| **PC-PTSD-5** | 5 | Yes/No (0–1) | 0–5 | **≥ 3** probable PTSD | — |
| **PCL-5** | 20 | 0–4 ("Not at all"…"Extremely") | 0–80 | **≥ 33** probable PTSD | item 16 (risk-taking/self-harm) **≥ 3** ⇒ flag `elevated_risk_taking_or_self_harm_behavior` |
| **ITQ** | 18 | 0–4 | criteria-based (below) | PTSD criteria met | — |
| **PHQ-9** | 9 | 0–3 ("Not at all"…"Nearly every day") | 0–27 | **≥ 10** moderate depression | item 9 (suicidal ideation) **≥ 1** ⇒ flag `suicidal_ideation_screen_positive` |
| **GAD-7** | 7 | 0–3 | 0–21 | **≥ 10** moderate anxiety | — |

**Risk-item routing (hard rule):** a positive PHQ-9 item 9 or elevated PCL-5 item 16 never
triggers an autonomous assessment. The app shows scripted safety options (crisis screen)
and queues a same-day review alert. Structured suicide assessment (C-SSRS/SAFE-T class)
is intentionally **not** in-product.

**ITQ scoring (ICD-11, Cloitre et al.).** Items 0–5 are PTSD symptom *pairs*
(re-experiencing 0–1, avoidance 2–3, threat 4–5); items 6–8 PTSD functional impairment;
items 9–14 DSO pairs (affect dysregulation 9–10, negative self-concept 11–12, disturbed
relationships 13–14); items 15–17 DSO impairment. A pair counts when **either item ≥ 2**
("Moderately"). PTSD criteria = all three symptom pairs + ≥1 impairment item ≥ 2.
DSO criteria = same shape over 9–17. **Complex-PTSD** = PTSD + DSO both met.
Reported values: `ptsdSum` (items 0–5, /24), `dsoSum` (items 9–14, /24), and a label
("Complex PTSD criteria met" / "PTSD criteria met" / "Criteria not met") — always framed
as provisional and screen-based.

**Cadence:** all five at baseline (all required before modules open). **Weekly** PCL-5 +
ITQ thereafter — the dashboard flags "measures due" when none was taken in the last 7
days (soft prompt, not a gate). **Worsening alert:** week-over-week jump of **PCL-5 ≥ +10**
or **ITQ (ptsdSum+dsoSum) ≥ +8** queues a `symptom_worsening` review alert.

### 2.3 Daily check-in (`/check-in`, <90 seconds, once per calendar day)

Inputs: activation 0–10, shutdown 0–10, harm urge (y/n), feels safe (y/n), dissociation
0–10, sleep quality 0–10, substance flag (y/n), plus optional "today connects to these
triggers" picks from the member's trigger map.

**Deterministic routing (first match wins):**

| Condition | `recommended_action` | Effect on the day |
|---|---|---|
| harm urge **or** not feeling safe | `crisis` | All sessions paused; crisis screen; review alert |
| dissociation ≥ 7 **or** activation ≥ 8 **or** shutdown ≥ 8 | `grounding_only` | Only Calm Place + Containment open |
| substance flag **or** sleep ≤ 2 **or** dissociation ≥ 4 | `stabilization` | Gated (processing) modules closed; stabilization modules open |
| otherwise | `processing_ok` | All cleared modules open |

The check-in also **recalculates readiness daily** (§4) and, after submission,
auto-opens the companion's daily chat, primed with today's answers and flagged triggers.

### 2.4 In-session distress (SUDS, 0–10, rated between every set)

Deterministic rules from `session-safety.ts` (CI-blocking `@safety` tests):

| Rule | Threshold | Result |
|---|---|---|
| Hard stop | current **≥ 9** | Session ends, grounding flow, urgent/high alert |
| Pause | current **≥ 8** | Grounding + explicit member choice to continue/stop |
| Rise pause | current − session-start **≥ +3** | Same pause flow, even below 8 |
| Post-session cooldown | ending SUDS **≥ 8** | Gated modules closed for **24h** |
| Wind-down / cap | **35 min** wind-down banner, **45 min** hard cap | Session closes at cap |
| Daily cap | **1 gated (processing) session per 24h** (`EMDR_MAX_DAILY_PROCESSING`) | Further gated starts blocked until window passes |

A fixed **"Ground me"** button is always visible in-session: one tap, no confirmation,
halts stimulation, pivots to grounding, logs a safety event.

### 2.5 Post-session check (after every session)

Inputs: distress 0–10, oriented (y/n), safe-tonight (y/n), delayed-risk forecast 0–10,
recovery plan confirmed. **Escalation rule:** not oriented, **or** not safe tonight,
**or** distress ≥ 8, **or** delayed risk ≥ 8 ⇒ escalated. "Not safe tonight" additionally
redirects straight to the crisis screen and raises an **urgent** alert; other escalations
raise a **high** `post_session_review` alert.

### 2.6 Trigger intensity semantics

Trigger intensity (0–10) is captured in onboarding and in Module 5 (structured entry:
name, category, body location, accompanying belief, day-to-day disruption). **Intensity
≥ 7 is specialist territory**: those triggers are shown but *not selectable* as
self-guided session focus, are sequenced last in the program plan with an explicit
"bring to your specialist" approach, and the AI plan prompt is hard-instructed to never
sequence them for self-guided work.

---

## 3. Module catalog

Eleven session modules (orders 2–12; the daily check-in is conceptually slot 1). Tier
governs gating: `autonomous` opens by rules alone; `gated` additionally requires a
specialist unlock; `maintenance` has no prerequisites.

| # | Module id | Name | Tier | Prerequisites |
|---|---|---|---|---|
| 2 | `calm-place` | Calm Place setup | autonomous | — |
| 3 | `containment` | Containment and pause skills | autonomous | calm-place |
| 4 | `body-scan` | Body scan and dual attention | autonomous | containment |
| 5 | `trigger-map` | Trigger map and target inventory | autonomous | containment |
| 6 | `resourcing` | Resource strengthening | autonomous | calm-place |
| 7 | `recent-trigger` | Recent trigger desensitization | **gated** | trigger-map, resourcing |
| 8 | `safe-target` | Safe target processing | **gated** | recent-trigger |
| 9 | `installation` | Belief shift and installation | **gated** | safe-target |
| 10 | `future-template` | Future template rehearsal | **gated** | installation |
| 11 | `relational` | Relationship repair and self-concept | **gated** | resourcing |
| 12 | `maintenance` | Maintenance and relapse prevention | maintenance | — |

Sessions are built from typed steps (`instruction`, `suds`, `bls`, `grounding`,
`trigger-entry`). BLS sets are short by design (20–30s × 2–3 sets). Completing
`trigger-map` fire-and-forgets a **program plan** regeneration (§8).

---

## 4. Readiness scoring — the formula

Captured at onboarding, **recalculated on every daily check-in** (somatic inputs come
from today's check-in; slow-moving answers — support, self-reported readiness, pause
capacity — carry over from the latest stored assessment).

**Weighted 0–100 score:**

```
score = stability×1.5 + bodySafety×1.5 + presentConnection×1.0
      + (10 − symptomIntensity)×1.5 + sleepPoints×1.0 + supportPoints×1.0
      + readinessPoints×1.5 + pausePoints×1.0
```

Point tables: sleep good/okay/poor/very_poor = 10/6.5/3/0 · support yes/sometimes/no =
10/5/0 · processing readiness ready/curious/unsure/overwhelmed/not_now = 10/7.5/5/2.5/0 ·
pause capacity yes/think_so/not_sure/no = 10/6.5/3.5/0.

**Caps (safety over self-report):** risk flag `not_safe` ⇒ score forced to 0 (and routed
to crisis before scoring); `safe_now` ⇒ capped at 30; pause capacity "no" ⇒ capped at 60.

**Track mapping:** ≤30 `stabilization` · 31–60 `preparation` · 61–80 `gentle_processing` ·
81+ `full`.

**Track effects on module openings:** `stabilization` ⇒ only Calm Place + Containment;
`preparation` ⇒ all autonomous modules, no gated modules; `gentle_processing`/`full` ⇒
no readiness restriction (other gates still apply). Copy never implies failure — a low
track reads as "today is a grounding day."

**Daily-recalc input mapping** (check-in → readiness answers): stability =
10 − max(activation, shutdown); bodySafety = feels_safe ? 10 − dissociation : 1;
presentConnection = 10 − dissociation; symptomIntensity = max(activation, shutdown,
dissociation); sleep 0–10 mapped to good ≥7 / okay ≥5 / poor ≥3 / very_poor; risk flag
`safe_now` when harm urge or not feeling safe.

---

## 5. The module-access gate chain (exact order)

`checkModuleAccess(userId, module)` evaluates, in order — first failure blocks with a
member-visible reason + action link:

1. **Kill switch** — `EMDR_DISABLE_NEW_SESSIONS=1` blocks all new sessions globally.
2. **Active subscription.**
3. **Informed consent** — scope `care_program_full`, unrevoked (the signup wellness
   acknowledgment does *not* satisfy this).
4. **Program-fit screener** — unanswered ⇒ blocked to `/screening`; hard-stop cooldown ⇒
   blocked to crisis resources.
5. **Baseline measures complete** — all five instruments.
6. **Profile complete** — onboarding finished.
7. **Today's check-in exists** — no check-in, no session.
8. **Check-in routing** — `crisis` blocks everything; `grounding_only` allows only
   Calm Place/Containment; `stabilization` blocks gated modules.
9. **Readiness track** (§4) — unless a clinician override is active for this module.
10. **Safety plan exists** — required before any gated module.
11. **Prerequisites completed** (§3) — unless a clinician override is active.
12. **Specialist unlock** (gated modules) — member requests; clinician approves/denies
    with a documented reason. A clinician may also **proactively open** a module
    (override) with a required, audited reason.
13. **Daily processing cap** — max 1 gated session per 24h.
14. **SUDS cooldown** — any session in the last 24h ending with SUDS ≥ 8 closes gated
    modules.

**Clinician override semantics (important for skills):** an override relaxes **pacing
gates only** — readiness track (9) and prerequisites (11). It never bypasses the safety
gates (1–8, 10, 13–14): a crisis check-in, fitness cooldown, or SUDS cooldown still
blocks the session even with an override active. Verified by the `@safety` suite.

---

## 6. How ongoing scoring affects module openings (the feedback loops)

| Signal | Cadence | Effect |
|---|---|---|
| Daily check-in | Every day | Routes the day (crisis / grounding_only / stabilization / processing_ok) **and** recalculates the readiness track |
| Readiness track | Recalculated daily | Widens or narrows which tiers are reachable (§4) |
| SUDS trail | Every set, in-session | Pause/hard-stop mid-session; post ≥ 8 ⇒ 24h gated cooldown |
| Post-session check | After every session | Escalation alerts; "not safe tonight" ⇒ crisis routing |
| Weekly PCL-5/ITQ | 7-day prompt | Trend charts; sharp worsening (≥ +10 / ≥ +8) queues review alert |
| Trigger intensities | Onboarding + Module 5 | ≥ 7 excluded from self-guided focus; ordering drives the program plan |
| Fitness screener | Once + on retake | Hard stop closes everything for 24h + auto-refund |
| Unlock decisions / overrides | Event-driven | Open or revoke gated modules (pacing only) |

Net effect: module availability is **recomputed from current state on every page load** —
nothing is "earned permanently" except completed-module prerequisites. A member who had
full access yesterday can be grounding-only today, and that is by design.

---

## 7. Care paths (goal-based routing)

Ten data-driven pathways (`src/lib/tracks.ts`) route members by *what they want to work
on*: PTSD & Trauma, Anxiety & Panic, Phobias, Recent Event, Grief & Loss,
Confidence/Performance, Low Mood (adjunct), Complex-Trauma Readiness, Cravings (adjunct),
Pain & Somatic (adjunct). Each carries an honest **evidence grade**
(high/moderate/emerging/specialist), contraindication tags, a module sequence, and a
**clinician-review level** (`optional`/`recommended`/`required`).

- Members can hold **multiple paths** at once and switch anytime.
- `required`-review paths are **stabilization/referral lanes**: regardless of their
  listed sequence, self-guided access is limited to stabilization modules
  (calm-place, containment, body-scan, resourcing, trigger-map) — never self-guided
  processing.
- The **rules-first recommender** (`track-recommender.ts`, version `track-rules-2026-06`)
  scores intake tags → weighted pathway candidates (top 3, with plain-language
  rationale). Its **safety gate runs before any scoring** and returns *no recommendation*
  if the fit screener is unanswered/cooling down, baseline measures are incomplete, or
  today's check-in flagged crisis. Paths shape recommendations and session focus options
  only — **module gating (§5) is unchanged by path membership.**

---

## 8. Program plan & AI companion

**Program plan** (`program_plans`): regenerated when Module 5 completes (AI-drafted via
Claude with a strict JSON contract; deterministic rules fallback so a model outage never
leaves a member planless). Sequences triggers lowest-intensity-first, marks ≥7 as
specialist territory, prefers modules inside the member's chosen care paths, and keeps
`required`-review paths to grounding-only steps. Surfaced on the member dashboard, in
the specialist's member view (labeled advisory — "your unlock decisions outrank it"),
and as the first pre-session focus option in processing modules.

**AI companion** (`companion-ai.ts`, Claude `claude-opus-4-8`, adaptive thinking, low
effort): contexts are general chat, onboarding intake (`focus-chat`), and post-check-in
daily chat. Hard rules: a **deterministic crisis regex pre-filter always runs before the
model** — matches route to the scripted crisis interrupt (versioned
`crisis-script-v1`), never model improvisation. The system prompt embeds profile
background, restricted topics (never raised first), today's check-in, the trigger map,
and the program plan. Tools: `record_trigger`, `remember` (memory types incl.
`focus_area`, `grounding_tool`), `escalate_risk`. Member free text, memory values, and
chat messages are AES-256-GCM encrypted at the app layer (`enc1:` prefix,
`EMDR_DATA_KEY`). Companion memory is member-viewable, editable, and deletable. If no
`ANTHROPIC_API_KEY` is set, deterministic scripted flows run instead.

---

## 9. Current human-oversight touchpoints (what exists today)

Skills authors should know exactly where a human is in the loop **today**:

1. **Gated-module unlocks** — member requests; clinician approves/denies with a
   documented reason (or proactively opens/closes via override, pacing gates only).
2. **Alert queue** — urgent/high/moderate alerts (hard stops, risk items, post-session
   escalations, symptom worsening, unlock requests) reviewed with a required note.
3. **Member detail review** — screening history, trends, sessions, unlock + consent
   ledgers, AI-drafted program plan (advisory).

Everything else — screeners, check-in routing, SUDS rules, cooldowns, caps, readiness,
the recommender — is **already deterministic and autonomous**.

---

## 10. Planned direction: fully autonomous (NOT YET BUILT)

**Status: design target only. Do not build skills that assume this is live.** The founder
intends to remove clinician oversight and run fully autonomous. Nothing in the codebase
implements this yet; this section exists so skills can be designed with the destination
in mind.

What would change (§9 items get rules-based replacements):

- **Unlocks → auto-unlock criteria.** A gated module opens when deterministic criteria
  are met instead of a human decision. The natural inputs already exist: readiness track
  (`gentle_processing`/`full`), N completed prerequisite sessions with settling SUDS
  (e.g., post < pre, post ≤ 4), no hard stop / crisis routing / worsening alert in a
  lookback window, safety plan present, and trigger intensity of the chosen focus < 7.
  Exact thresholds are **not decided** — treat as open parameters.
- **Alert queue → automated dispositions.** Risk-item positives and post-session
  escalations would route to scripted crisis resources + tightened gating (e.g., forced
  stabilization track for 72h) instead of a human reviewer. Urgent paths (not-safe-
  tonight) already route to crisis resources today and would keep doing so.
- **Program plan** stays advisory but becomes the sequencing authority the auto-unlock
  criteria read from.

What must be true before this launches (blocking, tracked here deliberately):

1. **Every "specialist review" claim must change** — marketing copy, FAQ, dashboard
   ("shared with your care team", "specialist gated"), module copy, ToS/consent language,
   and `COMPLIANCE.md` all currently promise human review. Shipping autonomy without
   rewriting these makes existing claims false.
2. **The third-party build handoff (June 2026) names a live-clinician gate as its
   non-negotiable rule** — going autonomous is an explicit founder decision to depart
   from that document; counsel should re-confirm the wellness-lane posture with
   oversight removed.
3. **The EMDR-trained advisor sign-off** (already a launch gate for screener wording)
   becomes more important, not less: the auto-unlock thresholds inherit the safety role
   the clinician held.
4. The `@safety` suite must grow tests for the auto-unlock rules before any rollout, and
   the kill switch + fitness screener + SUDS rules remain non-negotiable substrate.

---

## 11. Data model quick reference

`users` (+dob) · `consents` (versioned, scoped) · `screenings` (all instruments incl.
fitness screener; answers encrypted) · `checkins` (one/day, `recommended_action`,
`triggers_json`) · `readiness_assessments` (scored, `recommended_track`, source
onboarding/checkin) · `user_profiles` / `user_triggers` / `early_warning_signs` /
`safety_plans` · `therapy_sessions` (pre/post/peak SUDS, status incl. `hard_stop`,
`hard_stop_reason`) · `post_session_checks` (escalated flag) · `module_unlocks` (status,
`override`, decision reason) · `alerts` (severity, review note) · `care_tracks` /
`care_track_intake` · `program_plans` (encrypted plan JSON, generated_by ai/rules) ·
`ai_conversations` / `ai_messages` / `ai_memory_items` / `ai_companion_preferences` ·
`subscriptions` / `payments` · `audit_log` (append-only; identity, consent, clinical,
module runtime, specialist actions, security).

Encrypted-at-app-layer fields carry the `enc1:` prefix (AES-256-GCM, `EMDR_DATA_KEY`,
legacy plaintext passthrough).

---

## 12. Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. SQLite data lives in `.data/` (gitignored).

**Demo accounts** (seeded on first run, development only):
Member `demo@example.com` / `demo1234` · Clinician `clinician@example.com` / `demo1234`.
With `EMDR_DEMO=1` a rich fictional dataset seeds instead.

**Tests & CI:** `npm run test:safety` runs the CI-blocking `@safety` suite (screener
hard stops, SUDS rules, check-in routing, crisis regex, track-recommender safety gate).
CI also runs a banned-vocabulary grep over product copy (wellness-lane claims
discipline).

**Deploy:** production `Dockerfile` (standalone output); Render blueprint
(`render.yaml`) with persistent disk at `/data`; nightly encrypted backups to
Cloudflare R2 with 30-day retention once `R2_*`, `BACKUP_AGE_RECIPIENT`, and Resend
alert vars are set (see [`docs/backups.md`](docs/backups.md), `make restore-test`).
Env vars of note: `ANTHROPIC_API_KEY` (companion + AI plans), `EMDR_DATA_KEY`
(field encryption), `EMDR_DISABLE_NEW_SESSIONS` (kill switch),
`EMDR_MAX_DAILY_PROCESSING` (default 1), `BACKUP_HOUR_UTC` (default 3).

## 13. Stack

Next.js (App Router, server actions, standalone output) · TypeScript · Tailwind CSS ·
better-sqlite3 · Anthropic SDK. No ad-tech, no analytics pixels, no third-party
trackers — by design.

## 14. Known gaps before any real-world use (wellness-lane launch gates)

Tracked in full in [`COMPLIANCE.md`](COMPLIANCE.md); still open:

- **EMDR-trained clinical advisor** — screener wording/thresholds (`fit-v1-placeholder`),
  crisis script, and session scripts need sign-off. Under the planned autonomous model
  (§10) this advisor also owns the auto-unlock thresholds.
- **Managed auth provider** (TOTP 2FA, admin realm) — interim: scrypt + signed cookies,
  login lockout, 7-day-idle/30-day-absolute sessions.
- **Email provider** — password reset, lockout notices, pre-charge reminders,
  retention warnings, backup-failure alerts.
- **Real payments** — Stripe hosted checkout; safety auto-refund and 2-click cancel
  already work against the demo provider.
- **Security & accessibility evidence** — companion red-team pass, WCAG 2.2 self-audit,
  ZAP + gitleaks, backup-restore drill, SSL Labs record.
- **Cyber liability insurance** quote ([`docs/incident-response.md`](docs/incident-response.md)).
- **Founder decisions** — encrypted companion transcripts vs summarize-and-discard
  (compliance 2.4); domain + branded support email (unblocks ToS contact placeholder);
  **autonomous-model claim rewrite** (§10 item 1).
