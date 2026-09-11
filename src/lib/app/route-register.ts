// The route register (handoff 09 Package 0: "Reconcile and freeze").
//
// Package 0's exit evidence is one sentence: "One dated register distinguishing
// working, unavailable, proposed, and externally blocked. No product behavior
// change; current tests and build green."
//
// THIS FILE IS THAT REGISTER, AND IT IS CODE RATHER THAN PROSE for one reason:
// a register in a document goes stale the week after it is written, and nobody
// finds out. This one is checked by tests/route-register.test.ts, which fails
// the build if a route exists without an entry, if an entry points at a route
// that does not exist, or if a state here disagrees with what the page actually
// says. §10's Package 0 asks to "block new top-level routes without a manifest
// entry"; that guard is what does it.
//
// WHY THE STATE MATTERS MORE THAN THE ROUTE LIST. Handoff 09 §1.1 rules that
// unavailable capabilities are omitted from primary navigation entirely,
// because "a navigation item is a promise; promoting a route that dead-ends is
// the fastest way to lose a clinician's trust in the whole shell." That ruling
// cannot be applied without knowing which routes dead-end, and reading 128
// files by hand is how a reviewer arrives at a different answer each time. So
// the answer is recorded once, here, with the evidence for each.
//
// WHAT THIS FILE IS NOT. It is not the NavigationManifest that handoff 09 §9
// specifies — that contract carries capability state, canonical destination,
// owning workspace and active-route matching, and it is built in Package 1
// where it can be wired into the shell. This is the inventory the manifest will
// be built FROM, and it deliberately changes no behaviour: Package 0 ships a
// truth, not a change.
//
// AND IT DOES NOT RESOLVE THE CONFLICTS IT FINDS. `PROMOTED_UNAVAILABLE` below
// records that the clinician rail currently promotes a dead-end route. Fixing
// it is Package 2's job, because Package 0's own exit evidence says "no product
// behavior change". A register that quietly repaired what it found would be a
// register nobody could use to size the work.

/** When this register was compiled, and against what.
 *
 *  DATED, because handoff 09 §12 is explicit that the carry-forward entries in
 *  both source documents "are not fresh assertions that the items remain open
 *  today" — they were true at a baseline commit and reconciling them is this
 *  package's work. A register without a date invites the same mistake one
 *  generation later. */
export const REGISTER_DATE = "2026-09-08";

/** The commit this register was compiled against. Handoff 09 and the Astra
 *  review were both written against `0b1d15b`, which is the merge that landed
 *  expansion handoff 04 — so both source documents' registers are two feature
 *  commits stale on Recovery Trajectory and Therapeutic Load. See
 *  `RECONCILED` below. */
export const REGISTER_COMMIT = "19576da62611cc42b2c220a3e519ce8a424aaf82";

/** The baseline both source documents were written against, recorded so the
 *  difference between their claims and this register is attributable rather
 *  than mysterious. */
export const SOURCE_BASELINE = "0b1d15b9307f906af987b956535be532441b1b4c";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * What a route actually is today.
 *
 * FOUR STATES FROM HANDOFF 09 PACKAGE 0, PLUS ONE THE FILESYSTEM FORCED.
 * `redirect` is not in the handoff's list because the handoff was describing
 * capabilities rather than files; four routes in this app exist only to send
 * somebody to the real address they typed a shorter version of, and calling
 * those "working" would put four non-destinations in the working count.
 *
 * The distinction that carries the weight is `working` versus `unavailable`. An
 * unavailable route is not broken and not empty — it is a page that says, in
 * words, that the capability behind it does not exist here. Those pages are
 * good; §1.1's ruling is about NAVIGATION, not about them.
 */
export type CapabilityState =
  /** The route does the job named below. */
  | "working"
  /** The route exists and states that its capability does not. Reachable
   *  deliberately; never promoted in primary navigation (§1.1). */
  | "unavailable"
  /** Named in a governing document, no route. Recorded so the gap is visible
   *  in the same list as everything else. */
  | "proposed"
  /** Held by something outside this codebase — a cutover gate, counsel, a
   *  deployment decision. Not work anybody here can finish. */
  | "externally_blocked"
  /** Exists only to send the caller to the canonical address. */
  | "redirect";

/**
 * Who the route is for.
 *
 * `public` covers the institutional site and the auth paths: pages a person
 * reaches before they are anybody in particular. `investor` is a PRESENTATION
 * AUDIENCE rather than an account role — handoff 09 §1.9: "Investor is a
 * presentation audience inside authorized synthetic demonstrations, never a new
 * privileged account role." It appears in this enum so the register can record
 * which routes a bounded story may use, and it grants nothing.
 */
export type Audience =
  | "public"
  | "member"
  | "clinician"
  | "organization"
  | "payer"
  | "reviewer"
  | "demo_admin"
  | "investor";

/**
 * The workspace that owns the route.
 *
 * Handoff 09 §1.5 rules that "work needing action lives in Command Center. The
 * full roster lives under Patients", which is a statement about OWNERSHIP —
 * two destinations must not both claim the caseload. Recording an owner per
 * route is what makes that checkable, and what stops the next person from
 * adding a third home for the same job.
 */
export type Workspace =
  | "site"
  | "auth"
  | "member_day"
  | "member_activity"
  | "member_account"
  | "command_center"
  | "patients"
  | "person_record"
  | "clinician_reports"
  | "org_console"
  | "payer_console"
  | "review_console"
  | "demo_ops";

export interface RouteEntry {
  /** The route, as Next resolves it. Dynamic segments in brackets. */
  path: string;
  audience: Audience;
  /** What a person comes here to do, in their terms. One line.
   *
   *  Written as a JOB rather than as a page description, because handoff 09
   *  §10 Package 0 asks to "map every route to role, job, owner" and because a
   *  route whose job cannot be said in one line is usually a route that is
   *  doing two things. Several below were shortened once and stayed short. */
  job: string;
  workspace: Workspace;
  state: CapabilityState;
  /** Why the state is what it is. Required on every entry that is not
   *  `working`: a state nobody has to justify is a state that drifts. */
  evidence?: string;
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

export const ROUTE_REGISTER: RouteEntry[] = [
  // ---- Public site and authentication -------------------------------------
  { path: "/", audience: "public", job: "Understand what Steady is before deciding to look further.", workspace: "site", state: "working" },
  { path: "/about", audience: "public", job: "Read who builds Steady and under what clinical governance.", workspace: "site", state: "working" },
  { path: "/clinical", audience: "public", job: "Read the clinical position: what the rules do and who ratified them.", workspace: "site", state: "working" },
  { path: "/evidence", audience: "public", job: "Find the dated evidence behind any claim Steady makes.", workspace: "site", state: "working" },
  { path: "/trust", audience: "public", job: "Check the security, privacy and governance posture in one place.", workspace: "site", state: "working" },
  { path: "/intelligence", audience: "public", job: "Understand the aggregate product for organizations and payers.", workspace: "site", state: "working" },
  { path: "/organizations", audience: "public", job: "Read the offer to a provider organization.", workspace: "site", state: "working" },
  { path: "/payers", audience: "public", job: "Read the offer to a payer.", workspace: "site", state: "working" },
  { path: "/personal", audience: "public", job: "Read the offer to a person considering Steady for themselves.", workspace: "site", state: "working" },
  { path: "/platform", audience: "public", job: "Read how the platform is put together.", workspace: "site", state: "working" },
  { path: "/faq", audience: "public", job: "Answer a specific question without reading a page of prose.", workspace: "site", state: "working" },
  { path: "/crisis", audience: "public", job: "Reach crisis support immediately, needing nothing from this system.", workspace: "site", state: "working", evidence: "Renders with no account, no network round-trip and no database; asserted by tests/access-states.test.ts." },
  { path: "/accessibility", audience: "public", job: "Read the accessibility commitment and how to report a barrier.", workspace: "site", state: "working" },
  { path: "/privacy", audience: "public", job: "Read what is collected and who can see it.", workspace: "site", state: "working" },
  { path: "/terms", audience: "public", job: "Read the terms.", workspace: "site", state: "working" },
  { path: "/status/degraded", audience: "public", job: "See what is working and what is not, measured rather than asserted.", workspace: "site", state: "working" },
  { path: "/request-review", audience: "public", job: "Ask for access to the review environment.", workspace: "site", state: "working" },
  { path: "/login", audience: "public", job: "Sign in.", workspace: "auth", state: "working" },
  { path: "/signup", audience: "public", job: "Join the pilot with an access code.", workspace: "auth", state: "working", evidence: "A gated pilot, not open self-signup: an access code, twenty-five places, and a page that names what the next screens ask before the first field. Redirects to /request-review when EMDR_ENROLLMENT_CODE is unset, which is the state a deployment is in unless somebody deliberately opens it (docs/demo/enrollment.md)." },
  { path: "/verify", audience: "public", job: "Confirm an email address.", workspace: "auth", state: "working" },
  { path: "/reset", audience: "public", job: "Recover access to an account.", workspace: "auth", state: "working" },
  { path: "/invite/[token]", audience: "public", job: "Accept an invitation into a tenant.", workspace: "auth", state: "working" },
  { path: "/session-expired", audience: "public", job: "Understand that a sign-in ended and get back in.", workspace: "auth", state: "working" },
  { path: "/403", audience: "public", job: "Learn that this account cannot reach this area, and where its own home is.", workspace: "auth", state: "working", evidence: "§8.4 requires Forbidden to name a safe role home rather than read as a missing route." },
  { path: "/subscribe", audience: "public", job: "Start or change a membership.", workspace: "member_account", state: "working" },

  // ---- Member: the day ----------------------------------------------------
  { path: "/app/today", audience: "member", job: "See what would help today and start one thing.", workspace: "member_day", state: "working" },
  { path: "/app/welcome", audience: "member", job: "Arrive for the first time and understand what happens next.", workspace: "member_day", state: "working" },
  { path: "/app/paths", audience: "member", job: "See what kind of support is open right now.", workspace: "member_day", state: "working" },
  { path: "/app/progress", audience: "member", job: "Look back at what has actually been recorded, at their own pace.", workspace: "member_day", state: "working", evidence: "§4.5: describes recorded changes in plain language, with no grades, streaks, thresholds or composite figure." },
  { path: "/app/modules", audience: "member", job: "Ask a clinician to open a gated module, and read the answer.", workspace: "member_activity", state: "working", evidence: "The request half of the same workflow. Asking is not unlocking: the row lands as requested and waits. The clinician's reason is printed back, because a decision a member cannot read is one they cannot disagree with." },
  { path: "/app/plan", audience: "member", job: "Read what the care plan currently says.", workspace: "member_day", state: "working" },
  { path: "/app/care-team", audience: "member", job: "See who is involved in their care and what each person can see.", workspace: "member_day", state: "working" },
  { path: "/app/messages", audience: "member", job: "Message a clinician.", workspace: "member_day", state: "unavailable", evidence: "No message store, thread, recipient or delivery path exists. Independently confirmed by source reading in the Astra review and again here. §1.1: omitted from primary navigation; no composer until a recipient and a delivery path both exist." },

  // ---- Member: activities and sessions ------------------------------------
  { path: "/app/check-in", audience: "member", job: "Say how today feels, and be able to stop at any point.", workspace: "member_activity", state: "working" },
  { path: "/app/ground", audience: "member", job: "Ground now, needing nothing from the rest of the system.", workspace: "member_activity", state: "working", evidence: "Runs in the page; survives a write, subscription, sync or service failure." },
  { path: "/app/activities", audience: "member", job: "Choose something familiar to do.", workspace: "member_activity", state: "working" },
  { path: "/app/activities/breathe", audience: "member", job: "Do a breathing practice.", workspace: "member_activity", state: "working" },
  { path: "/app/activities/meditate", audience: "member", job: "Do a short meditation.", workspace: "member_activity", state: "working" },
  { path: "/app/activities/move", audience: "member", job: "Do a movement practice.", workspace: "member_activity", state: "working" },
  { path: "/app/activities/sleep", audience: "member", job: "Do something to help with sleep.", workspace: "member_activity", state: "working" },
  { path: "/app/companion", audience: "member", job: "Talk to the AI companion, knowing it is AI and what it cannot do.", workspace: "member_activity", state: "working", evidence: "§11 open decision: the companion has no defined position in the Vol 2 session state machine. Entry states that it is AI and names its communication limits; it has no face, name-as-persona or personality arc (§2.2 Finding 2)." },
  { path: "/app/learn", audience: "member", job: "Read something short about what is happening to them.", workspace: "member_activity", state: "working" },
  { path: "/app/learn/[lessonId]", audience: "member", job: "Read one lesson.", workspace: "member_activity", state: "working" },
  { path: "/app/session/prepare", audience: "member", job: "Get ready for a guided session and see what it involves.", workspace: "member_activity", state: "working" },
  { path: "/app/session/resourcing", audience: "member", job: "Do resourcing work rather than processing work.", workspace: "member_activity", state: "working" },
  { path: "/app/session/[moduleId]", audience: "member", job: "Do a guided session, with pause and stop always reachable.", workspace: "member_activity", state: "working", evidence: "§12 carry-forward: the session reducer and closure work is a reported implementation gap against Presentation Layer §6. The route works; the closure/interruption proof is outstanding." },
  { path: "/app/session/[moduleId]/safety", audience: "member", job: "Be stopped safely when continuing is not the safe choice.", workspace: "member_activity", state: "working" },
  { path: "/app/session/[moduleId]/complete", audience: "member", job: "Close a session, including the post-session check.", workspace: "member_activity", state: "working" },

  // ---- Member: the gate ---------------------------------------------------
  { path: "/app/onboarding", audience: "member", job: "Begin the paced sequence that decides what is open to them.", workspace: "member_activity", state: "working", evidence: "§4.3: rendered as a paced sequence, one question per screen, never as a form." },
  { path: "/app/onboarding/profile", audience: "member", job: "Record triggers, readiness and a safety plan.", workspace: "member_activity", state: "working" },
  { path: "/app/screening/fit", audience: "member", job: "Answer the program-fit questions.", workspace: "member_activity", state: "working" },
  { path: "/app/screening", audience: "member", job: "See which baseline instruments are still needed.", workspace: "member_activity", state: "working" },
  { path: "/app/screening/[instrumentId]", audience: "member", job: "Complete one instrument, one question per screen.", workspace: "member_activity", state: "working", evidence: "§4.3: safety-relevant items commit and route immediately, before instrument completion; a fired disposition cannot be undone by backing out." },
  { path: "/app/measures", audience: "member", job: "See which measures are due.", workspace: "member_activity", state: "working" },
  { path: "/app/measures/[instrumentId]", audience: "member", job: "Complete one measure.", workspace: "member_activity", state: "working", evidence: "§4.3: the sequence terminates in a day state, never a result screen carrying a number." },
  { path: "/app/consent", audience: "member", job: "Read and complete consent, or withdraw it.", workspace: "member_activity", state: "working" },

  // ---- Member: account ----------------------------------------------------
  { path: "/app/settings", audience: "member", job: "Find the setting they came for.", workspace: "member_account", state: "working" },
  { path: "/app/settings/referral", audience: "member", job: "See what a referral would take with you, and what it would leave behind.", workspace: "member_account", state: "working", evidence: "Handoff 09 §11's referral-export decision: passive compilation, with the condition that the member is told what it contains. Compiled from records that already exist — consent scopes, latest validated measures, current safety routing, engagement counts, program track — and refused field by field unless every value is a code, count, score, date or short label, so prose cannot travel. The packet cannot be disclosed: no consent scope in this product authorises sending a record outside it and there is no destination, and the screen says both rather than rendering a disabled button." },
  { path: "/app/settings/account", audience: "member", job: "Change their own details.", workspace: "member_account", state: "working" },
  { path: "/app/settings/billing", audience: "member", job: "See and change what they pay.", workspace: "member_account", state: "working" },
  { path: "/app/settings/sessions", audience: "member", job: "See where they are signed in and end a session.", workspace: "member_account", state: "working" },
  { path: "/app/settings/memory", audience: "member", job: "See what the companion remembers, and delete it.", workspace: "member_account", state: "working", evidence: "§2.1: exit and delete are first-class controls, not buried preferences." },
  { path: "/app/settings/voice", audience: "member", job: "Turn voice on or off, under its own consent.", workspace: "member_account", state: "working" },

  // ---- Clinician: Command Center ------------------------------------------
  { path: "/clinician", audience: "clinician", job: "Reach the clinician home from the address they typed.", workspace: "command_center", state: "redirect", evidence: "Sends to /clinician/today. Replaced an older second console whose alert list and member table created the two mental models handoff 05 §3.2 described." },
  { path: "/clinician/today", audience: "clinician", job: "See who needs review today, why, and do the next thing.", workspace: "command_center", state: "working", evidence: "§1.5: work needing action lives here. Coverage failures are visible; opening a row is not acknowledgement." },
  { path: "/clinician/activity", audience: "clinician", job: "See what has happened across the caseload recently.", workspace: "command_center", state: "working" },
  { path: "/clinician/alerts/[id]", audience: "clinician", job: "Answer one safety alert with a documented action.", workspace: "command_center", state: "working" },
  { path: "/clinician/caseload", audience: "clinician", job: "See the current clinical state of everyone assigned to them.", workspace: "patients", state: "working", evidence: "§1.5 rules the full roster belongs under Patients; this route currently answers both questions and is listed under `patients` for that reason. Reconciling the two destinations is Package 2." },
  { path: "/clinician/patients", audience: "clinician", job: "Find one person among everyone they are responsible for.", workspace: "patients", state: "working" },
  { path: "/clinician/population", audience: "clinician", job: "See the shape of their whole panel rather than one person.", workspace: "clinician_reports", state: "working" },
  { path: "/clinician/reports", audience: "clinician", job: "Read an aggregate report about their own work.", workspace: "clinician_reports", state: "working" },
  { path: "/clinician/unlocks", audience: "clinician", job: "Answer a member's request to open a gated module.", workspace: "command_center", state: "working", evidence: "The decision half of a workflow that had a table, events and a pending count on the caseload and no screen at either end. Tenant-scoped; a reason is required and the member reads it on their own modules screen. An unlock relaxes this gate only — the daily check-in, cooldown, per-day cap and kill switch still hold." },
  { path: "/clinician/handoffs", audience: "clinician", job: "Hand a person over to another clinician.", workspace: "command_center", state: "working", evidence: "A transfer is proposed, then accepted, declined or withdrawn — and accountability moves only on acceptance, so an unanswered proposal leaves the sender holding the person. Nobody is notified: there is no delivery path in this build, and every state says so." },
  { path: "/clinician/referrals", audience: "clinician", job: "Refer a person out.", workspace: "command_center", state: "unavailable", evidence: "STALE UNTIL NOW: this said no referral capability existed at all, after the packet compiler had shipped. What is missing is narrower — the packet is assembled and the member can read it, but there is no eligibility check, no wait clock and no destination, and no consent scope in this product authorises sending a record outside it. A referral queue with no wait clock reports movement it cannot measure, which is the one figure the screen exists to make visible." },
  { path: "/clinician/messages", audience: "clinician", job: "Message a member.", workspace: "command_center", state: "unavailable", evidence: "No message store, thread or delivery path. Confirmed by source reading in the Astra review. §1.1: omitted from primary navigation." },
  { path: "/clinician/schedule", audience: "clinician", job: "See and change appointments.", workspace: "command_center", state: "unavailable", evidence: "No scheduling model exists. Confirmed by source reading in the Astra review. §1.1: omitted from primary navigation." },

  // ---- Clinician: one person's record -------------------------------------
  { path: "/clinician/member/[id]", audience: "clinician", job: "Get oriented on one person in ten seconds.", workspace: "person_record", state: "working" },
  { path: "/clinician/member/[id]/course", audience: "clinician", job: "Choose which reading of this person's course to open.", workspace: "person_record", state: "working", evidence: "Handoff 09 §5's Course section. Holds measures, life goals, responses and trajectory as named links, so the person record's tab row is five sections rather than a wrapping second menu." },
  { path: "/clinician/member/[id]/measures", audience: "clinician", job: "Read the instrument scores over time.", workspace: "person_record", state: "working" },
  { path: "/clinician/member/[id]/goals", audience: "clinician", job: "See what this person is trying to get back to, and whether it is moving.", workspace: "person_record", state: "working" },
  { path: "/clinician/member/[id]/sessions", audience: "clinician", job: "Read what happened in the sessions and what followed them.", workspace: "person_record", state: "working" },
  { path: "/clinician/member/[id]/session/[sid]", audience: "clinician", job: "Read one session in full.", workspace: "person_record", state: "working" },
  { path: "/clinician/member/[id]/responses", audience: "clinician", job: "See what this person has been exposed to and what was observed after.", workspace: "person_record", state: "working" },
  { path: "/clinician/member/[id]/trajectory", audience: "clinician", job: "See whether the course has changed, domain by domain.", workspace: "person_record", state: "working", evidence: "Expansion handoff 04, all four phases. RECONCILED: both source documents record this as not started at their baseline." },
  { path: "/clinician/member/[id]/load", audience: "clinician", job: "See how much the work appears to be costing and what they recover from it with.", workspace: "person_record", state: "working", evidence: "Expansion handoff 05, all four phases. RECONCILED: both source documents record this as a deferred feature. §10.1 requires its own clinical review before these states enter the clinician task queue — that review is outstanding, so the provider is held and this screen is the only place the states appear." },
  { path: "/clinician/member/[id]/safety", audience: "clinician", job: "See what the safety rules decided and what may be relaxed.", workspace: "person_record", state: "working" },
  { path: "/clinician/member/[id]/thoughts", audience: "clinician", job: "Record and organise their own thinking about this person.", workspace: "person_record", state: "working", evidence: "Clinician Thoughts phases 0-4. Phase 5 (Ask Steady) is not started — §12 carry-forward." },
  { path: "/clinician/member/[id]/notes", audience: "clinician", job: "Write, sign and amend a clinical note.", workspace: "person_record", state: "working", evidence: "The clinician's own account, in their own words. Nothing is assembled and nothing signs itself — the note bridge was right that Steady must not attest on a clinician's behalf, and this is the table it said did not exist. A signed note is immutable at the trigger as well as in the domain; a correction is an amendment that sits beside the original so both what was believed on the day and what is believed now keep their answers." },
  { path: "/clinician/member/[id]/note", audience: "clinician", job: "Turn approved items into a note draft to take into the record system.", workspace: "person_record", state: "working", evidence: "Clinician Thoughts spec Phase 6. Clinician-selected approved items only, with every source item id preserved on the line it produced. The draft is derived and stored nowhere, which is how the phase's disabled-without-data-loss rule is answered rather than promised; nothing signs, because a signature attests to a clinician's own statement in the record system of truth and Steady applying one would be attesting on their behalf. A selected item that was never approved comes back as a refusal with its reason — a silent omission from a clinical note is the failure that section exists to prevent." },
  { path: "/clinician/member/[id]/plan", audience: "clinician", job: "Read and change the care plan.", workspace: "person_record", state: "working" },
  { path: "/clinician/member/[id]/record", audience: "clinician", job: "Read the whole longitudinal record and approve or correct it.", workspace: "person_record", state: "working" },
  { path: "/clinician/member/[id]/audit", audience: "clinician", job: "See who did what to this record, and when.", workspace: "person_record", state: "working" },

  // ---- Organization console -----------------------------------------------
  { path: "/organization", audience: "organization", job: "Reach the organization home from the address they typed.", workspace: "org_console", state: "redirect", evidence: "Sends to /organization/overview." },
  { path: "/organization/overview", audience: "organization", job: "Find the delivery problem that needs attention this week.", workspace: "org_console", state: "working" },
  { path: "/organization/care-delivery", audience: "organization", job: "See how care is actually being delivered across the organization.", workspace: "org_console", state: "working" },
  { path: "/organization/outcomes", audience: "organization", job: "See whether outcomes are moving, with denominators attached.", workspace: "org_console", state: "working" },
  { path: "/organization/population", audience: "organization", job: "Understand who is in the population.", workspace: "org_console", state: "working" },
  { path: "/organization/capacity", audience: "organization", job: "See whether there are enough clinician hours for the work.", workspace: "org_console", state: "working" },
  { path: "/organization/teams", audience: "organization", job: "See how teams are performing and staffed.", workspace: "org_console", state: "working" },
  { path: "/organization/locations", audience: "organization", job: "Compare locations without comparing incomparable cohorts.", workspace: "org_console", state: "working" },
  { path: "/organization/safety", audience: "organization", job: "See safety events in aggregate, reaching no person record.", workspace: "org_console", state: "working" },
  { path: "/organization/access", audience: "organization", job: "See who can reach what, and change it.", workspace: "org_console", state: "working" },
  { path: "/organization/reports", audience: "organization", job: "Request an export and collect it when it is ready.", workspace: "org_console", state: "working", evidence: "§6: export is a job rather than a button; authorization is rechecked at download." },

  // ---- Payer console ------------------------------------------------------
  { path: "/payer", audience: "payer", job: "Reach the payer home from the address they typed.", workspace: "payer_console", state: "redirect", evidence: "Sends to /payer/overview." },
  { path: "/payer/overview", audience: "payer", job: "See what changed in the population they are paying for.", workspace: "payer_console", state: "working" },
  { path: "/payer/population", audience: "payer", job: "Understand the covered population.", workspace: "payer_console", state: "working" },
  { path: "/payer/population-access", audience: "payer", job: "See whether the population can actually get care.", workspace: "payer_console", state: "working" },
  { path: "/payer/cohorts", audience: "payer", job: "Define and inspect a cohort, and see when one is incomparable.", workspace: "payer_console", state: "working" },
  { path: "/payer/outcomes", audience: "payer", job: "See outcomes with unit, period, denominator and lag beside the value.", workspace: "payer_console", state: "working", evidence: "§6: observed and modelled are visually separate; a user never has to open a drawer to learn a number is modelled." },
  { path: "/payer/engagement", audience: "payer", job: "See engagement without reading it as adherence.", workspace: "payer_console", state: "working" },
  { path: "/payer/utilization", audience: "payer", job: "See what was used, against what was contracted.", workspace: "payer_console", state: "working" },
  { path: "/payer/contract", audience: "payer", job: "Read the contract's own measures and how they are computed.", workspace: "payer_console", state: "working" },
  { path: "/payer/evidence", audience: "payer", job: "Find the method behind any number on these screens.", workspace: "payer_console", state: "working" },
  { path: "/payer/evidence/cost", audience: "payer", job: "See the cost model, labelled as modelled.", workspace: "payer_console", state: "working" },
  { path: "/payer/data-quality", audience: "payer", job: "See the lag, rejections, corrections and exclusions in their own feed.", workspace: "payer_console", state: "working" },
  { path: "/payer/access", audience: "payer", job: "See who can reach what, and change it.", workspace: "payer_console", state: "working" },

  // ---- Review console -----------------------------------------------------
  { path: "/review", audience: "reviewer", job: "See what this release needs before it can be approved.", workspace: "review_console", state: "working" },
  { path: "/review/release", audience: "reviewer", job: "Find the largest blocker, its owner, and record an allowed decision.", workspace: "review_console", state: "working", evidence: "§7.1: opens on release scope, environment, commit and evidence date, then blockers that need action rather than a percentage complete." },
  { path: "/review/status", audience: "reviewer", job: "Read measured service health, versions and the active policy registry.", workspace: "review_console", state: "working", evidence: "§1.1: this is the secondary product-status location where honest capability notices belong." },
  { path: "/review/clinical", audience: "reviewer", job: "Review the clinical rules and the copy they produce.", workspace: "review_console", state: "working" },
  { path: "/review/safety", audience: "reviewer", job: "Review the safety engine's rules and what each one fires on.", workspace: "review_console", state: "working" },
  { path: "/review/bls", audience: "reviewer", job: "Review the bilateral-stimulation conditions and oversight.", workspace: "review_console", state: "working" },
  { path: "/review/autonomous", audience: "reviewer", job: "Review what the product does without a clinician in the loop.", workspace: "review_console", state: "working" },
  { path: "/review/testing", audience: "reviewer", job: "See what is tested, what is not, and what the last run said.", workspace: "review_console", state: "working" },
  { path: "/review/research", audience: "reviewer", job: "Read the research position and its limits.", workspace: "review_console", state: "working" },
  { path: "/review/fairness", audience: "reviewer", job: "See whether access is even across groups, and what was not shown.", workspace: "review_console", state: "working", evidence: "Handoff 07 §4.4's nine panels over the real population: the question, representation, the rate with its numerator and denominator, missingness kept apart, the error panel's own gap stated rather than filled, a predeclared intersection refused for sample size, every withheld value with the control that withheld it, the six decisions with what each does to the output, and the review trail. Rows are in a declared order and carry no tone, per §4.4's prohibition on ranking or grading groups." },
  { path: "/review/models", audience: "reviewer", job: "See what a model must declare before it may run, and where a shadow output may go.", workspace: "review_console", state: "working", evidence: "Handoff 07 §3.8's registry shell. The registry is empty because this build runs no model, and the screen says so rather than rendering a blank. The eleven required fields, the exhaustive shadow-destination lists and the four release reviews are the conditions a first model would meet; §7's prohibition on unregistered model execution is the predicate a runner would call." },
  { path: "/review/performance", audience: "reviewer", job: "See what each surface is allowed to take, why, and what it took when it was last measured.", workspace: "review_console", state: "working", evidence: "Handoff 06 §31.2's wave 6. Five budget classes named for who is waiting and why rather than for how much work the server does: grounding gets the tightest number in the product and carries the least data, because somebody opens it because they are activated. Measured by scripts/perfcheck.ts against a running production build, 25 samples per surface at the 95th percentile, with the conditions of the run on the screen. A redirect fails the gate rather than being recorded as the fastest screen in the product." },
  { path: "/review/security", audience: "reviewer", job: "Check that every protected route enforces the permission sequence, and see where it cannot be shown.", workspace: "review_console", state: "working", evidence: "Handoff 06 §31.5's Security acceptance requirement, which asks for a proof about EVERY protected endpoint rather than a capability. All 108 protected routes in the register are checked against §30.6's eight steps, scoped to the steps each route owes: a queue owes no person-to-care relationship, a person's chart owes no small-cell suppression. Evidence is read from the route, its layout chain, and the bodies of the symbols it imports and uses. A step with no single named mechanism is reported as proven by attack and names the boundary tests, rather than being given a marker that would turn its absence into a green cell." },
  { path: "/review/telemetry", audience: "reviewer", job: "See what this product measures about itself, and what it cannot measure about anybody.", workspace: "review_console", state: "working", evidence: "Handoff 06 §31.7's nine signals, each with its purpose, its privacy rule and the fields it may carry. Every field has a KIND whose shape a sentence cannot satisfy, which is what makes §31.3's requirement — that telemetry prove the screen can be used without capturing sensitive free text — a checkable claim rather than a promise. Counts include the zeros and say which kind of zero: a signal nothing records is a different finding from a signal nobody has triggered. The four operational-review questions are answered from the recorded signals, or reported as unanswerable." },
  { path: "/review/lineage", audience: "reviewer", job: "Trace a displayed figure back to the records it came from.", workspace: "review_console", state: "working" },
  { path: "/review/planning", audience: "reviewer", job: "Review the planning signals and their eight-state machine.", workspace: "review_console", state: "working" },
  { path: "/review/planning/[id]", audience: "reviewer", job: "Decide one planning signal.", workspace: "review_console", state: "working" },
  { path: "/review/access", audience: "reviewer", job: "See and grant review access.", workspace: "review_console", state: "working" },
  { path: "/review/audit", audience: "reviewer", job: "Read the governed event log.", workspace: "review_console", state: "working", evidence: "§7.1: an audit timeline is not named Decisions unless it supports finding and recording decisions. This one is named Audit." },
  { path: "/review/demo-data", audience: "reviewer", job: "Confirm the fabricated population is what it claims to be.", workspace: "review_console", state: "working" },

  // ---- Demo operations ----------------------------------------------------
  { path: "/demo", audience: "demo_admin", job: "Reach the demonstration environment as a chosen role.", workspace: "demo_ops", state: "working" },
  { path: "/demo/[path]", audience: "demo_admin", job: "Enter the environment at a specific screen.", workspace: "demo_ops", state: "working" },
  { path: "/demo/scenarios", audience: "demo_admin", job: "Run a named walkthrough, and see whether the environment can serve it.", workspace: "demo_ops", state: "working", evidence: "Package 4. Launcher and progress guide over the scenario registry; refuses to start on a failed preflight or while another walkthrough holds the environment." },
  { path: "/admin/pilot", audience: "demo_admin", job: "Read what pilot participants entered.", workspace: "demo_ops", state: "working", evidence: "The pilot's own answers — fit questions, baseline measures, check-ins and what the rules decided — for the one population that is real. Counts of people rather than rates, because at a cap of twenty-five a percentage reads as a finding. No control here routes anybody or changes a gate." },
  { path: "/admin/demo", audience: "demo_admin", job: "See environment health and reset it safely.", workspace: "demo_ops", state: "working", evidence: "§7.3: leads with environment health and failed preflight, states reset scope before the control, and refuses a reset during another walkthrough unless deliberately interrupted." },
];

// ---------------------------------------------------------------------------
// What the source documents got wrong about this repository
// ---------------------------------------------------------------------------

/**
 * Corrections to the carry-forward registers in handoff 09 §12 and the Astra
 * review §11.
 *
 * Both source documents are explicit that their registers "are not fresh
 * assertions that these items remain open" and that an engineer "must
 * reconcile later commits and CI before assigning work". This is that
 * reconciliation, and it exists as code so that the next reader gets it from
 * the same place they get the route list rather than from a paragraph in a PDF.
 */
export interface Reconciliation {
  /** What the source documents say. */
  claim: string;
  /** What is actually true at REGISTER_COMMIT. */
  actual: string;
  /** Where to look. */
  evidence: string;
}

export const RECONCILED: Reconciliation[] = [
  {
    claim: "Clinical Intelligence Expansion: not started (handoff index).",
    actual: "All five expansion handoffs are complete: Return-to-Life Goals, Treatment Response Fingerprint, Between-Visit Care Command Center, Personalized Recovery Trajectory, and Therapeutic Load & Readiness.",
    evidence: "src/lib/clinical/return-to-life.ts, response-fingerprint.ts, attention-signals.ts, recovery-trajectory.ts, therapeutic-load.ts, and their test files.",
  },
  {
    claim: "Therapeutic Load and Readiness: deferred feature (handoff 09 §12, Astra §11).",
    actual: "Built to expansion handoff 05 and reachable at /clinician/member/[id]/load. Handoff 09 §10.1's requirement that it 'may plug into the clinician task-provider contract after its own clinical review' is met on the contract side — the provider passes the published conformance check — but the clinical review itself has not happened, so the provider is HELD: it returns nothing and no Therapeutic Load state reaches a clinician's queue. The screen is unaffected, which is the point — a clinician may choose to read it; the product does not tell them to. The hold lifts when a review is recorded with a name and a place the evidence lives, and it is reported on /review/status.",
    evidence: "src/lib/clinical/clinical-review-gate.ts, attention-providers/therapeutic-load.ts, tests/delivery-sequence.test.ts.",
  },
  {
    claim: "Personalized Recovery Trajectory: not started (handoff index).",
    actual: "Built to expansion handoff 04 and reachable at /clinician/member/[id]/trajectory.",
    evidence: "src/lib/clinical/recovery-trajectory.ts, tests/recovery-trajectory-*.test.ts.",
  },
  {
    claim: "ADR 0012 (AI Gateway): proposed, not implemented (ADR index).",
    actual: "Implemented. Thirteen registered tasks route through the gateway with task versions, PHI policy and fallbacks.",
    evidence: "src/lib/ai-gateway/, and the registerTask call sites.",
  },
  {
    claim: "Messages and Schedule absence: confirmed at baseline (handoff 09 §12).",
    actual: "Still true. All five capability-absent routes were re-read for this register and each still states its absence in words.",
    evidence: "The `unavailable` entries above; asserted by tests/route-register.test.ts.",
  },
];

// ---------------------------------------------------------------------------
// Conflicts this register found and did not fix
// ---------------------------------------------------------------------------

/**
 * Routes that primary navigation promotes today and that handoff 09 §1.1 says
 * it must not.
 *
 * PACKAGE 0 RECORDS THESE AND CHANGES NOTHING. Its exit evidence is "no product
 * behavior change; current tests and build green", and a register that quietly
 * repaired what it found would be a register nobody could use to size the work.
 *
 * The guard in tests/route-register.test.ts asserts that this list matches the
 * rails EXACTLY — so a new dead-end promotion breaks the build, and clearing
 * one of these requires deleting its entry here in the same commit.
 */
export interface PromotedUnavailable {
  path: string;
  /** Which navigation promotes it. */
  promotedBy: string;
  /** Which package closes it. */
  due: string;
}

export const PROMOTED_UNAVAILABLE: PromotedUnavailable[] = [
  // EMPTY, AS OF HANDOFF 09 PACKAGE 2, and the empty list is the point rather
  // than a tidying-up.
  //
  // Package 0 recorded one dead-end promotion and could not fix it: its exit
  // evidence was "no product behavior change". Package 2 is where §1.1 gets
  // applied, and widening the guard to read the clinician layer nav as well as
  // the rails turned that one violation into five — Handoffs, Messages,
  // Referrals and Schedule were all promoted from ClinicianPage's CONSOLE_SCREENS,
  // and only the rails had been checked.
  //
  // All five are gone from navigation. The routes remain, still saying what is
  // missing, reachable by URL and listed on /review/status.
  //
  // The guard now asserts this list is EXACTLY what navigation promotes, which
  // means empty here requires empty there. A new dead-end promotion fails the
  // build rather than joining a list somebody stops reading.
];

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const BY_PATH = new Map(ROUTE_REGISTER.map((r) => [r.path, r]));

export function routeEntry(path: string): RouteEntry | undefined {
  return BY_PATH.get(path);
}

export function byState(state: CapabilityState): RouteEntry[] {
  return ROUTE_REGISTER.filter((r) => r.state === state);
}

export function byAudience(audience: Audience): RouteEntry[] {
  return ROUTE_REGISTER.filter((r) => r.audience === audience);
}

export function byWorkspace(workspace: Workspace): RouteEntry[] {
  return ROUTE_REGISTER.filter((r) => r.workspace === workspace);
}

/** Counts per state, for the review console's own panel. */
export function stateCounts(): Record<CapabilityState, number> {
  const counts: Record<CapabilityState, number> = {
    working: 0, unavailable: 0, proposed: 0, externally_blocked: 0, redirect: 0,
  };
  for (const r of ROUTE_REGISTER) counts[r.state]++;
  return counts;
}

export const STATE_LABEL: Record<CapabilityState, string> = {
  working: "Working",
  unavailable: "Capability absent",
  proposed: "Proposed, no route",
  externally_blocked: "Blocked outside this codebase",
  redirect: "Redirect to the canonical address",
};

export const STATE_NOTE: Record<CapabilityState, string> = {
  working: "The route does the job named against it.",
  unavailable: "The route exists and says, in words, that the capability behind it does not. Reachable deliberately; never promoted in primary navigation.",
  proposed: "Named in a governing document, with no route. Recorded so the gap appears in the same list as everything else.",
  externally_blocked: "Held by something outside this codebase — a cutover gate, counsel, or a deployment decision.",
  redirect: "Exists only to send the caller to the canonical address they typed a shorter version of.",
};
