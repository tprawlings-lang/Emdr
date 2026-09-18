// The reviewer console's three questions, answered (17 September handoff, P5).
//
//   "Blockers and requested decisions before passed evidence. Keep version and
//   attestation visible."
//
// THE LANDING HAD THE ORDER EXACTLY BACKWARDS. It opened with "Available now" —
// thirteen screens a reviewer could go and look at — and put the queue of
// things actually waiting on a decision underneath. A reviewer arriving to find
// out what is blocking a release read a catalogue first.
//
// And the third question was not answerable at all: what passed, and under
// WHICH VERSION. The gates carry a fingerprint over the facts they were judged
// against, precisely so an attestation can go stale when the evidence moves —
// and the landing never said how many were standing, nor against what build.

import {
  blockers, releaseScope, BLOCKER_LABEL, type GateRow,
} from "../review/release-readiness";
import {
  questionsFor, assertTraceable, type TracedAnswer,
} from "./opening-questions";

export interface ReviewerInputs {
  gates: readonly GateRow[];
  /** Access requests nobody has answered. */
  accessRequestsOpen: number;
  /** Member-facing surfaces not approved at the current copy version. */
  copyUnapproved: { n: number; of: number };
  copyVersion: string;
}

/** The three, in the handoff's order: what blocks, what is waiting, what passed. */
export function reviewerAnswers(i: ReviewerInputs): TracedAnswer[] {
  const [qBlocks, qDecide, qPassed] = questionsFor("reviewer");
  return [blocksAnswer(i, qBlocks), decideAnswer(i, qDecide), passedAnswer(i, qPassed)];
}

function blocksAnswer(i: ReviewerInputs, q: ReturnType<typeof questionsFor>[number]): TracedAnswer {
  const open = blockers(i.gates);
  const scope = releaseScope();
  const byKind = new Map<string, number>();
  for (const b of open) byKind.set(b.kind, (byKind.get(b.kind) ?? 0) + 1);
  const named = [...byKind.entries()]
    .map(([kind, n]) => `${n} ${BLOCKER_LABEL[kind as keyof typeof BLOCKER_LABEL].toLowerCase()}`)
    .join(", ");

  return assertTraceable({
    questionId: q.id,
    question: q.question,
    answer:
      open.length === 0
        ? `No gate is blocking. All ${i.gates.length} have passing evidence with a decision in force at the current fingerprint.`
        // THE KINDS, NOT JUST THE COUNT. "Evidence is failing" and "nobody has
        // decided" both stop a release and need entirely different people.
        : `${open.length} of ${i.gates.length} gates are blocking: ${named}.`,
    figure: `${open.length} / ${i.gates.length}`,
    denominator: `${i.gates.length} release gates.`,
    window: `Evidence gathered ${scope.evidenceDate}, at commit ${scope.commit}.`,
    missingness:
      "A gate whose check has not been run counts as blocking rather than as passing. Unavailable " +
      "evidence is not absence of a problem.",
    definition:
      "A gate blocks when its evidence fails, a reviewer blocked it, its approval reopened because " +
      "the evidence moved, its check has not run, or nobody has decided.",
    evidenceHref: "/review/release",
    evidenceLabel: "Open the release gates",
  });
}

function decideAnswer(i: ReviewerInputs, q: ReturnType<typeof questionsFor>[number]): TracedAnswer {
  const undecided = blockers(i.gates).filter((b) => b.kind === "undecided" || b.kind === "reopened");
  const waiting = undecided.length + i.accessRequestsOpen + i.copyUnapproved.n;
  return assertTraceable({
    questionId: q.id,
    question: q.question,
    answer:
      waiting === 0
        ? "Nothing is waiting on a person."
        : `${waiting} thing${waiting === 1 ? "" : "s"} need a human decision: ` +
          [
            undecided.length > 0 ? `${undecided.length} gate${undecided.length === 1 ? "" : "s"} undecided or reopened` : null,
            i.accessRequestsOpen > 0 ? `${i.accessRequestsOpen} access request${i.accessRequestsOpen === 1 ? "" : "s"}` : null,
            i.copyUnapproved.n > 0 ? `${i.copyUnapproved.n} of ${i.copyUnapproved.of} member-facing surfaces unapproved at ${i.copyVersion}` : null,
          ].filter(Boolean).join(", ") + ".",
    figure: String(waiting),
    denominator:
      `${i.gates.length} gates, plus access requests and ${i.copyUnapproved.of} member-facing surfaces.`,
    window: "Now. A decision is counted as waiting until somebody records one.",
    missingness:
      "Counted from the decision record, not from a notification channel. Nothing here knows " +
      "whether anybody was told.",
    definition:
      "A decision nobody has recorded, or one recorded against evidence that has since moved. " +
      "Both need a person; neither is a failing check.",
    evidenceHref: "/review/release",
    evidenceLabel: "Open the release gates",
  });
}

/**
 * Gates that are clear: approved at the current fingerprint and not blocking.
 *
 * NOT "status === pass AND approved", which is what this counted first and
 * which undercounts. Three of the eight gates are attestations by nature —
 * authorization, accessibility, analytics integrity — and their evidence comes
 * back `unavailable` because there is nothing for a machine to check. A
 * reviewer who has signed one has cleared it, and a console reporting "1 of 8
 * passed" while three more stand on a signature is describing its own evidence
 * plumbing rather than the release. The handoff asks for attestation to stay
 * visible, which means counted, not merely mentioned.
 */
export function standingGates(gates: readonly GateRow[]): {
  clear: GateRow[]; byMachine: GateRow[]; byAttestation: GateRow[];
} {
  const blocking = new Set(blockers(gates).map((b) => b.gateId));
  const clear = gates.filter((g) => !blocking.has(g.gateId) && g.inForce?.decision === "approved");
  return {
    clear,
    byMachine: clear.filter((g) => g.status === "pass"),
    byAttestation: clear.filter((g) => g.status !== "pass"),
  };
}

function passedAnswer(i: ReviewerInputs, q: ReturnType<typeof questionsFor>[number]): TracedAnswer {
  const scope = releaseScope();
  const { clear, byMachine, byAttestation } = standingGates(i.gates);
  return assertTraceable({
    questionId: q.id,
    question: q.question,
    answer:
      `${clear.length} of ${i.gates.length} gates ${clear.length === 1 ? "is" : "are"} clear at commit ` +
      `${scope.commit} in the ${scope.environment.toLowerCase()} environment: ` +
      `${byMachine.length} on evidence a machine checked, ` +
      `${byAttestation.length} on a reviewer's attestation alone.`,
    figure: `${clear.length} / ${i.gates.length}`,
    denominator: `${i.gates.length} release gates.`,
    // THE VERSION IS THE ANSWER, not a footnote to it. "What passed" without
    // "under which version" is the sentence that lets a stale attestation
    // travel.
    window: `Commit ${scope.commit}, evidence gathered ${scope.evidenceDate}. Scope: ${scope.scope}.`,
    missingness:
      "A gate approved against an earlier fingerprint is not counted here. Its approval is real " +
      "and is about a build this is not.",
    definition:
      "An approval recorded at the current fingerprint, with nothing blocking. Some gates clear on " +
      "machine-checked evidence and some on a signature; both are counted and the split is said, " +
      "because a gate standing on a signature is a different thing to rely on.",
    evidenceHref: "/review/release",
    evidenceLabel: "Open the release gates",
  });
}
