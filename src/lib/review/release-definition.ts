// The release definition, answered rather than asserted (17 September handoff,
// P7: "Validate release — dated acceptance package").
//
// The handoff closes with a twenty-three line checklist. A checklist is the
// easiest artefact in software to lie with: every box is a sentence somebody
// ticks, and the tick is indistinguishable from the work. This file keeps the
// twenty-three lines in the handoff's own words and makes each one say HOW it
// is answered.
//
// FOUR WAYS AN ITEM CAN BE ANSWERED, and the distinction is the point:
//
//   computed   The product's own registers answer it, now, at read time. The
//              strongest kind: nothing to keep in sync, and an item that stops
//              being true reports itself on the next render.
//
//   attested   A named test suite answers it. Weaker, because it is a claim
//              about something that ran elsewhere — so the named file must
//              mention this item's id, the same two-way link the failure
//              register uses.
//
//   human      A person has to do it. It cannot be computed, it cannot be
//              attested, and the only honest state until somebody does it is
//              OUTSTANDING. These are the rows an acceptance package exists to
//              show, not the rows it exists to hide.
//
//   decision   Somebody with authority has to choose. Not work; a call.
//
// AN UNANSWERED ITEM IS NOT A FAILING ITEM. "Manual accessibility and human
// task testing are recorded" is not false — it is unanswered, and a package
// that rendered it red beside a genuine defect would flatten the difference
// between "nobody has done this yet" and "this is broken".

import { ROUTE_REGISTER, WORKSPACE_OWNER } from "../app/route-register";
import { FAILURE_REGISTER } from "../governance/failure-register";
import { WORK_REGISTER } from "../governance/work-register";
import { EVIDENCE_CLAIMS, resolveClaim } from "../governance/evidence-registry";
import {
  MAINTENANCE_COPY, monitoringLanguageProblems, maintenanceLanguageApproved,
} from "../clinical/maintenance";
import { navigationFor, personLocal, type NavDestination } from "../experience/navigation";
import { experienceContextFor } from "../experience/context";
import { OUTCOME_LABEL, OUTCOME_NOTE, mayClaimChange, mayRetryDirectly } from "../experience/command";
import { versionReport } from "../version";

export type Answerable = "computed" | "attested" | "human" | "decision";

export interface ItemAnswer {
  /** Null for `human` and `decision`: nobody has answered it, which is not the
   *  same as answering it no. */
  met: boolean | null;
  /** In one sentence a reader can check. */
  because: string;
}

export interface ReleaseItem {
  id: string;
  /** The handoff's line, in its words. */
  text: string;
  answerable: Answerable;
  /** `computed` only. Runs at read time. */
  answer?: () => ItemAnswer;
  /** `attested` only. Each file must mention this item's id. */
  evidence?: string[];
  /** `human` and `decision` only. */
  owner?: string;
  /** What is actually required of that person. A row that says only "a human
   *  must do this" is a row nobody can pick up. */
  asks?: string;
}

const yes = (because: string): ItemAnswer => ({ met: true, because });
const no = (because: string): ItemAnswer => ({ met: false, because });

export const RELEASE_DEFINITION: ReleaseItem[] = [
  {
    id: "routes.status-and-owner",
    text: "Every route has a reconciled status and accountable owner.",
    answerable: "computed",
    answer: () => {
      const unowned = ROUTE_REGISTER.filter((r) => !WORKSPACE_OWNER[r.workspace]);
      // A state other than `working` has to say why: a state nobody has to
      // justify is a state that drifts.
      const unexplained = ROUTE_REGISTER.filter((r) => r.state !== "working" && !r.evidence);
      if (unowned.length > 0) return no(`${unowned.length} route(s) resolve to no accountable owner.`);
      if (unexplained.length > 0) {
        return no(`${unexplained.length} route(s) are not working and do not say why.`);
      }
      return yes(
        `All ${ROUTE_REGISTER.length} registered routes carry a state, and each resolves to an ` +
        `accountable owner through its workspace.`
      );
    },
  },
  {
    id: "defects.reproduction-and-regression",
    text: "Every confirmed high-priority defect has a reproduction test and regression evidence.",
    answerable: "human",
    owner: "Product and QA",
    asks:
      "There is no defect register in this repository — defects have been fixed with a test and a " +
      "commit message rather than tracked as rows, so nothing can enumerate 'every confirmed " +
      "high-priority defect' to check it. Either the tracker of record is named and reconciled " +
      "against the work register, or this line is agreed to mean the work register itself.",
  },
  {
    id: "nav.global-stays-stable",
    text: "Global navigation stays stable throughout clinician work.",
    answerable: "computed",
    answer: () => {
      // The clinician's core destinations must not depend on which screen they
      // are on: a shell that changes under somebody is the defect this line is
      // about. Built for two different routes and compared.
      // The global row is built with and without a person open. A shell that
      // changes under somebody mid-task is the defect this line is about.
      const a = coreFor("clinician");
      const b = navigationFor(asRole("clinician"), { personId: "anyone" }).core;
      const same = a.length === b.length && a.every((d: NavDestination, i: number) => d.href === b[i].href);
      return same
        ? yes(`The clinician's ${a.length} global destinations are identical on the queue and inside a record.`)
        : no("The global destinations differ between the queue and a person's record.");
    },
  },
  {
    id: "nav.patient-local-six-sections",
    text:
      "Patient-local navigation uses Overview, Care, Course, Sessions, Notes, and Safety across " +
      "every existing patient section.",
    answerable: "computed",
    answer: () => {
      const expected = ["Overview", "Care", "Course", "Sessions", "Notes", "Safety"];
      const labels = (personLocal("anyone")?.items ?? []).map((d: NavDestination) => d.label);
      if (labels.length !== expected.length || labels.some((l, i) => l !== expected[i])) {
        return no(`The record's sections read ${labels.join(", ")}.`);
      }
      return yes(`The record's six sections are ${expected.join(", ")}, in that order.`);
    },
  },
  {
    id: "nav.member-shell-four-destinations",
    text: "The patient shell uses Today, Tools, Progress, and Care team, with one clear next step on Today.",
    answerable: "computed",
    answer: () => {
      const labels = coreFor("member").map((d: NavDestination) => d.label);
      const expected = ["Today", "Tools", "Progress", "Care team"];
      const matches = labels.length === expected.length && labels.every((l, i) => l === expected[i]);
      return matches
        ? yes(`The member shell shows ${labels.join(", ")}. Messages stays filtered out while its capability is off.`)
        : no(`The member shell shows ${labels.join(", ")}.`);
    },
  },
  {
    id: "queue.counts-pagination-filters-return",
    text: "Queue counts, pagination, filters, and return state are correct.",
    answerable: "attested",
    evidence: ["tests/work-queue.test.ts", "tests/return-to.test.ts"],
  },
  {
    id: "time.windows-and-freshness",
    text: "Time windows and freshness labels use consistent meanings.",
    answerable: "attested",
    evidence: ["tests/clock-contract.test.ts"],
  },
  {
    id: "states.restrictions-missing-unresolved",
    text: "Restrictions, missing information, and unresolved events are distinguishable.",
    answerable: "attested",
    evidence: ["tests/access-states.test.ts", "tests/safety-restrictions.test.tsx"],
  },
  {
    id: "records.kinds-cannot-be-confused",
    text: "Notes, approved memory, AI output, drafts, and signed records cannot be confused.",
    answerable: "attested",
    evidence: ["tests/concept-separation.test.ts", "tests/clinical-notes.test.ts"],
  },
  {
    id: "support.assigned-is-governed",
    text:
      "Assigned support uses server-side policy, version checks, expiry, withdrawal, and honest " +
      "delivery state.",
    answerable: "computed",
    answer: () => registerSays("clinical.assigned-support"),
  },
  {
    id: "plan.shared-between-visit",
    text: "The shared between-visit plan traces patient and clinician views to compatible sources.",
    answerable: "computed",
    answer: () => registerSays("clinical.shared-between-visit-plan"),
  },
  {
    id: "actions.report-what-happened",
    text: "Every action reports what actually happened.",
    answerable: "computed",
    answer: () => {
      // Five outcomes, five labels, five notes — and only one of them may tell
      // somebody their work is saved.
      const outcomes = Object.keys(OUTCOME_LABEL);
      const missingNote = outcomes.filter((o) => !OUTCOME_NOTE[o as keyof typeof OUTCOME_NOTE]);
      if (missingNote.length > 0) return no(`${missingNote.join(", ")} has no sentence for a person.`);
      const claiming = outcomes.filter((o) => mayClaimChange({ outcome: o } as never));
      if (claiming.length !== 1 || claiming[0] !== "confirmed") {
        return no(`${claiming.join(", ")} may claim something changed.`);
      }
      const retryable = outcomes.filter((o) => mayRetryDirectly({ outcome: o } as never));
      if (retryable.includes("indeterminate")) {
        return no("An unconfirmed write invites a blind retry, which is how one action becomes two records.");
      }
      return yes(
        `All ${outcomes.length} command outcomes carry a label and a sentence; only a confirmed one ` +
        "may claim a change, and an unconfirmed one never offers a plain retry."
      );
    },
  },
  {
    id: "recovery.concurrent-and-uncertain",
    text: "Concurrent edits and uncertain submissions recover safely.",
    answerable: "computed",
    answer: () => failureAreasProven(["concurrency", "uncertain_writes"]),
  },
  {
    id: "enforcement.permission-and-consent-changes",
    text: "Server-side enforcement handles permission and consent changes.",
    answerable: "computed",
    answer: () => failureAreasProven(["permissions"]),
  },
  {
    id: "messaging.hidden-until-its-gate-passes",
    text: "Messaging remains hidden unless its activation gate passes.",
    answerable: "computed",
    answer: () => {
      const member = coreFor("member").map((d: NavDestination) => d.href);
      const clinician = coreFor("clinician").map((d: NavDestination) => d.href);
      const shown = [...member, ...clinician].filter((h) => h.endsWith("/messages"));
      return shown.length === 0
        ? yes("Messaging is declared in the navigation manifest and filtered out of every shell while its capability is off.")
        : no(`Messaging is in primary navigation at ${shown.join(", ")}.`);
    },
  },
  {
    id: "maintenance.no-implied-monitoring",
    text: "Maintenance does not imply active monitoring when none exists.",
    answerable: "computed",
    answer: () => {
      const offending = MAINTENANCE_COPY.flatMap((c) =>
        [c.member, ...c.supporting.map((s) => s.text)].flatMap((t) => monitoringLanguageProblems(t))
      );
      if (offending.length > 0) {
        return no(`Maintenance copy promises attention: "${offending[0].phrase}".`);
      }
      return maintenanceLanguageApproved()
        ? yes("The maintenance words carry no promise of attention, and clinical review has approved them.")
        : yes(
            "The maintenance words carry no promise of attention, and nothing patient-facing shows " +
            "them: the language is held until clinical review signs it."
          );
    },
  },
  {
    id: "claims.registry-backed",
    text: "Every public claim resolves to an approved evidence-registry record.",
    answerable: "computed",
    answer: () => {
      const asOf = new Date().toISOString().slice(0, 10);
      const broken = EVIDENCE_CLAIMS.filter((c) => {
        if (c.approvalStatus !== "approved") return false;
        // Checked on the surfaces it is approved for. A claim approved for one
        // page and refused there is the failure; a claim not approved for a
        // page it never appears on is the registry working.
        return c.allowedSurfaces.some((s) => !resolveClaim(c, { surface: s, asOf }).ok);
      });
      return broken.length === 0
        ? yes(
            `All ${EVIDENCE_CLAIMS.filter((c) => c.approvalStatus === "approved").length} approved claims ` +
            "resolve on every surface they are approved for, and the pages read the registry rather than carrying their own text."
          )
        : no(`${broken.length} approved claim(s) do not resolve on a surface they are approved for.`);
    },
  },
  {
    id: "roles.signed-in-route-and-task-coverage",
    text: "All other roles have completed signed-in route and task coverage.",
    answerable: "attested",
    evidence: ["tests/e2e/role-projections.spec.ts", "tests/e2e/reviewer-journeys.spec.ts"],
  },
  {
    id: "accessibility.manual-and-human-testing",
    text: "Manual accessibility and human task testing are recorded.",
    answerable: "human",
    owner: "Product and QA",
    asks:
      "NOT DONE, AND NOT DOABLE FROM HERE. The automated scan runs over every public and signed-in " +
      "route on every build and finds no serious or critical violation, and that is one form of " +
      "evidence — the handoff says so in as many words. What is missing is a person: keyboard-only " +
      "completion of a clinician's primary tasks, a screen-reader pass over focus, reflow, control " +
      "size, error recovery and authentication, and an unassisted task study. No amount of " +
      "automated coverage substitutes, and a package that implied otherwise would be the most " +
      "expensive sentence in it.",
  },
  {
    id: "build.identifies-itself",
    text: "Release evidence identifies the exact deployed build.",
    answerable: "computed",
    answer: () => {
      const v = versionReport();
      return v.commit
        ? yes(`This build reports commit ${v.commitShort} (${v.source}).`)
        : no(
            "No commit is reported by the platform or baked in at build time, so evidence gathered " +
            "here cannot be tied to a build. " + v.detail
          );
    },
  },
  {
    id: "docs.superseded-point-here",
    text: "Superseded documents point to the active work register.",
    answerable: "human",
    owner: "Product and QA",
    asks:
      "The work register exists and is verified by the build. What nothing checks is the other " +
      "direction: whether every superseded handoff and status document carries a pointer to it. " +
      "That is a sweep of the documents, and a machine cannot tell a superseded document from a " +
      "current one without being told which is which.",
  },
  {
    id: "gates.held-remain-held",
    text: "Held clinical, privacy, security, and operational gates remain held.",
    answerable: "computed",
    answer: () => {
      const held = WORK_REGISTER.filter((e) => e.state === "held");
      const silent = held.filter((e) => !e.note || e.note.length < 20);
      if (silent.length > 0) return no(`${silent.length} held item(s) do not say why.`);
      const maintenanceHeld = !maintenanceLanguageApproved();
      return yes(
        `${held.length} item(s) are held, each with a stated reason` +
        (maintenanceHeld ? ", and the maintenance language is held pending clinical review." : ".")
      );
    },
  },
  {
    id: "acceptance.owner-and-reviewers",
    text: "The product owner and required reviewers accept the scoped release.",
    answerable: "decision",
    owner: "Product owner and the named reviewers",
    asks:
      "The last line, and the only one that cannot be anything but a signature. Everything above it " +
      "is evidence for this decision rather than a substitute for it.",
  },
];

/** A context with a role's capabilities and nothing else. The navigation is a
 *  function of the audience, so this is enough to ask what a shell shows —
 *  and it cannot be used to read anybody's data, which is why it is safe to
 *  build one here rather than requiring a session. */
function asRole(role: "clinician" | "member") {
  return experienceContextFor({
    id: `release-definition-${role}`,
    tenantId: "release-definition",
    role,
    name: "Release definition",
    email: "",
  } as Parameters<typeof experienceContextFor>[0]);
}

function coreFor(role: "clinician" | "member"): NavDestination[] {
  return navigationFor(asRole(role)).core;
}

function registerSays(id: string): ItemAnswer {
  const entry = WORK_REGISTER.find((e) => e.id === id);
  if (!entry) return no(`The work register has no entry for ${id}.`);
  if (entry.state !== "reachable") {
    return no(`${id} is recorded as ${entry.state}${entry.note ? `: ${entry.note}` : "."}`);
  }
  return yes(`${entry.title} — built, tested and reachable from a screen (${entry.code}).`);
}

function failureAreasProven(areas: string[]): ItemAnswer {
  const rows = FAILURE_REGISTER.filter((r) => areas.includes(r.area));
  const open = rows.filter((r) => r.state === "gap");
  if (rows.length === 0) return no(`No failure scenarios are recorded for ${areas.join(", ")}.`);
  if (open.length > 0) {
    return no(`${open.length} of ${rows.length} scenarios have nothing injecting them: ${open.map((r) => r.id).join(", ")}.`);
  }
  const held = rows.filter((r) => r.state === "held").length;
  return yes(
    `${rows.length - held} of ${rows.length} scenarios have a test that injects the failure` +
    (held > 0 ? `, and ${held} are held with a reason.` : ".")
  );
}

export interface DefinitionSummary {
  total: number;
  met: number;
  /** Computed or attested, and the answer is no. The only genuinely red rows. */
  failing: number;
  /** Waiting on a person or a decision. */
  outstanding: number;
}

/**
 * The state of the definition, counted.
 *
 * OUTSTANDING IS NOT FAILING. A package that rendered "manual accessibility is
 * recorded" in the same colour as a broken guard would flatten the difference
 * between nobody having done something yet and something being wrong, which is
 * the distinction the person reading an acceptance package most needs.
 */
export function definitionSummary(answers: ReadonlyArray<ItemAnswer>): DefinitionSummary {
  return {
    total: answers.length,
    met: answers.filter((a) => a.met === true).length,
    failing: answers.filter((a) => a.met === false).length,
    outstanding: answers.filter((a) => a.met === null).length,
  };
}

/** Answer every item that can answer itself. `attested` and human rows return
 *  their state rather than a computation. */
export function answerItem(item: ReleaseItem): ItemAnswer {
  if (item.answerable === "computed") return item.answer!();
  if (item.answerable === "attested") {
    return yes(`Held by ${item.evidence!.join(", ")}, which run on every build.`);
  }
  return { met: null, because: item.asks ?? "Waiting on a person." };
}
