// The navigation manifest (handoff 09 §9, §1.1, §1.2; Package 1).
//
// §9's shape: "Capability state, canonical destination, owning workspace,
// active-route matching." Its reason: "A route file alone does not establish
// usable functionality. This is what enforces §1.1."
//
// §1.1 IS THE RULING THIS MODULE EXISTS TO MAKE STRUCTURAL:
//
//   "Omit unavailable capabilities from primary navigation entirely. A
//    navigation item is a promise; promoting a route that dead-ends is the
//    fastest way to lose a clinician's trust in the whole shell."
//
// A comment saying "don't put Messages in the sidebar" is a rule somebody
// breaks in six months. So `navigationFor` cannot emit a destination whose
// capability is off: the filter is in the function rather than in the caller,
// and there is no parameter that turns it off.
//
// §1.2 IS THE OTHER HALF. "Three to five is a design target, not a
// requirement. Never add a destination to reach a count." So there is no
// padding, no placeholder, and no fixed length — a role with two working
// destinations gets two. The guard asserts the range is a target by checking
// that no manifest declares a filler entry, not by checking a count.
//
// AND THE MANIFEST DOES NOT SWAP MEANING. §1.5: "Never swap the entire meaning
// of the sidebar when a patient record opens — use a local navigation region
// plus a labeled return control." So a manifest has a `core` (the stable global
// row) and an optional `local` (the record you are inside), and the two are
// separate fields rather than one list that gets replaced.

import {
  ROUTE_REGISTER, routeEntry,
  type Audience, type Workspace,
} from "../app/route-register";
import {
  type ExperienceContext, type Capability, can, whyNot, capabilitiesFor,
} from "./context";
import { DEFAULT_RETURN } from "./return-to";

export interface NavDestination {
  /** Where it goes. Always a route the register knows. */
  href: string;
  /** What it is called. From task testing, per §1.2 — not from symmetry. */
  label: string;
  /** The workspace it opens. §1.5: one owner per job. */
  workspace: Workspace;
  /** The capability that must be on for this to appear at all. */
  capability: Capability;
}

export interface NavigationManifest {
  audience: Audience;
  /** The stable global row. Three to five as a target (§1.2), never padded. */
  core: NavDestination[];
  /** The local region for the record currently open, when one is. Separate
   *  from `core` so opening a person does not replace the shell (§1.5). */
  local: { label: string; returnTo: { href: string; label: string }; items: NavDestination[] } | null;
  /** Predictable utility positions. Never counted toward the core target. */
  utility: NavDestination[];
  /** Capabilities this audience is offered and this build does not have, with
   *  the honest reason. §1.1 keeps these OUT of navigation and reachable from
   *  the product-status location; a surface that wants to say "and here is what
   *  is missing" reads them from here rather than inventing a list. */
  absent: Array<{ label: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// The declared destinations
// ---------------------------------------------------------------------------
//
// Every entry names its capability. `navigationFor` drops the ones that are
// off, which is how §1.1 stops being a habit and becomes a property.

const MEMBER_CORE: NavDestination[] = [
  { href: "/app/today", label: "Today", workspace: "member_day", capability: "recordADayShape" },
  { href: "/app/activities", label: "Tools", workspace: "member_activity", capability: "doAnActivity" },
  { href: "/app/progress", label: "Progress", workspace: "member_day", capability: "readOwnProgress" },
  // Messaging is declared and will be filtered out while its capability is
  // off. Declaring it rather than omitting it is deliberate: the day a message
  // store exists, this line is already correct, and until then the register
  // and the `absent` list below carry the honest notice.
  { href: "/app/messages", label: "Messages", workspace: "member_day", capability: "messageAClinician" },
  { href: "/app/care-team", label: "Care team", workspace: "member_day", capability: "seeOwnCareTeam" },
];

const CLINICIAN_CORE: NavDestination[] = [
  { href: "/clinician/today", label: "Command Center", workspace: "command_center", capability: "reviewAttentionQueue" },
  // §1.5: "Work needing action lives in Command Center. The full roster lives
  // under Patients." Two destinations, two jobs, and the register records
  // which workspace owns each.
  { href: "/clinician/patients", label: "Patients", workspace: "patients", capability: "openAPersonRecord" },
  { href: "/clinician/reports", label: "Reports", workspace: "clinician_reports", capability: "readAggregateOutcomes" },
  { href: "/clinician/handoffs", label: "Handoffs", workspace: "command_center", capability: "handOverAPerson" },
  { href: "/clinician/referrals", label: "Referrals", workspace: "command_center", capability: "referAPersonOut" },
  { href: "/clinician/messages", label: "Messages", workspace: "command_center", capability: "messageAMember" },
  { href: "/clinician/schedule", label: "Schedule", workspace: "command_center", capability: "scheduleAnAppointment" },
];

const ORGANIZATION_CORE: NavDestination[] = [
  { href: "/organization/overview", label: "Overview", workspace: "org_console", capability: "readAggregateOutcomes" },
  { href: "/organization/care-delivery", label: "Care delivery", workspace: "org_console", capability: "readAggregateOutcomes" },
  { href: "/organization/outcomes", label: "Outcomes", workspace: "org_console", capability: "readAggregateOutcomes" },
  { href: "/organization/reports", label: "Reports", workspace: "org_console", capability: "requestAnExport" },
];

const PAYER_CORE: NavDestination[] = [
  { href: "/payer/overview", label: "Overview", workspace: "payer_console", capability: "readAggregateOutcomes" },
  { href: "/payer/population", label: "Population", workspace: "payer_console", capability: "readAggregateOutcomes" },
  { href: "/payer/outcomes", label: "Outcomes", workspace: "payer_console", capability: "readAggregateOutcomes" },
  { href: "/payer/evidence", label: "Evidence", workspace: "payer_console", capability: "readAggregateOutcomes" },
];

const REVIEWER_CORE: NavDestination[] = [
  { href: "/review", label: "Readiness", workspace: "review_console", capability: "recordAReleaseDecision" },
  { href: "/review/release", label: "Decisions", workspace: "review_console", capability: "recordAReleaseDecision" },
  { href: "/review/status", label: "Evidence", workspace: "review_console", capability: "recordAReleaseDecision" },
];

const DEMO_ADMIN_CORE: NavDestination[] = [
  { href: "/admin/demo", label: "Environment", workspace: "demo_ops", capability: "operateTheDemoEnvironment" },
  // "Scenarios" now goes to the walkthrough launcher rather than to the review
  // gateway, which is what the label always said and is not what it did:
  // /demo is where a REVIEWER enters with an access code, and the register
  // records it as that. Package 4 built the thing the word meant.
  { href: "/demo/scenarios", label: "Scenarios", workspace: "demo_ops", capability: "operateTheDemoEnvironment" },
  { href: "/review/audit", label: "Audit", workspace: "review_console", capability: "operateTheDemoEnvironment" },
];

const CORE: Partial<Record<Audience, NavDestination[]>> = {
  member: MEMBER_CORE,
  clinician: CLINICIAN_CORE,
  organization: ORGANIZATION_CORE,
  payer: PAYER_CORE,
  reviewer: REVIEWER_CORE,
  demo_admin: DEMO_ADMIN_CORE,
};

/** §3's "Account; persistent Get support" and the equivalents. Predictable
 *  utility positions, never counted toward §1.2's three-to-five target. */
const UTILITY: Partial<Record<Audience, NavDestination[]>> = {
  member: [
    { href: "/app/settings", label: "Account", workspace: "member_account", capability: "doAnActivity" },
    // Support is in the utility row AND in the SupportDock. §4.1: "Support
    // fixed, high-contrast, keyboard reachable, and independent of
    // subscription, tier, gate, or module state." Its capability is
    // `doAnActivity` rather than a support capability of its own precisely
    // because it must not be gateable — there is no switch that turns it off.
    { href: "/app/ground", label: "Get support", workspace: "member_activity", capability: "doAnActivity" },
  ],
  clinician: [
    { href: "/clinician/activity", label: "Recent activity", workspace: "command_center", capability: "reviewAttentionQueue" },
  ],
};

/** The person-record local region (§1.5, §5).
 *
 *  §5's grouping: "Person sections group as Overview, Course, Sessions, Notes,
 *  Safety where existing content supports it. Avoid a second horizontal menu
 *  that wraps." Course is one destination holding measures, life goals,
 *  responses and trajectory — which is the correction §5 asks for and which
 *  Package 2 renders. The manifest declares it now so Package 2 has a contract
 *  to build against rather than a paragraph to interpret.
 *
 *  THE 17 SEPTEMBER AMENDMENT MAKES IT SIX, and both changes here are
 *  corrections rather than additions.
 *
 *  CARE. "Overview, Care, Course, Sessions, Notes, Safety", where Care owns
 *  "care plan, goals, assigned support, and handoffs". Those four were reachable
 *  and scattered: the plan and goals sat behind a layer rail a clinician had to
 *  understand to use, and this person's handoffs were readable only from the
 *  console-level queue, which answers "what is waiting for me" rather than "who
 *  is accountable for this person". The amendment also moves goals out of Course
 *  — "keep goals in Care as the working location and allow Course to show a
 *  read-only progress summary that links back to the goal" — because a goal is
 *  something a clinician SETS, and Course is where they READ.
 *
 *  COURSE NOW POINTS AT THE COURSE LANDING. It pointed at /measures while
 *  PersonShell's own tab pointed at /course, so the same word led to two places
 *  depending on which navigation you used. The amendment asks to "resolve the
 *  current Course mapping to measures versus the separate Course landing and
 *  establish one canonical entry": the landing wins, because it is the screen
 *  that says what the four readings are for, and /measures remains one of the
 *  four rather than standing for all of them. */
export function personLocal(
  personId: string,
  back: { href: string; label: string } = DEFAULT_RETURN
): NavigationManifest["local"] {
  const base = `/clinician/member/${personId}`;
  return {
    label: "This person",
    // §1.5 and §3: "Show a breadcrumb or labeled return control such as Back
    // to Command Center. Preserve the selected filters, page, and scroll
    // position on return."
    //
    // The destination is passed in rather than fixed, because it is a fact
    // about this visit: which console the reader came from and what they had
    // filtered it to. `return-to.ts` resolves it from the frame; the default
    // is the answer for a record opened from a direct link, where there is no
    // previous view to restore.
    returnTo: back,
    items: [
      { href: base, label: "Overview", workspace: "person_record", capability: "openAPersonRecord" },
      { href: `${base}/care`, label: "Care", workspace: "person_record", capability: "openAPersonRecord" },
      { href: `${base}/course`, label: "Course", workspace: "person_record", capability: "openAPersonRecord" },
      { href: `${base}/sessions`, label: "Sessions", workspace: "person_record", capability: "openAPersonRecord" },
      { href: `${base}/thoughts`, label: "Notes", workspace: "person_record", capability: "openAPersonRecord" },
      { href: `${base}/safety`, label: "Safety", workspace: "person_record", capability: "openAPersonRecord" },
    ],
  };
}

/**
 * Which of the record's six sections owns each screen.
 *
 * THE SIX ARE THE AMENDMENT'S: Overview, Care, Course, Sessions, Notes,
 * Safety. Sixteen screens map onto them, and the mapping is here rather than
 * in the manifest because it is about this record's internal shape rather than
 * about navigation: the manifest declares six destinations, and this says which
 * one a reader is inside when they are on a screen that is not itself one of
 * the six.
 *
 * WHY EACH NON-OBVIOUS ONE:
 *
 *   /plan and /goals -> Care. The amendment puts "care plan, goals, assigned
 *   support, and handoffs" in Care, and moves goals out of Course explicitly:
 *   "keep goals in Care as the working location and allow Course to show a
 *   read-only progress summary that links back to the goal." A goal is set;
 *   a course is read.
 *
 *   /measures, /responses, /trajectory -> Course, which is the landing that
 *   holds them.
 *
 *   /note and /notes -> Notes. The draft assembly and the signed record are
 *   both note work; the route names stay because renaming a route breaks
 *   saved links.
 *
 *   /session/[sid] -> Sessions.
 *
 * AND THREE SCREENS DELIBERATELY BELONG TO NO SECTION. "Load, Full record, and
 * Audit remain available through named contextual links. They do not need equal
 * placement in the local navigation." They return null, no sidebar item is
 * selected while a reader is on one, and the contextual row below the identity
 * header carries the selected state instead. Putting Load under Safety was the
 * tempting alternative and it is the exact conflation UX 004 reports: Load
 * already links to Safety for an access hold while Safety says nothing is
 * pending, and filing readiness under restrictions would make that permanent.
 */
const SECTION: Record<string, string | null> = {
  "": "",
  "/care": "/care",
  "/plan": "/care",
  "/goals": "/care",
  "/course": "/course",
  "/measures": "/course",
  "/responses": "/course",
  "/trajectory": "/course",
  "/sessions": "/sessions",
  "/thoughts": "/thoughts",
  "/note": "/thoughts",
  "/notes": "/thoughts",
  "/safety": "/safety",
  "/load": null,
  "/record": null,
  "/audit": null,
};

export function sectionFor(slug: string): string | null {
  if (slug.startsWith("/session/")) return "/sessions";
  // An unclassified screen falls back to the overview, which is the safe
  // runtime answer and a BAD test answer: "" is a real section, so a guard
  // that only checked the return value would accept a screen nobody had
  // classified. `isClassified` is what the guard asks instead.
  return slug in SECTION ? SECTION[slug] : "";
}

/** Whether this screen has been placed in the record deliberately.
 *
 *  Separate from `sectionFor` because the two questions have different right
 *  answers: at runtime an unknown screen should still render inside the
 *  record, and in a test an unknown screen is the defect. */
export function isClassified(slug: string): boolean {
  return slug.startsWith("/session/") || slug in SECTION;
}

// ---------------------------------------------------------------------------
// Building a manifest
// ---------------------------------------------------------------------------

/**
 * The navigation for one person, right now.
 *
 * THE FILTER IS IN HERE AND CANNOT BE TURNED OFF. §1.1's ruling is not a
 * suggestion to callers: a destination whose capability is off does not appear
 * in `core`, full stop. There is no `includeUnavailable` option, because the
 * option would be used.
 */
/**
 * The member's destinations, without needing a member.
 *
 * NAVIGATION IS A FUNCTION OF THE AUDIENCE AND NOTHING ELSE, which is worth
 * stating where somebody can see it: `navigationFor` reads only `ctx.audience`
 * and `ctx.capabilities`, and `capabilitiesFor` takes the audience alone. Two
 * members never see different destinations.
 *
 * SO THE SHELL DOES NOT NEED A SESSION TO DRAW ITS OWN NAVIGATION. That is the
 * whole point of this helper: every member screen can carry the same row
 * without each of them first loading a person in order to be told the same
 * four words, and without the shell growing a database read that runs on every
 * page in the product.
 */
export function memberNavigation(): NavigationManifest {
  // NO PERSON AND NO TENANT, and the empty strings say so rather than
  // borrowing somebody's. Nothing below reads either field; a context carrying
  // a real id here would invite the next reader to think it mattered.
  return navigationFor({
    personId: "",
    tenantId: "",
    audience: "member",
    displayName: "",
    capabilities: capabilitiesFor("member"),
  });
}

export function navigationFor(
  ctx: ExperienceContext,
  args: { personId?: string | null; back?: { href: string; label: string } } = {}
): NavigationManifest {
  const declared = CORE[ctx.audience] ?? [];
  const core = declared.filter((d) => can(ctx, d.capability));

  const absent = declared
    .filter((d) => !can(ctx, d.capability))
    .map((d) => ({ label: d.label, reason: whyNot(ctx, d.capability) ?? "Not available here." }));

  return {
    audience: ctx.audience,
    core,
    local: args.personId && ctx.audience === "clinician" ? personLocal(args.personId, args.back) : null,
    utility: (UTILITY[ctx.audience] ?? []).filter((d) => can(ctx, d.capability)),
    absent,
  };
}

/**
 * Active-route matching (§9's fourth field).
 *
 * LONGEST MATCH WINS, and that is the whole subtlety. `/clinician/today` and
 * `/clinician` would both prefix-match a nested route, and a naive
 * `startsWith` would light up two items at once — which is how a sidebar ends
 * up with two selected states and a reader loses track of where they are. §8.2:
 * "Selected state uses icon, text, filled background, a left marker on desktop,
 * and aria-current. Hover alone never communicates location." Two markers is
 * the same failure as none.
 */
export function activeDestination(
  manifest: NavigationManifest, pathname: string
): NavDestination | null {
  const all = [...manifest.core, ...(manifest.local?.items ?? []), ...manifest.utility];
  let best: NavDestination | null = null;
  for (const d of all) {
    const exact = d.href === pathname;
    // A DESTINATION THAT CONTAINS ITS SIBLINGS OWNS ONLY ITS OWN PATH.
    //
    // Overview is the person record's root, so every other section of that
    // record — Care, Course, Sessions, Notes, Safety — is nested beneath its
    // address. Letting it match by nesting would make it the answer for every
    // screen in the record that no longer-named destination claims, which is
    // a selected state that is wrong rather than missing.
    //
    // It did not show while Course pointed at /measures: that href was longer
    // than Overview's and won on length for the one route anybody tested. The
    // amendment moved Course to its landing and the flaw became reachable from
    // /measures, /goals, /responses and /trajectory at once. The rule is the
    // fix rather than a longer list, because it holds for whatever gets added
    // beneath a record next.
    const nested = pathname.startsWith(`${d.href}/`) && !all.some(
      (o) => o !== d && o.href.startsWith(`${d.href}/`)
    );
    if (!exact && !nested) continue;
    if (!best || d.href.length > best.href.length) best = d;
  }
  return best;
}

/** Whether one destination should carry the selected state. */
export function isActive(
  manifest: NavigationManifest, pathname: string, href: string
): boolean {
  return activeDestination(manifest, pathname)?.href === href;
}

/** Every destination any manifest can declare, for the guards. */
export function declaredDestinations(): NavDestination[] {
  const out: NavDestination[] = [];
  for (const list of Object.values(CORE)) out.push(...(list ?? []));
  for (const list of Object.values(UTILITY)) out.push(...(list ?? []));
  out.push(...(personLocal("[id]")?.items ?? []));
  return out;
}

/** Routes the register knows and no manifest offers. Not a defect: most of the
 *  128 are reached from inside a workspace rather than from a sidebar. Exposed
 *  so a reviewer can see the difference between "not promoted" and "missing". */
export function unpromotedRoutes(): string[] {
  const promoted = new Set(declaredDestinations().map((d) => d.href));
  return ROUTE_REGISTER
    .filter((r) => !promoted.has(r.path))
    .map((r) => r.path);
}

/** Whether a declared destination points at a route that exists. */
export function destinationIsRegistered(href: string): boolean {
  return Boolean(routeEntry(href) ?? routeEntry(href.replace(/\/[^/]+$/, "/[id]")));
}
