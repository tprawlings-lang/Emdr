// The experience contracts (handoff 09 Package 1).
//
// Package 1's exit evidence is one line: "Contract tests prove no raw SQL, no
// client-side priority, no role inference from the browser."
//
// Those three are the last three tests in this file, and they are checks on the
// SHAPE OF THE LAYER rather than on any function's output — which is the only
// way they can hold. A test that calls one adapter and finds no SQL proves
// nothing about the adapter somebody adds next month; a test that reads every
// file in src/lib/experience and fails on a query does.
//
// Everything above them checks the individual contracts, and each one exists
// because §9's reason column names a failure:
//
//   "A browser-supplied role or tenant is not command authority."
//   "An envelope carrying submitted authority fields invites trusting them."
//   "A failed network acknowledgement is not proof that no write occurred."
//   "UI progress must never become clinical state."
//   "Efficient return should not leak data or change evidence."
//   "A route file alone does not establish usable functionality."
//   "Structural impossibility beats prohibition."
//
// The hardest of those to test is the last, and §3 says how: an allow-list, at
// any depth, failing the build when a field arrives that nobody decided on.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  CAPABILITIES, capabilitiesFor, experienceContextFor, toClient, can, whyNot,

} from "../src/lib/experience/context";
import {
  navigationFor, activeDestination, isActive, declaredDestinations,
  destinationIsRegistered, personLocal,
} from "../src/lib/experience/navigation";
import {
  resolveCommand, commandKey, confirmed, rejected, stale, unavailable,
  indeterminate, mayClaimChange, mayRetryDirectly, CommandError,
  OUTCOME_LABEL, OUTCOME_NOTE, type CommandOutcome,
} from "../src/lib/experience/command";
import {
  idle, editing, submitting, advance, mayClaimSaved, TASK_STATES,
  TASK_LABEL, NEVER_CONFIRMS,
} from "../src/lib/experience/task-state";
import {
  emptyViewState, forTenant, withFilter, fromSearchParams, summary, reset,
  isDefault, VIEW_FILTERS, FILTER_VALUES, ViewStateError,
} from "../src/lib/experience/view-state";
import {
  PANEL_MODES, focusBehaviour, presentationFor, assertPanel, PanelContractError,
} from "../src/lib/experience/evidence-panel";
import {
  MEMBER_ALLOWED_FIELDS, MEMBER_FORBIDDEN_FIELDS, violations,
  assertMemberProjection, crossesBoundary, MemberBoundaryError,
  MEMBER_SCORE_EXCEPTION, exceptionFullyMet,
} from "../src/lib/experience/member-projection";
import {
  assertRoleHome, fullCoverage, partialCoverage, coverageNote, RoleHomeError,
} from "../src/lib/experience/role-home";
import {
  supportDock, activitySupportDock, SUPPORT_ENTRIES, ACTIVITY_CONTROLS,
} from "../src/lib/experience/support-dock";
import { byState, routeEntry } from "../src/lib/app/route-register";

const root = process.cwd();
const EXPERIENCE_DIR = path.join(root, "src/lib/experience");

function experienceFiles(): Array<{ name: string; src: string }> {
  return fs.readdirSync(EXPERIENCE_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(EXPERIENCE_DIR, f), "utf8") }));
}

/** Comments discuss SQL, roles and priority at length. Only code is checked. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

const clinician = experienceContextFor({
  id: "clin-1", email: "c@example.test", name: "Dr X", role: "clinician", tenantId: "t-1",
});
const member = experienceContextFor({
  id: "mem-1", email: "m@example.test", name: "Ada", role: "member", tenantId: "t-1",
});

// ---------------------------------------------------------------------------
// ExperienceContext
// ---------------------------------------------------------------------------

test("a context can only be made from an authenticated user", () => {
  // §9: "A browser-supplied role or tenant is not command authority." The only
  // constructor takes a SessionUser, which only src/lib/auth.ts produces from
  // a verified token — so there is no path from a request body to a context.
  const src = code(fs.readFileSync(path.join(EXPERIENCE_DIR, "context.ts"), "utf8"));
  const exports = [...src.matchAll(/export function (\w+)/g)].map((m) => m[1]);
  const constructors = exports.filter((n) => /^experienceContext/.test(n));
  assert.deepEqual(
    constructors, ["experienceContextFor"],
    `more than one way to construct a context: ${constructors.join(", ")}`
  );
  // And it must not accept a role, a tenant or a request.
  const signature = src.slice(src.indexOf("export function experienceContextFor"));
  const params = signature.slice(signature.indexOf("("), signature.indexOf(")") + 1);
  assert.match(params, /SessionUser/, `the constructor does not take a SessionUser: ${params}`);
  assert.ok(
    !/role|tenantId|Request|headers|searchParams/i.test(params),
    `the constructor accepts something a browser can supply: ${params}`
  );
});

test("the client view carries no tenant and no authority", () => {
  const view = toClient(clinician);
  const keys = Object.keys(view);
  for (const forbidden of ["tenantId", "personId", "capabilities", "claims"]) {
    assert.ok(!keys.includes(forbidden), `the client view carries ${forbidden}`);
  }
  // The audience IS there, for layout. The guard that it authorizes nothing is
  // "no role inference from the browser", below.
  assert.equal(view.audience, "clinician");
  assert.ok(Array.isArray(view.available));
});

test("capability state agrees with the route register", () => {
  // A capability turned on without a route behind it, or a route that works
  // with its capability off, both produce a navigation item that lies. The
  // register is the truth (Package 0); this asserts the two agree.
  const absentRoutes = new Set(byState("unavailable").map((r) => r.path));
  const pairs: Array<[string, string]> = [
    ["messageAClinician", "/app/messages"],
    // `handOverAPerson` is no longer here: the capability is built, the
    // register calls the route working, and the pair below asserts the two
    // agree in the other direction.
    ["referAPersonOut", "/clinician/referrals"],
    ["messageAMember", "/clinician/messages"],
    ["scheduleAnAppointment", "/clinician/schedule"],
  ];
  for (const [capability, route] of pairs) {
    assert.ok(absentRoutes.has(route), `${route} is no longer registered as capability-absent`);
    const ctx = route.startsWith("/app") ? member : clinician;
    assert.equal(
      can(ctx, capability as never), false,
      `${capability} is on while ${route} is registered as capability-absent`
    );
    assert.ok(
      (whyNot(ctx, capability as never) ?? "").length > 20,
      `${capability} is off with no reason a surface could show`
    );
  }
});

test("a capability nobody is offered reads as not-yours, not as not-built", () => {
  // §8.4: "not built" and "not yours" are different sentences, and a member
  // told the clinician queue does not exist would be told something false.
  const forMember = capabilitiesFor("member");
  assert.equal(forMember.reviewAttentionQueue.available, false);
  assert.match(forMember.reviewAttentionQueue.reason ?? "", /this workspace/i);
  assert.ok(
    !/does not exist|not built/i.test(forMember.reviewAttentionQueue.reason ?? ""),
    "a member is told the clinician queue does not exist, which is false"
  );
});

test("every capability is offered to somebody and has a state for everyone", () => {
  for (const c of CAPABILITIES) {
    const offered = (["member", "clinician", "organization", "payer", "reviewer", "demo_admin"] as const)
      .filter((a) => capabilitiesFor(a)[c].available || capabilitiesFor(a)[c].reason !== "Not part of this workspace.");
    assert.ok(offered.length > 0, `${c} is offered to nobody`);
  }
});

// ---------------------------------------------------------------------------
// NavigationManifest — §1.1 and §1.2
// ---------------------------------------------------------------------------

test("navigation never promotes a capability this build does not have", () => {
  // §1.1: "Omit unavailable capabilities from primary navigation entirely. A
  // navigation item is a promise." The filter is inside navigationFor and
  // cannot be turned off; this proves it.
  for (const ctx of [member, clinician]) {
    const nav = navigationFor(ctx);
    for (const d of [...nav.core, ...nav.utility]) {
      assert.ok(
        can(ctx, d.capability),
        `${ctx.audience} navigation promotes ${d.href} whose capability ${d.capability} is off`
      );
      const entry = routeEntry(d.href);
      assert.ok(entry, `${d.href} is not in the route register`);
      assert.notEqual(
        entry!.state, "unavailable",
        `${ctx.audience} navigation promotes ${d.href}, which the register records as a dead end`
      );
    }
  }
});

test("the omitted capabilities are still named, with reasons", () => {
  // §1.1's other half: "Keep an honest capability notice reachable from a
  // secondary product-status location." Dropping them from the sidebar must
  // not drop them from the product's account of itself.
  const nav = navigationFor(clinician);
  assert.ok(nav.absent.length > 0, "the clinician has absent capabilities and the manifest reports none");
  for (const a of nav.absent) {
    assert.ok(a.label.length > 0);
    assert.ok(a.reason.length > 20, `"${a.label}" is absent with no reason: "${a.reason}"`);
  }
  const labels = nav.absent.map((a) => a.label);
  // HANDOFFS IS PROMOTED NOW, not named as absent, so it left this list when
  // the capability was built. §1.1's rule cuts both ways: a navigation item is
  // a promise, and once the promise can be kept, withholding it is its own
  // dishonesty — especially here, where nothing notifies a clinician that a
  // transfer is waiting and the navigation item is the only way they will find
  // out.
  for (const expected of ["Messages", "Schedule", "Referrals"]) {
    assert.ok(labels.includes(expected), `${expected} is neither promoted nor named as absent`);
  }
});

test("no manifest is padded to reach a count", () => {
  // §1.2: "Three to five is a design target, not a requirement. Never add a
  // destination to reach a count." A padded manifest shows up as a destination
  // whose capability is another destination's — the tell of filler.
  for (const ctx of [member, clinician]) {
    const nav = navigationFor(ctx);
    assert.ok(nav.core.length >= 2, `${ctx.audience} has ${nav.core.length} destinations`);
    const hrefs = new Set(nav.core.map((d) => d.href));
    assert.equal(hrefs.size, nav.core.length, `${ctx.audience} promotes the same route twice`);
  }
  // The member's core is three after filtering, which is §4.1's own schematic.
  assert.deepEqual(
    navigationFor(member).core.map((d) => d.label),
    ["Today", "Tools", "Progress", "Care team"]
  );
  // And the clinician's is four. §5's schematic reads "Three primary
  // destinations; Messages and Schedule omitted until they exist" — three was
  // the count once Handoffs was omitted too, for the same reason. It exists
  // now, so the count moved because the product did rather than because
  // somebody wanted a fuller row: the two the schematic actually names are
  // still absent, and still say why.
  assert.deepEqual(
    navigationFor(clinician).core.map((d) => d.label),
    ["Command Center", "Patients", "Reports", "Handoffs"]
  );
});

test("opening a person adds a local region rather than replacing the shell", () => {
  // §1.5: "Never swap the entire meaning of the sidebar when a patient record
  // opens — use a local navigation region plus a labeled return control."
  const nav = navigationFor(clinician, { personId: "p-1" });
  assert.deepEqual(
    nav.core.map((d) => d.label),
    navigationFor(clinician).core.map((d) => d.label),
    "the global row changed when a person record opened"
  );
  assert.ok(nav.local, "no local region");
  assert.match(nav.local!.returnTo.label, /Back to/, "the return control is not labeled");
  assert.ok(routeEntry(nav.local!.returnTo.href), "the return control points nowhere");
  // §5's grouping: Overview, Course, Sessions, Notes, Safety.
  assert.deepEqual(
    nav.local!.items.map((i) => i.label),
    ["Overview", "Course", "Sessions", "Notes", "Safety"]
  );
});

test("a member never gets a person-record region", () => {
  assert.equal(navigationFor(member, { personId: "p-1" }).local, null);
});

test("exactly one destination is active, and it is the longest match", () => {
  // Two selected states is the same failure as none (§8.2).
  const nav = navigationFor(clinician, { personId: "p-1" });
  const active = activeDestination(nav, "/clinician/member/p-1/measures");
  assert.equal(active?.href, "/clinician/member/p-1/measures");
  assert.ok(
    !isActive(nav, "/clinician/member/p-1/measures", "/clinician/member/p-1"),
    "the parent destination is also marked active"
  );
  // A nested route under a core destination lights the core one.
  assert.equal(activeDestination(nav, "/clinician/today")?.href, "/clinician/today");
  // And a route no destination owns lights nothing.
  assert.equal(activeDestination(nav, "/clinician/population"), null);
});

test("every declared destination points at a registered route", () => {
  for (const d of declaredDestinations()) {
    assert.ok(
      destinationIsRegistered(d.href),
      `${d.label} points at ${d.href}, which the register does not know`
    );
  }
  assert.ok(personLocal("[id]"));
});

// ---------------------------------------------------------------------------
// Command input and result — §9
// ---------------------------------------------------------------------------

test("a command payload carrying authority fields is refused, not overwritten", () => {
  // §9: "An envelope carrying submitted authority fields invites trusting
  // them." Silently overwriting would work today and break the moment somebody
  // reads the payload before resolve() runs.
  for (const field of ["actorId", "actorPersonId", "tenantId", "role", "audience"]) {
    assert.throws(
      () => resolveCommand(clinician, {
        intent: "acknowledge", target: "sig-1",
        payload: { [field]: "t-2" }, idempotencyKey: "k1",
      }),
      CommandError,
      `a payload carrying ${field} was accepted`
    );
  }
});

test("the subject of a command is not an authority field", () => {
  // THIS LIST USED TO CONTAIN `personId`, AND THAT WAS A LIVE DEFECT. All three
  // row actions on the clinician's attention queue — record contact, assign,
  // complete review — pass the person the row is about in their payload,
  // because that is what the clinician clicked. So every one of them threw
  // before doing anything, and "Could not save" was the only outcome any of
  // them had ever produced. Nothing caught it: this test pinned the list and no
  // test called an action, so the two halves of the contradiction were never in
  // the same room.
  //
  // Authority is WHO IS ACTING and IN WHOSE TENANT. A client that supplies
  // either believes it can set one. The subject is WHICH PERSON the action is
  // about, and there is no way for a client not to send it.
  const resolved = resolveCommand(clinician, {
    intent: "complete_review", target: "sig-1",
    payload: { personId: "person-7", note: "called them" }, idempotencyKey: "k1",
  });
  assert.equal(resolved.payload.personId, "person-7", "the subject was stripped from the payload");
  assert.equal(resolved.actorPersonId, "clin-1", "the actor came from anywhere but the context");
  assert.equal(resolved.tenantId, "t-1");

  // And the subject is not TRUSTED either: where a command's target names a
  // record, the action takes the subject off that record and refuses a payload
  // that disagrees. Both people are in the same tenant, so this is not a
  // disclosure — it is a review recorded in the wrong chart.
  const actions = code(fs.readFileSync(path.join(root, "src/lib/clinical/shell-actions.ts"), "utf8"));
  assert.match(actions, /async function subjectFor\(/, "there is no subject resolver");
  // The comparison that makes the subject safe to accept: when the target names
  // a signal, that signal's own person wins and a payload naming somebody else
  // is refused.
  assert.match(
    actions, /signal\.personId !== claimed/,
    "the resolver does not check the payload against the record"
  );
  // Every action resolves through it — including the two that do not otherwise
  // load a signal.
  assert.equal(
    (actions.match(/subjectFor\(ctx, command\)/g) ?? []).length, 3,
    "not all three row actions resolve their subject"
  );
  // And nothing writes a care action from the raw payload any more.
  assert.ok(
    !/personId: command\.payload\.personId,/.test(actions),
    "a care action is still written from the unchecked payload"
  );
});

test("a queue row with no attention signal can still be reviewed", () => {
  // THE SECOND HALF OF THE SAME DEFECT. Only one of the three kinds of work
  // item has an attention signal behind it. An ALERT-DERIVED row is the safety
  // engine's own output — the rows carrying safety authority, and the ones a
  // clinician most needs to close — and a CASELOAD-DERIVED row has no alert at
  // all. `completeReview` began by loading a signal and giving up when there
  // was none, so "Complete review" answered "Not available here" on every
  // safety row in the queue.
  const actions = code(fs.readFileSync(path.join(root, "src/lib/clinical/shell-actions.ts"), "utf8"));
  // Matched on the CALL and its condition, not on the name: the function's own
  // definition contains the name, so a guard looking for the identifier passes
  // while nothing calls it.
  assert.match(
    actions, /if \(!subject\.signal\) \{\s*return completeReviewWithoutSignal\(/,
    "a signal-less row is not routed to the path that handles it"
  );
  // Reviewing an alert row CLOSES the alert, through the writer that carries
  // the rule — an immediate- or high-band alert closes with a documented
  // action, never an acknowledgement. A direct UPDATE here would go around it.
  assert.match(actions, /closeAlert\(/, "an alert-derived review does not close the alert");
  assert.ok(
    !/UPDATE alerts/i.test(actions),
    "the action writes the alerts table itself instead of using the closer"
  );
  // A caseload row has nothing to close, and says so rather than implying a
  // change it did not make.
  assert.match(actions, /Nothing was closed/, "a caseload review claims something closed");
});

test("assignable owners are read from role assignments, not from accounts", () => {
  // The Assign control renders only when there is somebody to assign to, and
  // the list read `users` — where a person has a row only if somebody signs in
  // as them. Every clinician in this product except the demo account is
  // deliberately a person with a role assignment and no login, so the list was
  // always empty and the control was never drawn.
  //
  // `care_manager` is the same mistake showing twice in one WHERE clause: it is
  // a care-relationship role that `users.role` cannot hold at all.
  const page = code(fs.readFileSync(
    path.join(root, "src/app/clinician/today/page.tsx"), "utf8"));
  const query = page.slice(page.indexOf("const assignees"), page.indexOf("return (", page.indexOf("const assignees")));
  assert.match(query, /FROM role_assignments/, "assignees are still read from accounts");
  assert.match(query, /JOIN persons/, "an owner with no person row would have no name");
  assert.ok(!/FROM users/.test(query), "the accounts table is still consulted for owners");
  // Scoped to the tenant, excluding the actor, and excluding an assignment that
  // has ended — an owner whose role lapsed is not an owner.
  assert.match(query, /ra\.tenant_id = \?/);
  assert.match(query, /ra\.person_id != \?/);
  assert.match(query, /effective_to IS NULL OR ra\.effective_to >/);
});

test("a confirmation outlives the row it came from", () => {
  // Reviewing an alert-derived row REMOVES it from the queue, because the queue
  // reads the alert's status. The confirmation used to live inside that row, so
  // it unmounted with it: the clinician pressed "Record it" on a safety row and
  // it silently vanished, which is indistinguishable from a re-sort. §5 asks
  // for "exactly what the action changed after the server confirms it", and a
  // row that is simply gone is not that.
  const dir = path.join(root, "src/components/experience");
  const confirmations = code(fs.readFileSync(path.join(dir, "QueueConfirmations.tsx"), "utf8"));
  assert.match(confirmations, /aria-live="polite"/, "the region is not announced");
  assert.match(confirmations, /data-testid="queue-confirmations"/);
  // It reports the server's own summary and invents nothing.
  assert.match(confirmations, /\{n\.summary\}/);

  const rowActions = code(fs.readFileSync(path.join(dir, "RowActions.tsx"), "utf8"));
  assert.match(rowActions, /recorded\?\.record\(/, "the row does not lift its confirmation");
  assert.match(
    rowActions, /outcome === "confirmed"[\s\S]{0,80}recorded\?\.record\(/,
    "an unconfirmed result is lifted as though it were confirmed"
  );

  // And the provider wraps BOTH columns: the panel is derived from the same
  // items, so a removed row closes it too and an action taken there would
  // vanish the same way.
  const view = code(fs.readFileSync(path.join(dir, "ClinicianHomeView.tsx"), "utf8"));
  const openAt = view.indexOf("<QueueConfirmations>");
  const closeAt = view.indexOf("</QueueConfirmations>");
  assert.ok(openAt > 0 && closeAt > openAt, "the provider is gone");
  const wrapped = view.slice(openAt, closeAt);
  assert.match(wrapped, /QueueEvidencePanel/, "the evidence panel is outside the confirmation region");
  assert.ok(
    (wrapped.match(/<RowActions/g) ?? []).length === 2,
    "not every row-action mount is inside the confirmation region"
  );
});

test("actor and tenant come from the context, never the input", () => {
  const resolved = resolveCommand(clinician, {
    intent: "acknowledge", target: "sig-1", payload: { note: "read it" }, idempotencyKey: "k1",
  });
  assert.equal(resolved.actorPersonId, "clin-1");
  assert.equal(resolved.tenantId, "t-1");
  // The input type has no actor field at all — a compile-time property, checked
  // here as a source property so it cannot be added back quietly.
  const src = code(fs.readFileSync(path.join(EXPERIENCE_DIR, "command.ts"), "utf8"));
  const inputType = src.slice(src.indexOf("export interface CommandInput"), src.indexOf("export interface ResolvedCommand"));
  assert.ok(
    !/actor|tenant/i.test(inputType),
    `CommandInput declares an authority field: ${inputType}`
  );
});

test("a command with no idempotency key is refused", () => {
  assert.throws(
    () => resolveCommand(clinician, {
      intent: "acknowledge", target: "sig-1", payload: {}, idempotencyKey: "",
    }),
    CommandError
  );
});

test("the idempotency key is stable across retries of the same action", () => {
  const args = { intent: "acknowledge", target: "sig-1", actorPersonId: "clin-1", nonce: "form-7" };
  assert.equal(commandKey(args), commandKey(args), "the key changes between calls");
  assert.notEqual(
    commandKey(args), commandKey({ ...args, target: "sig-2" }),
    "two different targets share a key"
  );
  // A key containing a timestamp would make every retry a new action — the
  // failure the key exists to prevent.
  const src = code(fs.readFileSync(path.join(EXPERIENCE_DIR, "command.ts"), "utf8"));
  const fn = src.slice(src.indexOf("export function commandKey"), src.indexOf("// ---", src.indexOf("export function commandKey")));
  assert.ok(!/Date\.now|new Date|Math\.random/.test(fn), `commandKey is not stable: ${fn}`);
});

test("only a confirmed result lets a surface claim something changed", () => {
  assert.ok(mayClaimChange(confirmed({ ok: true })));
  for (const r of [
    rejected("no"), stale("moved", "v2"), unavailable("not here"),
    indeterminate("timed out", "k1"),
  ]) {
    assert.ok(!mayClaimChange(r), `${r.outcome} allowed a change claim`);
  }
});

test("an indeterminate result must carry the key to reconcile by", () => {
  // §9: "An indeterminate response should reconcile by idempotency key before
  // inviting retry." Without the key the only action available is a blind
  // retry, which is how one action becomes two records.
  assert.throws(() => indeterminate("timed out", ""), CommandError);
  const r = indeterminate("timed out", "k1", "corr-1");
  assert.equal(r.reconcileBy, "k1");
  assert.ok(!mayRetryDirectly(r), "a blind retry was offered on an indeterminate result");
});

test("a stale result carries what the server holds now", () => {
  // §7.1: "reject the stale submission with a comparison and a clear
  // review-again route." A refusal with nothing to compare against is a dead
  // end.
  assert.throws(() => stale("moved", ""), CommandError);
  assert.equal(stale("moved", "v2").currentVersion, "v2");
});

test("a refusal must say why", () => {
  assert.throws(() => rejected(""), CommandError);
  assert.throws(() => unavailable(""), CommandError);
});

test("every outcome has words, and none of them claims a write on failure", () => {
  const outcomes: CommandOutcome[] = ["confirmed", "rejected", "stale", "unavailable", "indeterminate"];
  for (const outcome of outcomes) {
    assert.ok(OUTCOME_LABEL[outcome].length > 0, `${outcome} has no label`);
    assert.ok(OUTCOME_NOTE[outcome].length > 30, `${outcome} has no note`);
  }
  assert.match(OUTCOME_NOTE.indeterminate, /cannot say whether it landed/);
  assert.match(OUTCOME_NOTE.rejected, /Nothing was written/);
});

// ---------------------------------------------------------------------------
// Task state — §9's "UI progress must never become clinical state"
// ---------------------------------------------------------------------------

test("a failed save never appears as saved", () => {
  // §4.4 and §4.6: "A failed save never appears as saved." The only way to
  // reach `confirmed` is to pass a confirmed command result.
  for (const r of [
    rejected("no"), stale("moved", "v2"), unavailable("not here"),
    indeterminate("timed out", "k1"),
  ]) {
    const t = advance(r);
    assert.notEqual(t.name, "confirmed", `${r.outcome} produced a confirmed task state`);
    assert.ok(!mayClaimSaved(t), `${r.outcome} allowed a "saved" claim`);
    assert.notEqual(t.label, TASK_LABEL.confirmed, `${r.outcome} rendered as "${t.label}"`);
  }
  assert.equal(advance(confirmed({})).name, "confirmed");
  assert.ok(mayClaimSaved(advance(confirmed({}))));
});

test("no state before submission claims anything is saved", () => {
  for (const t of [idle(), editing(), submitting()]) {
    assert.ok(!mayClaimSaved(t), `${t.name} claimed saved`);
    assert.notEqual(t.label, TASK_LABEL.confirmed);
  }
  // §4.4's vocabulary, exactly.
  assert.equal(editing().label, "Not saved yet");
  assert.equal(submitting().label, "Saving…");
  assert.equal(advance(rejected("no")).label, "Could not save");
});

test("a conflict is not retryable and an indeterminate result offers no retry", () => {
  // §5: "Do not silently overwrite." A conflict is resolved by reading what
  // changed, not by pressing the button again.
  const conflict = advance(stale("moved", "v2"));
  assert.equal(conflict.name, "conflict");
  assert.equal(conflict.retryable, false);
  assert.equal(conflict.currentVersion, "v2");

  const indet = advance(indeterminate("timed out", "k1"));
  assert.equal(indet.retryable, false);
  assert.equal(indet.reconcileBy, "k1");

  // A refusal IS retryable: the server answered.
  assert.equal(advance(rejected("no")).retryable, true);
});

test("the task vocabulary is the six states, and only one of them is a success", () => {
  assert.deepEqual([...TASK_STATES], [
    "idle", "editing", "submitting", "confirmed", "conflict", "recoverable_failure",
  ]);
  assert.equal(NEVER_CONFIRMS.length, 4);
  assert.ok(!NEVER_CONFIRMS.includes("confirmed" as never));
});

// ---------------------------------------------------------------------------
// View state — §9's "efficient return should not leak data"
// ---------------------------------------------------------------------------

test("a view state carries no free text at any depth", () => {
  // §4.4: "Do not place clinical text in browser local storage by default." A
  // view state and a half-written note both want to survive a reload, and the
  // obvious implementation puts them in the same bag.
  const src = code(fs.readFileSync(path.join(EXPERIENCE_DIR, "view-state.ts"), "utf8"));
  const types = src.slice(src.indexOf("export interface ReturnPosition"), src.indexOf("export class ViewStateError"));
  for (const suspect of ["note", "draft", "text", "comment", "body", "content"]) {
    assert.ok(
      !new RegExp(`\\b${suspect}\\??\\s*:`, "i").test(types),
      `ViewState declares a "${suspect}" field, which would put clinical text in a view store`
    );
  }
});

test("a stored state from another tenant is cleared, not filtered", () => {
  // §6: "Switching tenant clears prior view state." Filtering would leave a
  // caller holding a state that looks restored and points at somebody from
  // another organization.
  const stored = withFilter(
    { ...emptyViewState("t-1"), returnTo: { fromHref: "/x", page: 2, scrollY: 400, selectedId: "p-9" } },
    "assignedToMe", "mine"
  );
  const same = forTenant(stored, "t-1");
  assert.equal(same.filters.assignedToMe, "mine");
  assert.equal(same.returnTo?.selectedId, "p-9");

  const other = forTenant(stored, "t-2");
  assert.equal(other.tenantId, "t-2");
  assert.equal(other.returnTo, null, "a return position survived a tenant change");
  assert.ok(isDefault(other), "filters survived a tenant change");
});

test("a filter value that is not in its set is refused", () => {
  assert.throws(() => withFilter(emptyViewState("t-1"), "density", "tiny"), ViewStateError);
  // And a query string cannot introduce one — it is dropped rather than
  // throwing, because a URL somebody edited should not break their page.
  const fromUrl = fromSearchParams({ density: "tiny", assignedToMe: "mine", nonsense: "x" }, "t-1");
  assert.equal(fromUrl.filters.density, "comfortable", "an invalid value from a URL was applied");
  assert.equal(fromUrl.filters.assignedToMe, "mine");
});

test("no filter can hide an obligation", () => {
  // §5: "Do not let a filter quietly hide mandatory obligations." The
  // vocabulary contains no filter that removes a row — that is the enforcement.
  for (const f of VIEW_FILTERS) {
    assert.ok(
      !/^(hide|only|exclude|min|max)/i.test(f),
      `"${f}" reads as a filter that removes rows; §5 permits density and supporting columns, never clinical priority`
    );
    assert.ok(FILTER_VALUES[f].length >= 2, `${f} has fewer than two values`);
  }
  // assignedToMe defaults to everyone's work: a default that narrowed would
  // hide obligations on first load, before anybody chose anything.
  assert.equal(emptyViewState("t-1").filters.assignedToMe, "all");
});

test("the active-filter summary appears only when something is off the default", () => {
  // §5: "Show an active-filter summary and a clear reset control." A summary
  // that always renders teaches a reader to ignore it.
  assert.equal(summary(emptyViewState("t-1")), null);
  const narrowed = withFilter(emptyViewState("t-1"), "assignedToMe", "mine");
  assert.match(summary(narrowed) ?? "", /Assigned to me/);
  assert.ok(isDefault(reset(narrowed)), "reset did not clear the filters");
});

// ---------------------------------------------------------------------------
// Evidence panel — §1.4
// ---------------------------------------------------------------------------

test("only a modal traps focus", () => {
  // §1.4's ruling. A trapped non-modal panel turns a comparison into a
  // recollection: the reader must close it to look at the list.
  assert.equal(focusBehaviour("modal").trapFocus, true);
  assert.equal(focusBehaviour("nonmodal").trapFocus, false);
  assert.equal(focusBehaviour("inline").trapFocus, false);
  assert.equal(focusBehaviour("nonmodal").pageRemainsOperable, true);
  assert.equal(focusBehaviour("modal").pageRemainsOperable, false);
  // And there is no boolean a caller could set instead.
  const src = code(fs.readFileSync(path.join(EXPERIENCE_DIR, "evidence-panel.ts"), "utf8"));
  const contract = src.slice(src.indexOf("export interface PanelContract"), src.indexOf("export class PanelContractError"));
  assert.ok(!/trapFocus/.test(contract), "PanelContract lets a caller set trapFocus directly");
});

test("every mode has a labeled region, and closable modes return focus", () => {
  // §1.4: "Inline and non-modal desktop panels get a labeled region, an
  // optional close control, and a documented focus-return target."
  for (const mode of PANEL_MODES) {
    const b = focusBehaviour(mode);
    assert.equal(b.labelledRegion, true, `${mode} has no labeled region`);
    if (b.closeControl) {
      assert.equal(b.returnFocusToOpener, true, `${mode} closes without returning focus`);
      assert.equal(b.closeOnEscape, true, `${mode} closes but not on Escape`);
    }
  }
});

test("a panel that cannot behave as its mode requires is refused", () => {
  assert.throws(() => assertPanel({ mode: "modal", label: "", subjectLabel: "Ada", openerId: "b1" }), PanelContractError);
  assert.throws(() => assertPanel({ mode: "modal", label: "Evidence", subjectLabel: "", openerId: "b1" }), PanelContractError);
  // §8.6: return focus to the exact originating control.
  assert.throws(() => assertPanel({ mode: "modal", label: "Evidence", subjectLabel: "Ada" }), PanelContractError);
  assert.ok(assertPanel({ mode: "inline", label: "Evidence", subjectLabel: "Ada" }));
});

test("a narrow screen gets a page with a return path, not a bigger overlay", () => {
  // §5: "On small screens, open a full page with a dependable return path."
  const narrow = presentationFor({ wide: false, purpose: "read", listHref: "/clinician/today" });
  assert.deepEqual(narrow, { kind: "page", returnTo: "/clinician/today" });
  assert.deepEqual(
    presentationFor({ wide: true, purpose: "read", listHref: "/x" }),
    { kind: "panel", mode: "nonmodal" }
  );
  // A decision earns a modal; reading never does.
  assert.deepEqual(
    presentationFor({ wide: true, purpose: "decide", listHref: "/x" }),
    { kind: "panel", mode: "modal" }
  );
});

// ---------------------------------------------------------------------------
// Member projection — §3's "structural impossibility beats prohibition"
// ---------------------------------------------------------------------------

test("a field nobody decided on is refused, at any depth", () => {
  // §3: "including nested inside another object." A boundary that only checks
  // top-level keys is one somebody routes around by wrapping.
  const nested = { recommended: { title: "Check in", meta: { t: 22 } } };
  const found = violations(nested);
  assert.equal(found.length, 2, JSON.stringify(found));
  assert.ok(found.some((v) => v.field === "meta"));
  assert.ok(found.some((v) => v.field === "t" && v.at === "$.recommended.meta.t"));
  assert.throws(() => assertMemberProjection(nested), MemberBoundaryError);
});

test("a forbidden field says which rule it broke", () => {
  const found = violations({ recommended: { title: "x", readinessScore: 42 } });
  const score = found.find((v) => v.field === "readinessScore")!;
  assert.equal(score.rule, "forbidden");
  assert.match(score.detail, /readiness score/);
  assert.match(score.detail, /Vol 2/, "the refusal does not cite the authority that forbids it");
});

test("a legitimate member day crosses the boundary", () => {
  // A negative-only suite would pass with an allow-list that refuses
  // everything, which would be useless rather than safe.
  const day = {
    schemaVersion: "member_today.v1",
    generatedAt: "2026-09-08T09:00:00.000Z",
    displayName: "Ada",
    dayState: "open",
    dayStateLabel: "Open",
    orientingSentence: "One small step is enough.",
    recommended: {
      activityId: "check-in",
      title: "Take a moment to check in",
      description: "Share how today feels.",
      approximateMinutes: 6,
      pausePromise: "You can stop at any time.",
      startHref: "/app/check-in",
    },
    tools: [{ label: "Grounding tools", href: "/app/ground", description: "Choose something familiar" }],
    recent: [{ kind: "check-in", occurredAt: "2026-09-07T08:00:00.000Z" }],
    supportHref: "/crisis",
    groundHref: "/app/ground",
    crisisHref: "/crisis",
  };
  assert.ok(crossesBoundary(day), JSON.stringify(violations(day), null, 2));
  assert.equal(assertMemberProjection(day), day);
});

test("array positions are not treated as fields", () => {
  assert.deepEqual(violations({ tools: [{ label: "x", href: "/y", description: "z" }] }), []);
});

test("every forbidden name is also absent from the allow-list", () => {
  // Belt and braces, and the reason is a real one: a forbidden name that also
  // appeared on the allow-list would be permitted by whichever check ran
  // first, and the two lists are edited by different people at different times.
  const allowed = new Set(MEMBER_ALLOWED_FIELDS);
  for (const f of MEMBER_FORBIDDEN_FIELDS) {
    assert.ok(!allowed.has(f.name), `"${f.name}" is both forbidden and allowed`);
  }
});

test("the allow-list carries no score-shaped name", () => {
  for (const name of MEMBER_ALLOWED_FIELDS) {
    assert.ok(
      !/score|band|severity|track|threshold|percent|streak|rank|grade/i.test(name),
      `"${name}" is on the member allow-list and reads as a score, a band or a grade`
    );
  }
  // `approximateMinutes` is the one number on the list, and it describes the
  // ACTIVITY rather than the person. If a second number arrives, somebody has
  // to justify it here.
  const numeric = MEMBER_ALLOWED_FIELDS.filter((n) => /minutes|count|total|number|value/i.test(n));
  assert.deepEqual(numeric, ["approximateMinutes"], `unexplained numeric fields: ${numeric.join(", ")}`);
});

test("the one score exception is settled, and every requirement names its authority", () => {
  // §11 listed what a kept exception requires and the product owner decided to
  // keep it. So the check is no longer "is anything unmet" — it is that a
  // requirement marked met cannot be a bare assertion. Each one names the
  // evidence, and the third names WHOSE decision it is, so a later reader does
  // not infer a clinical sign-off from a boolean.
  const e = MEMBER_SCORE_EXCEPTION;
  assert.equal(e.route, "/app/progress");
  assert.equal(exceptionFullyMet(e), true);
  for (const [name, req] of [
    ["own projection", e.ownProjection],
    ["own contract test", e.ownContractTest],
    ["recorded decision", e.recordedClinicalDecision],
  ] as const) {
    assert.equal(req.met, true, `${name} is not met`);
    assert.ok(
      req.evidence.length > 40,
      `${name} is marked met with no evidence a reader could check: "${req.evidence}"`
    );
    assert.ok(
      /src\/|tests\/|docs\//.test(req.evidence),
      `${name} cites no file: "${req.evidence}"`
    );
  }
  // The one that would be easiest to leave vague.
  assert.ok(
    e.recordedClinicalDecision.authority.length > 5,
    "the decision is marked recorded without naming whose decision it is"
  );
  assert.match(e.recordedClinicalDecision.evidence, /gui-decisions/);
  // And the ruling records that it was decided AGAINST a recommendation, so the
  // next reader knows there was an argument rather than an oversight.
  assert.match(e.ruling, /Settled/, "the ruling does not say the decision was taken");
  assert.match(e.ruling, /§1\.3/, "the recommendation it was decided against is not recorded");
});

test("keeping the exception did not widen it", () => {
  // The four properties the decision rests on. §11's requirements are met by
  // these staying true, so they are checked here rather than assumed: widening
  // any of them is a new decision, not a continuation of this one.
  const e = MEMBER_SCORE_EXCEPTION;

  // 1. The shared allow-list does not cover the exception's fields. That is
  //    what "narrow" means.
  for (const scoreField of ["totalScore", "score", "band", "severity"]) {
    assert.ok(
      !MEMBER_ALLOWED_FIELDS.includes(scoreField),
      `"${scoreField}" reached the shared member allow-list; the exception widened into the boundary`
    );
    assert.ok(
      violations({ [scoreField]: 1 }).length > 0,
      `"${scoreField}" now crosses the shared member boundary`
    );
  }

  // 2. It is one route, named, not a pattern a sibling could fall into.
  assert.equal(e.route, "/app/progress");
  assert.ok(!e.route.includes("*"), "the exception is a pattern rather than one route");

  // 3. It has its own projection, and the name is recorded so a second surface
  //    reusing it is visible in a diff.
  assert.equal(e.projection, "member_progress.v6");

  // 4. Its contract test is named, and it is the one that holds the bound.
  assert.match(e.ownContractTest.evidence, /member-boundary\.test\.ts/);
  assert.match(e.ownContractTest.evidence, /assertPatternOnly/,
    "the guard that refuses verdict language is not recorded as part of what bounds this");
});

// ---------------------------------------------------------------------------
// Role home and support dock
// ---------------------------------------------------------------------------

test("a home with no primary action must say why", () => {
  // §8.4: an absence must never imply a healthy or low-risk state.
  const base = {
    audience: "member" as const,
    asking: { question: "What would help today?", orienting: "One small step is enough." },
    primary: null,
    items: [],
    totalItems: 0,
    coverage: fullCoverage(["day"]),
    navigation: navigationFor(member),
    generatedAt: "2026-09-08T09:00:00.000Z",
  };
  assert.throws(() => assertRoleHome(base), RoleHomeError);
  assert.ok(assertRoleHome({ ...base, primaryAbsentNote: "Today is a gentler day and it is complete." }));
});

test("partial coverage cannot be reported as complete", () => {
  // §5: "Partial coverage must never render as full coverage."
  const partial = partialCoverage(["a"], [{ source: "b", reason: "TimeoutError", lastGoodAt: "2026-09-01T00:00:00.000Z" }]);
  assert.equal(partial.complete, false);
  assert.match(coverageNote(partial) ?? "", /b/);
  assert.match(coverageNote(partial) ?? "", /may be incomplete/);
  assert.equal(coverageNote(fullCoverage(["a"])), null);

  assert.throws(
    () => assertRoleHome({
      audience: "clinician", asking: { question: "q", orienting: "o" },
      primary: { label: "Review", href: "/x", description: "d" },
      items: [], totalItems: 0,
      coverage: { ...partial, complete: true },
      navigation: navigationFor(clinician), generatedAt: "2026-09-08T09:00:00.000Z",
    }),
    RoleHomeError
  );
});

test("a home cannot report fewer total items than it shows", () => {
  assert.throws(
    () => assertRoleHome({
      audience: "clinician", asking: { question: "q", orienting: "o" },
      primary: { label: "Review", href: "/x", description: "d" },
      items: [1, 2, 3], totalItems: 1,
      coverage: fullCoverage(["a"]),
      navigation: navigationFor(clinician), generatedAt: "2026-09-08T09:00:00.000Z",
    }),
    RoleHomeError,
    "a filter could hide an obligation behind an understated total"
  );
});

test("the support dock takes no arguments and can never be off", () => {
  // §9: "Support must never depend on payment or module state." A function
  // with a parameter is a function somebody eventually passes a gate to.
  const src = code(fs.readFileSync(path.join(EXPERIENCE_DIR, "support-dock.ts"), "utf8"));
  for (const fn of ["supportDock", "activitySupportDock"]) {
    const at = src.indexOf(`export function ${fn}(`);
    assert.ok(at > 0, `${fn} is gone`);
    const params = src.slice(at + `export function ${fn}`.length, src.indexOf(")", at) + 1);
    assert.equal(params.replace(/\s/g, ""), "()", `${fn} takes ${params}`);
  }
  // No conditional anywhere in the module.
  assert.ok(
    !/\bif\s*\(|\?\s*[^:]+\s*:|&&|\|\|/.test(src),
    "the support dock contains a conditional; there must be nothing that can turn support off"
  );
});

test("every support route survives every failure, and the activity dock is identical", () => {
  for (const e of SUPPORT_ENTRIES) {
    assert.equal(e.survivesEveryFailure, true);
    assert.ok(routeEntry(e.href), `${e.href} is not a registered route`);
    assert.equal(routeEntry(e.href)!.state, "working", `${e.href} is not working`);
  }
  // §1.6: during an activity, routine navigation goes and support stays.
  assert.deepEqual(activitySupportDock().entries, supportDock().entries);
  assert.equal(supportDock().routineNavigationVisible, true);
  assert.equal(activitySupportDock().routineNavigationVisible, false);
  // §4: Pause and Stop are distinct, and neither claims a save it has not had
  // confirmed.
  const labels = ACTIVITY_CONTROLS.map((c) => c.label);
  assert.deepEqual(labels, ["Pause", "Stop", "Get support"]);
  for (const c of ACTIVITY_CONTROLS) assert.equal(c.claimsSaved, false);
});

// ---------------------------------------------------------------------------
// Package 1's exit evidence
// ---------------------------------------------------------------------------
//
// "Contract tests prove no raw SQL, no client-side priority, no role inference
// from the browser." Checks on the SHAPE OF THE LAYER, so they hold for the
// module somebody adds next month as well as for these nine.

test("no raw SQL anywhere in the experience layer", () => {
  // §9: "Retain the experience layer as composition around existing readers
  // and commands." A layer that queries is a layer that has its own idea of
  // what a clinician may see, and the two will eventually disagree.
  for (const { name, src } of experienceFiles()) {
    const body = code(src);
    for (const rx of [/\bSELECT\b/i, /\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i]) {
      assert.ok(!rx.test(body), `${name} contains raw SQL matching ${rx}`);
    }
    for (const token of ["getDb", "better-sqlite3", "repo("]) {
      assert.ok(!body.includes(token), `${name} reaches the database directly via ${token}`);
    }
  }
});

test("no client-side priority anywhere in the experience layer", () => {
  // §5: "Retain domain-owned ordering and safety authority... Preferences may
  // change density and visible supporting columns, not clinical priority." A
  // sort in this layer is a second opinion about who matters most.
  for (const { name, src } of experienceFiles()) {
    const body = code(src);
    for (const token of ["BAND_ORDER", "PRIORITY", "urgencyRank", "severityOrder"]) {
      assert.ok(!body.includes(token), `${name} carries a priority ordering (${token})`);
    }
    // The one sort that is allowed is inside a band, and it lives in the
    // view-state vocabulary as a declared value rather than as code here.
    if (name !== "navigation.ts") {
      assert.ok(
        !/\.sort\(/.test(body),
        `${name} sorts. Clinical order is the domain's; the only ordering this layer may do is inside a band, declared in the view-state vocabulary.`
      );
    }
  }
  // And navigation.ts's only sort is the longest-match comparison, not a
  // priority: it compares href LENGTH.
  const nav = code(fs.readFileSync(path.join(EXPERIENCE_DIR, "navigation.ts"), "utf8"));
  const sorts = [...nav.matchAll(/\.sort\([^)]*\)/g)].map((m) => m[0]);
  assert.deepEqual(sorts, [], `navigation.ts sorts: ${sorts.join(", ")}`);
});

test("no role inference from the browser anywhere in the experience layer", () => {
  // §9: "A browser-supplied role or tenant is not command authority." The
  // audience travels to the client for LAYOUT; nothing in this layer may
  // authorize against something a client could send.
  for (const { name, src } of experienceFiles()) {
    const body = code(src);
    for (const token of ["searchParams", "headers(", "cookies(", "req.body", "formData.get"]) {
      assert.ok(
        !body.includes(token),
        `${name} reads ${token}. Identity, tenant and capability come from the authenticated session, resolved in src/lib/auth.ts.`
      );
    }
  }
  // fromSearchParams is the one place a query string is read, and it reads
  // FILTERS from a closed vocabulary — never a role, a tenant or a person.
  const vs = code(fs.readFileSync(path.join(EXPERIENCE_DIR, "view-state.ts"), "utf8"));
  const fn = vs.slice(vs.indexOf("export function fromSearchParams"), vs.indexOf("export function summary"));
  assert.ok(
    !/role|tenant|audience|personId/i.test(fn.replace(/tenantId\b/g, "")),
    `fromSearchParams reads an authority field: ${fn}`
  );
});

test("no generic renderer: no type in the layer is parameterised over unknown", () => {
  // §9's first architectural rule: "Do not build one
  // ProjectionEnvelope<unknown> renderer for all roles. Use typed role
  // projections, exhaustive state handling, and role-safe labels."
  //
  // SCOPED TO TYPE DECLARATIONS, not to every appearance of the word. A
  // boundary walker takes `unknown` because that is the correct type for
  // untrusted input — `violations(value: unknown)` is the member projection
  // guard doing its job, and forbidding it would push the next author to
  // `any`, which is strictly worse. What §9 rules out is a SHAPE that carries
  // an undetermined payload, because that is the thing one renderer is then
  // written against.
  for (const { name, src } of experienceFiles()) {
    const body = code(src);
    const declarations = [...body.matchAll(/(?:interface|type)\s+\w+<([^>]*)>/g)].map((m) => m[1]);
    for (const params of declarations) {
      // A default of `unknown` on a result payload is fine — `CommandResult`
      // with no result type is a command that returned nothing. What is not
      // fine is a parameter CONSTRAINED to unknown, or a bare `<unknown>`
      // instantiation.
      assert.ok(
        !/\bextends\s+unknown\b/.test(params),
        `${name} declares a type constrained to unknown: <${params}>`
      );
    }
    const instantiations = [...body.matchAll(/\b(\w+)<unknown>/g)].map((m) => m[0]);
    assert.deepEqual(
      instantiations, [],
      `${name} instantiates a type over unknown, which is the generic renderer §9 forbids: ${instantiations.join(", ")}`
    );
  }
});
