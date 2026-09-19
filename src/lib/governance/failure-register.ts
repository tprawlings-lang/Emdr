// What has actually been proven to survive failure (17 September handoff, P6).
//
//   "P6 Prove failure recovery — Concurrency, stale evidence, permissions,
//   reset, uncertain writes — Failure-injection evidence."
//
// THE ACCEPTANCE IS THE WORD "EVIDENCE", and it is the reason this file exists
// rather than a paragraph saying the system handles errors. The handoff lists
// twenty-odd failure scenarios and then says, in as many words: "These rows are
// proposed test cases. They are not claims that each defect exists today." The
// only useful answer to that is a row-by-row statement of which ones something
// actually injects, and which ones nobody has tried.
//
// A TEST FILE IS NOT EVIDENCE OF A SCENARIO. The work register learned this
// the expensive way: a list that only checks "does a file with this name exist"
// passes forever while the thing it names quietly stops being true. So the rule
// here is stronger — a row claiming `proven` must name a test that CONTAINS
// THIS ROW'S ID. The link is two-way and mechanical: from the scenario to the
// injection, and from the injection back to the scenario it is evidence for.
// Deleting the assertion breaks the register.
//
// AND `gap` IS A FIRST-CLASS STATE, written down rather than omitted. A
// register that only listed what works would be a marketing page for the test
// suite. The gaps are the P6 worklist, and they are the reason to have read
// this far.

export type FailureArea =
  | "concurrency"
  | "stale_evidence"
  | "permissions"
  | "reset"
  | "uncertain_writes"
  | "tenancy"
  | "presentation"
  | "safety";

export const AREA_LABEL: Record<FailureArea, string> = {
  concurrency: "Two people act",
  stale_evidence: "Evidence moved under the decision",
  permissions: "Authority changed after the page loaded",
  reset: "The environment was rebuilt underneath a tab",
  uncertain_writes: "The answer was lost, not the write",
  tenancy: "A boundary between organizations",
  presentation: "A failure the screen has to name honestly",
  safety: "A failure with a clinical consequence",
};

export type FailureState =
  /** Something injects this failure and asserts the required behaviour. */
  | "proven"
  /** Nothing injects it. This is the worklist. */
  | "gap"
  /** Deliberately not covered here, with the reason on the entry. */
  | "held";

export interface FailureScenario {
  id: string;
  /** The handoff's row, kept in its words so this can be read against it. */
  scenario: string;
  /** The handoff's required behaviour. */
  required: string;
  area: FailureArea;
  state: FailureState;
  /** Test files that INJECT this failure. Each must name this row's id. */
  injections: string[];
  /** Why, for `held`; what is missing, for `gap`. */
  note?: string;
}

export const FAILURE_REGISTER: FailureScenario[] = [
  // ── Uncertain writes ───────────────────────────────────────────────────
  {
    id: "uncertain.retry-returns-existing-result",
    scenario: "A committed action whose response was lost is retried.",
    required:
      "Retry with the same idempotency key returns the existing command result. Do not duplicate " +
      "a note, approval, contact, access decision, or handoff.",
    area: "uncertain_writes",
    state: "proven",
    injections: ["tests/command-idempotency.test.ts", "tests/e2e/contact-attempts.spec.ts"],
    note:
      "TWO INJECTIONS, AND THE SECOND EXISTS BECAUSE THE FIRST FIX WAS WRONG. The node tests prove " +
      "the ledger; the browser spec proves the KEY, which broke twice and both times only a browser " +
      "showed it — the queue built its key from the row rather than the press, so a clinician who " +
      "attempted contact twice with the same words had the second press replay the first result " +
      "under a confirmation that read exactly like a fresh one. " +
      "The key now has a table and the reservation is written before the work, so the race is on " +
      "a primary key rather than in application code. Only a confirmed outcome is replayed — a " +
      "refusal or a conflict releases the key, because those are answers about a world that " +
      "moves, and a replayed refusal would pin somebody to a no that is no longer true. A key " +
      "belonging to a different intent, target or actor is REFUSED rather than answered with the " +
      "other command's result: a duplicate record is bad, a record of the wrong action is worse.",
  },
  {
    id: "uncertain.indeterminate-invites-reconcile-not-retry",
    scenario: "The request left and no answer came back.",
    required:
      "Distinguish indeterminate from failed, carry the key to reconcile by, and do not invite " +
      "a blind retry.",
    area: "uncertain_writes",
    state: "proven",
    injections: ["tests/command-idempotency.test.ts"],
    note:
      "THE UNCERTAINTY IS INJECTED BY A SECOND ATTEMPT ARRIVING WHILE THE FIRST IS STILL RUNNING, " +
      "not by severing a socket — that is the shape this product can actually stage, and it " +
      "produces the same condition: the server cannot yet say whether the write landed. The test " +
      "asserts all three required behaviours on it — the outcome is indeterminate rather than " +
      "failed, it carries the key to reconcile by, and the task state the surface renders offers " +
      "no retry button. What is still not injected is a transport-level loss mid-response.",
  },

  // ── Environment resets ─────────────────────────────────────────────────
  {
    id: "reset.command-from-a-pre-reset-tab",
    scenario: "A tab opened before a synthetic reset submits a command after it.",
    required:
      "Reject the command and give the user a clear refresh path. Do not let idempotency keys " +
      "cross reset generations.",
    area: "reset",
    state: "proven",
    injections: ["tests/environment-generation.test.ts"],
    note:
      "A generation is established per environment and rotated INSIDE the reset's transaction, so " +
      "there is no window where the data is new and the generation still says old. A command " +
      "carrying an older one is refused before it reserves its key — the key is the same string " +
      "on both sides of a rebuild by construction, so a stale tab could otherwise take the key a " +
      "live one is about to need. The refusal says nothing was written and to reload, because a " +
      "refusal with no way forward is worse than the stale action it prevented. " +
      "ONE OF THE TESTS IS A SOURCE CHECK, deliberately: the guard only fires on a command that " +
      "carries a generation, so a surface that stops sending one would disable it while every " +
      "behavioural test kept passing.",
  },

  // ── Stale evidence ─────────────────────────────────────────────────────
  {
    id: "stale.clinician-acts-on-moved-evidence",
    scenario: "A clinician decides on evidence that changed while they were reading it.",
    required: "Detect the version mismatch and show the relevant change.",
    area: "stale_evidence",
    state: "proven",
    injections: ["tests/stale-evidence.test.ts"],
    note:
      "DETECTION WAS BUILT AND THE SHOWING WAS A VERSION STRING. A reader told 'the queue now " +
      "holds open@2026-09-12T08:00:00Z' has the evidence that something moved and none of what " +
      "they need, so the honest response to the warning is to press through it — which is the " +
      "behaviour a version check exists to prevent. A conflict now says which of the two things " +
      "happened, because they mean opposite things: somebody else acting is a question about " +
      "coordination, and new evidence arriving is a question about the decision itself. For " +
      "alerts it separates one closed by somebody else from one raised that the reader has " +
      "not seen.",
  },
  {
    id: "stale.correction-changes-a-trajectory",
    scenario: "A correction to an earlier observation changes an interpretation already shown.",
    required: "Preserve the old version and explain the new interpretation.",
    area: "stale_evidence",
    state: "proven",
    injections: ["tests/stale-evidence.test.ts"],
    note:
      "THE ONE THE OBVIOUS IMPLEMENTATION GETS WRONG. A correction to a March observation recorded " +
      "in September occurs BEFORE a review made in June, so a staleness check comparing " +
      "occurrence times would leave that review reading current over a record that changed " +
      "underneath it. The handoff's time model is the fix — when it happened and when we learned " +
      "are different columns — and the injection puts the two stamps on opposite sides of every " +
      "other row so only the right column can pass. The earlier review is not rewritten: it " +
      "stands as what was decided, with the currency verdict computed beside it.",
  },
  {
    id: "stale.answer-cites-corrected-evidence",
    scenario: "A generated answer cites evidence that has since been corrected.",
    required: "Mark it stale or regenerate under an explicit policy.",
    area: "stale_evidence",
    state: "proven",
    injections: ["tests/stale-evidence.test.ts"],
    note:
      "THE POLICY IS REGENERATE, and it is enforced by there being nowhere to put an answer: no " +
      "summary or retrieved answer is written to a table, so nobody can be served one that cites " +
      "evidence corrected since. The single generated artefact that IS durable is approved " +
      "clinical memory, and a corrected source supersedes the item rather than editing it while " +
      "retrieval reads approved items only. Two of these assertions are source checks, because " +
      "the property is an absence: a behavioural test can show today's answer matches today's " +
      "record, but not that no code path stores one — and storing one is the change that breaks it.",
  },

  // ── Concurrency and ownership ──────────────────────────────────────────
  {
    id: "concurrency.two-clinicians-one-row",
    scenario: "Two clinicians act on the same queue row.",
    required: "Commit once or return a named conflict. Do not silently let the last write win.",
    area: "concurrency",
    state: "proven",
    injections: ["tests/e2e/queue-concurrency.spec.ts"],
    note:
      "TWO BROWSER CONTEXTS, ONE ROW, IN A REAL BROWSER. The second reader acts first; the first " +
      "then presses their own button holding the older version and is told, above the list rather " +
      "than inside a row that has since unmounted. The same spec also presses the button with " +
      "nothing changed and expects it to work — arming a version check that rejects every " +
      "legitimate action would be worse than the defect it fixes.",
  },
  {
    id: "concurrency.transfer-proposal-is-not-a-transfer",
    scenario: "Responsibility is proposed to somebody who has not accepted it.",
    required:
      "A transfer proposal must not transfer responsibility. Test recipient acceptance, decline, " +
      "proposer cancellation, role loss, scope loss, overlapping proposals, failed notification, " +
      "and proposer unavailability.",
    area: "concurrency",
    state: "gap",
    injections: [],
    note: "Eight named sub-cases. None is injected.",
  },

  // ── Permissions changing under an open page ────────────────────────────
  {
    id: "permissions.consent-withdrawn-while-open",
    scenario: "A member withdraws consent while a clinician has their page open.",
    required: "Revalidate reads and writes, and remove newly forbidden content.",
    area: "permissions",
    state: "proven",
    injections: ["tests/permission-change.test.ts"],
    note:
      "Withdrawal is injected against a live gate chain: the next read fails the consent step and " +
      "sends the member back to consent rather than to a dead end. THE HALF THAT MATTERS MOST IS " +
      "THE ONE THAT MUST NOT CHANGE — grounding stays open, and so do the consent and account " +
      "pages, because a chain that read withdrawal as 'this person may no longer be here' would " +
      "take grounding away at the exact moment somebody withdrew, and hide from them the record " +
      "of the decision they had just made.",
  },
  {
    id: "permissions.flag-changes-after-page-load",
    scenario: "A capability is turned off after the page rendered.",
    required: "Revalidate at command time and show the new restriction.",
    area: "permissions",
    state: "proven",
    injections: ["tests/permission-change.test.ts"],
    note:
      "TWO FINDINGS RATHER THAN ONE FIX. A runtime flag in this build gates a surface and never a " +
      "write — Appendix B's rule — which is why a flag flipped mid-session cannot strand a " +
      "command; that rule is now enforced by a guard instead of documented, because the first " +
      "person to add a flag over a write would have no reason to know it exists. And the " +
      "authority that CAN change mid-session, the actor's role, is re-resolved per command: the " +
      "redirect it produces is now rethrown rather than swallowed by the catch-all, which had " +
      "been turning a revoked role into 'Steady could not confirm this' — telling somebody their " +
      "write might have landed when what happened was that they were signed out.",
  },
  {
    id: "permissions.browser-back-restores-restricted-content",
    scenario: "Somebody presses back after access was removed or a session ended.",
    required: "Test browser cache and session boundaries.",
    area: "permissions",
    state: "proven",
    injections: ["tests/e2e/session-boundary.spec.ts"],
    note:
      "IN A BROWSER, BECAUSE NOTHING ELSE CAN ANSWER IT. Every other check asks what the server " +
      "sends; this asks what the browser KEPT. It passes today on a framework default, which is " +
      "the reason to pin it: the spec asserts the no-store header directly as well as the " +
      "behaviour, so a config change that removed it fails here rather than on a shared computer.",
  },

  // ── Tenancy ────────────────────────────────────────────────────────────
  {
    id: "tenancy.suggestion-crosses-scope",
    scenario: "A search suggestion or a cached answer crosses an organization boundary.",
    required: "Prevent it at the server and in cache keys.",
    area: "tenancy",
    state: "proven",
    injections: ["tests/partial-and-scope.test.ts"],
    note:
      "The server-side half is attacked by the boundary suites. THE CACHE HALF IS THE ONE THAT " +
      "FAILS SILENTLY — a key missing an input serves one person's assembled drawer to a reader " +
      "looking at somebody else, and nothing about the answer looks wrong. Each input is removed " +
      "in turn and the key must move; the unchanged inputs must still collide, or the check would " +
      "pass on a key that was simply random.",
  },
  {
    id: "tenancy.several-queries-infer-a-small-group",
    scenario: "A sequence of differently filtered queries narrows to a group too small to report.",
    required: "Review complementary suppression and differencing controls.",
    area: "tenancy",
    state: "proven",
    injections: ["tests/partial-and-scope.test.ts"],
    note:
      "DIFFERENCING IS NOT DEFEATED BY A PER-QUERY THRESHOLD: two permitted queries whose " +
      "difference is one person each pass it. What bounds it here is that there is no query " +
      "builder — an analyst chooses from a fixed set of versioned cohort definitions and cannot " +
      "compose a new one, so the set of available differences is finite, enumerable and " +
      "reviewable rather than open. That is the control, and it is a property of the surface " +
      "rather than a filter, so it is asserted where adding a free-text filter would break it.",
  },

  // ── Presentation of failure ────────────────────────────────────────────
  {
    id: "presentation.provider-fails-and-queue-looks-empty",
    scenario: "A source fails and a screen that reads it shows nothing.",
    required: "Show incomplete coverage, never a reassuring zero.",
    area: "presentation",
    state: "proven",
    injections: ["tests/partial-and-scope.test.ts"],
    note:
      "THE COVERAGE NOTICE WAS RIGHT AND THE HEADLINE WAS NOT. A queue that read nothing still " +
      "said '0 items need review' above a caution box explaining that some sources were " +
      "unreadable — a correction to a claim that should not have been made, under the number a " +
      "clinician actually glances at. The count now states its own denominator, and at zero says " +
      "an empty queue is not the same as no work. A complete read still says the plain thing: a " +
      "headline that hedged every time would teach people to ignore the hedge.",
  },
  {
    id: "presentation.export-filter-changes-during-generation",
    scenario: "The filter changes between the screen being reviewed and the file being produced.",
    required: "Bind the export to the reviewed filter snapshot.",
    area: "presentation",
    state: "proven",
    injections: ["tests/partial-and-scope.test.ts"],
    note:
      "THE INJECTION HAS TO LAND MID-FLIGHT, and mutating the caller's object afterwards proves " +
      "nothing. A timer cannot do it either: the database is synchronous behind promises, so the " +
      "whole export resolves on the microtask queue. So the filter WIDENS ON BEING READ — the " +
      "first read returns what the screen showed, every read after it returns something broader. " +
      "A hash taken at entry binds the file to the reviewed filter; moving that one line later " +
      "fails the test.",
  },
  {
    id: "presentation.unassigned-work-accumulates",
    scenario: "Work nobody owns builds up unnoticed.",
    required: "Display ownership debt and use an approved escalation rule.",
    area: "presentation",
    state: "gap",
    injections: [],
    note:
      "HALF OF THIS IS A DECISION, NOT A BUILD. Ownership is already a first-class state on every " +
      "queue row and null renders as unassigned, so displaying the debt — how much is unowned and " +
      "how long the oldest has been — is ordinary work. The escalation rule is not: who work " +
      "falls to when nobody claims it, and after how long, is an operational decision this " +
      "codebase must not invent. The handoff says as much about the neighbouring case: 'any " +
      "fallback assignment policy needs an operational decision.' Left open rather than closed " +
      "with a default nobody chose.",
  },

  // ── Safety-consequential ───────────────────────────────────────────────
  {
    id: "safety.draft-opens-under-the-wrong-patient",
    scenario: "A draft is opened, or restored, against a different person than it was written for.",
    required: "Persist identity context and validate the target before saving.",
    area: "safety",
    state: "proven",
    injections: ["tests/safety-failures.test.ts"],
    note:
      "A REAL GAP, FOUND BY WRITING THE INJECTION. A draft is found by its own id, so the body " +
      "landed on the note it came from whatever the form said — but the form also carried a " +
      "person, and nothing checked that the two agreed. A clinician with two records open could " +
      "submit one person's words against another person's id, and the redirect, the confirmation " +
      "and the breadcrumb would all name the wrong person over a note belonging to the right one. " +
      "Not a disclosure, since both are in one tenant: a clinician being told they wrote " +
      "something they did not, which is harder to notice.",
  },
  {
    id: "safety.two-people-share-a-display-name",
    scenario: "Two people in one caseload render identically.",
    required: "Use an approved secondary identifier with minimum exposure.",
    area: "safety",
    state: "proven",
    injections: ["tests/safety-failures.test.ts"],
    note:
      "NOT HYPOTHETICAL: the fabricated population contains four people with one name and three " +
      "with another, because the generator draws from a list. MINIMUM EXPOSURE IS THE HARD HALF — " +
      "putting a record number beside every name solves the collision by printing an identifier " +
      "for everybody, including the majority whose names are already unique, which is a standing " +
      "disclosure to anybody walking past the screen. So the mark appears only on rows that " +
      "collide within the list being shown, and it is a slice of the record's own identifier " +
      "rather than a date of birth or an initial: a fact about the row, meaningless outside " +
      "Steady, and exactly as good at telling two rows apart.",
  },
  {
    id: "safety.shortcut-fires-inside-a-note-editor",
    scenario: "A keyboard shortcut fires while somebody is typing a note.",
    required: "Scope shortcuts and avoid destructive single-key commands.",
    area: "safety",
    state: "proven",
    injections: ["tests/safety-failures.test.ts"],
    note:
      "THE DRAWER CONTAINS A NOTE FIELD AND ESCAPE CLOSED IT FROM ANYWHERE, so a clinician " +
      "half-way through writing what they did about a safety signal lost it to a key people press " +
      "to mean 'get rid of the autocomplete'. The keystroke costs nothing anywhere else in the " +
      "drawer, which is why it went unnoticed: the one place it costs something is the one place " +
      "there is something to lose. It is scoped to non-editing focus now, and still closes from " +
      "everywhere else — a drawer Escape could not dismiss would be a worse keyboard trap than " +
      "the one this fixes. A walk over the components keeps the second half true: no single " +
      "letter triggers anything destructive.",
  },
  {
    id: "safety.retrieved-material-carries-instructions",
    scenario: "Retrieved or member-supplied text contains instructions aimed at the system.",
    required: "Treat source text as data, never as permission or as an executable instruction.",
    area: "safety",
    state: "proven",
    injections: ["tests/safety-failures.test.ts"],
    note:
      "THE STRONGEST FORM OF THIS GUARANTEE IS AN ABSENCE. A transcript, a note and a retrieved " +
      "memory item are all text somebody else wrote, and the answer built from them is assembled " +
      "by a deterministic rules engine — there is no model in the path to be instructed, because " +
      "no key is configured and the gateway says so. A prompt-injection defence that depended on " +
      "filtering would be weaker than the one that exists. The output guard for the day one IS " +
      "configured checks what was produced rather than trusting the producer, which is the same " +
      "discipline the summary validator uses.",
  },
  {
    id: "safety.notification-shows-a-name-on-a-lock-screen",
    scenario: "A notification renders a patient's name where anybody holding the phone can read it.",
    required: "Apply an approved minimum-content notification policy.",
    area: "safety",
    state: "held",
    injections: [],
    note:
      "There is no notification delivery path in this build — the handoff's own decision list " +
      "keeps messaging held until its activation gate passes, and the product says in as many " +
      "words that it does not notify anybody. A test injecting a lock-screen notification would " +
      "be testing a capability that does not exist, and passing it would be evidence of nothing. " +
      "This becomes a gap the day delivery is built, not before.",
  },
  {
    id: "safety.real-information-enters-a-synthetic-environment",
    scenario: "Real person information is found in a fabricated-data environment.",
    required: "Use incident handling. Do not solve it by changing the banner.",
    area: "safety",
    state: "gap",
    injections: [],
    note:
      "The identity scan runs over the demo data and is tested, and it is what would FIND this. " +
      "What is untested is what happens next: finding real information is a stop condition with " +
      "an incident path, and nothing exercises the path.",
  },
  {
    id: "safety.visual-change-hides-a-stop-control",
    scenario: "A layout change moves or hides a control somebody needs to stop.",
    required: "Reject it through human-factors review.",
    area: "safety",
    state: "held",
    injections: [],
    note:
      "The committed visual baseline catches the CHANGE — a moved stop control is a diff, and the " +
      "suite fails on it. The required behaviour is a human review decision, which is P7's " +
      "acceptance package rather than an injection: a test cannot reject a design.",
  },
];

export interface FailureCoverage {
  total: number;
  proven: number;
  gaps: number;
  held: number;
  /** The worklist, in register order. */
  openIds: string[];
}

/** What P6 has actually proven, counted rather than described. */
export function failureCoverage(
  register: readonly FailureScenario[] = FAILURE_REGISTER
): FailureCoverage {
  return {
    total: register.length,
    proven: register.filter((e) => e.state === "proven").length,
    gaps: register.filter((e) => e.state === "gap").length,
    held: register.filter((e) => e.state === "held").length,
    openIds: register.filter((e) => e.state === "gap").map((e) => e.id),
  };
}
