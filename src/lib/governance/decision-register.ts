// The questions waiting on a person.
//
// NEITHER REGISTER COULD SAY THIS. The work register has `proposed` (decided,
// not built) and `held` (deliberately not finished); the failure register has
// `gap`. All three describe the STATE OF THE WORK, and none of them says "this
// is not moving because nobody has answered a question" — so a decision waiting
// on somebody looked exactly like work nobody had got to, and the difference is
// the only thing that tells you whether building harder would help.
//
// THREE THINGS EACH ENTRY HAS TO CARRY, and the third is the one usually
// missing from a list of open questions:
//
//   THE QUESTION, in words somebody outside the codebase can answer. "Should
//   `CONTACT_LEDGER_ACTIONS` include `record_thought`" is not a question a
//   clinical lead can answer; "should the product be able to record that a
//   clinician wrote a note between visits" is the same question, askable.
//
//   WHAT IT BLOCKS, by id, checked against the registers so a decision cannot
//   go on claiming to block something that shipped.
//
//   WHAT HAPPENS MEANWHILE. An unanswered question always has a current
//   behaviour, and leaving it unsaid is how a default becomes a decision
//   nobody took. Every entry below states what the product does today, so a
//   reader can decide whether the wait is costing anything.
//
// ANSWERED ONES STAY. A decision that vanishes when it is taken leaves the code
// carrying a rationale nobody can find, and the next person re-opens it. The
// answer and its date sit beside the question.

export type DecisionState =
  /** Waiting on a person. */
  | "open"
  /** Answered. The entry keeps the question, the answer and when. */
  | "answered";

/** Who the question is for. Not a name — a role, because the name changes and
 *  the accountability does not. */
export type DecisionAudience =
  | "clinical"
  | "product"
  | "operations"
  | "security"
  | "design";

export const AUDIENCE_LABEL: Record<DecisionAudience, string> = {
  clinical: "Clinical lead",
  product: "Product owner",
  operations: "Service operations",
  security: "Security and privacy",
  design: "Design",
};

/**
 * One way the question could be answered.
 *
 * WRITTEN FOR THE PERSON DECIDING, NOT THE PERSON BUILDING. A choice offered as
 * "use `MINUTES` everywhere" cannot be weighed by a clinical lead, and a sheet
 * they cannot weigh comes back unsigned or, worse, signed without being read.
 * So each option carries what it MEANS in ordinary words and what would
 * actually change — and a test refuses an option that names a file, a symbol or
 * a table, because that is the tell that it was written for the author.
 */
export interface DecisionOption {
  /** The choice, in a few words. */
  label: string;
  /** What it means, to somebody who has never seen the code. */
  plainly: string;
  /** What would actually change if this is picked. Including "nothing", which
   *  is a real answer and the one most often left off a list of options. */
  then: string;
  /** Marked on the sheet. A recommendation is not a decision, and saying which
   *  way the evidence points is more useful than pretending to be neutral —
   *  but only one option may carry it, or it is not a recommendation. */
  recommended?: true;
}

export interface Decision {
  id: string;
  /** In words somebody outside the codebase can answer. */
  question: string;
  audience: DecisionAudience;
  /** Register or release-definition ids this is holding up. Checked. */
  blocks: readonly string[];
  /** What the product does while nobody has answered. Always something. */
  meanwhile: string;
  state: DecisionState;
  /** ISO date the question was first put. */
  asked: string;
  /** The ways it could be answered. Open decisions carry at least two —
   *  a question with one option is a notification. */
  options: readonly DecisionOption[];
  /** Set when answered: what was decided, and on what date. */
  answer?: { decided: string; on: string };
  /**
   * Still needed from a person, even though the question is answered.
   *
   * A DECISION AND AN INPUT ARE DIFFERENT THINGS, and collapsing them would
   * make this register lie in the most comfortable direction: "who signs each
   * gate" is answered — one named person each — and three names are still
   * missing, so a count of open questions reading zero would say nothing is
   * needed when something plainly is. The answer is not in doubt; the
   * information to act on it has not arrived.
   */
  outstanding?: string;
}

export const DECISION_REGISTER: Decision[] = [
  // ---- Open ---------------------------------------------------------------
  {
    id: "gates.who-signs",
    question:
      "Who signs each of the three release gates a machine cannot check — that no role can reach " +
      "data outside its scope, that no keyboard or screen-reader path is blocked, and that the " +
      "numbers are what the records say? A name and an address for each.",
    audience: "security",
    // BLOCKS NOTHING FILED, and the check above caught that on its first run.
    // The mechanism shipped: a named owner is enforced at the door wherever one
    // is set. What is missing is three names, which is configuration a person
    // supplies rather than work anybody is waiting to do.
    blocks: [],
    meanwhile:
      "Any account with review access can sign any of the three, and the release console says so " +
      "in those words — the absence of a decision rather than a decision. Every signature records " +
      "who made it, with a date and a reference to the evidence, so it is auditable after the " +
      "fact even while anybody can make it. Naming somebody tightens it immediately; no code " +
      "changes.",
    options: [
      {
        label: "Name one person for each check",
        plainly:
          "You give three names and email addresses. From then on, only the named person can sign " +
          "their own check — the button refuses anybody else and tells them who to ask.",
        then:
          "Nothing in the product changes except who the button accepts. Add the three names to " +
          "the owner list; no code is written.",
        recommended: true,
      },
      {
        label: "Name one person for all three",
        plainly:
          "One person is accountable for all three checks. Simpler to arrange, and it means one " +
          "person is asserting that the screens work with a screen reader, that nobody can reach " +
          "data they should not, and that the numbers are right.",
        then: "Same as above with one name instead of three.",
      },
      {
        label: "Leave it open to any reviewer",
        plainly:
          "Anybody with review access can sign any of the three. Every signature still records who " +
          "made it, on what date, and where the evidence is — so it can be followed up afterwards, " +
          "just not directed beforehand.",
        then:
          "Nothing changes. The release screen goes on saying that no individual is named, so " +
          "nobody mistakes the absence of a rule for a rule.",
      },
    ],
    state: "answered",
    answer: {
      decided:
        "A — one named person per check — and the three names are SHELVED, decided 23 September. " +
        "The mechanism is built and stays built: where a name is set, only that person's signature " +
        "is accepted and everybody else is told who to ask. No name has been invented to fill the " +
        "gap and a test keeps it that way, so until names are given any reviewer may sign and the " +
        "console says so on screen. THIS DOES NOT HOLD ANYTHING SHUT: an unnamed gate is signable " +
        "today, so shelving the names delays accountability for who signs, not the signing itself. " +
        "Revisit when the reviewing individuals are appointed.",
      on: "2026-09-23",
    },
    asked: "2026-09-23",
  },
  {
    id: "clinical.activity-durations",
    question:
      "How long does each activity take, and should a clinician see a different figure from the " +
      "member? Two lists disagree for six of eleven activities, and BOTH are shown to members on " +
      "different screens — Calm place reads 15–20 min on Modules and about 10 minutes on Today.",
    audience: "clinical",
    blocks: ["experience.one-duration-per-activity"],
    meanwhile:
      "A member can see two different figures for the same activity depending on which screen " +
      "they are on. Nothing crashes and nothing is unsafe; it reads as carelessness, which on a " +
      "clinical product is its own cost.",
    options: [
      {
        label: "Use the shorter figures everywhere",
        plainly:
          "A member is told Calm place takes about 10 minutes, on every screen, and a clinician " +
          "sees the same. The shorter numbers win.",
        then:
          "Members see no change on the screen they use most; the longer ranges disappear from the " +
          "four screens that currently show them.",
      },
      {
        label: "Use the longer ranges everywhere",
        plainly:
          "A member is told Calm place takes 15 to 20 minutes, on every screen. The longer ranges " +
          "win.",
        then:
          "Members start seeing a range where they used to see a single number, on the screen they " +
          "use most. That is a change to words a patient reads, so it would go through the clinical " +
          "copy review.",
      },
      {
        label: "Two figures that mean different things",
        plainly:
          "The guided session is 15 to 20 minutes including settling and closing; the piece " +
          "assigned for today is the 10-minute core. Both shown, each labelled so nobody reads " +
          "them as contradicting.",
        then:
          "Only honest if the assigned piece really is shorter, which nothing currently records — " +
          "somebody would have to confirm it activity by activity.",
      },
      {
        label: "Sit down with all eleven and set them",
        plainly:
          "Neither list is trusted. A clinician goes through all eleven activities and says how " +
          "long each takes, once.",
        then:
          "The most work and the only option that ends with one number nobody has to reconcile " +
          "later. Six of the eleven currently disagree.",
        recommended: true,
      },
    ],
    state: "answered",
    answer: {
      decided:
        "Shelved. The set of activities may change — modules added — so settling eleven numbers now " +
        "would be settling a list that is about to move. The two disagreeing lists stay, and a " +
        "member can still see two figures for the same activity on different screens; that is a " +
        "known cost of waiting rather than an oversight. Revisit when the module set is settled.",
      on: "2026-09-23",
    },
    asked: "2026-09-19",
  },
  {
    id: "clinical.unwritten-care-actions",
    question:
      "Should the product be able to record that a clinician wrote a note between visits, opened " +
      "session preparation, read a trajectory, or adjusted a plan link? Four of the eight care " +
      "actions name things nothing writes and two would show on no screen.",
    audience: "clinical",
    blocks: ["clinical.unreachable-care-actions"],
    meanwhile:
      "The four words stay in the closed vocabulary and read like built features. The seed is " +
      "forbidden from writing them, so nothing fabricates evidence of a workflow that does not " +
      "exist. Decided 19 September to shelf this until the 17 September handoff is finished.",
    options: [
      {
        label: "Delete the four words",
        plainly:
          "The list of things a clinician can be recorded as having done shrinks from eight to " +
          "four — the four that actually happen. Nothing is lost, because nothing ever used them.",
        then:
          "Smallest change, and nothing can be recorded in a shape no screen shows. Reversible if " +
          "you later want one back.",
      },
      {
        label: "Build all four",
        plainly:
          "Each becomes something a clinician can actually do and see: recording a thought between " +
          "visits, opening session preparation, reading a trajectory, adjusting a plan link.",
        then:
          "The largest option. I would want to know what each is FOR before starting — a feature " +
          "built from a word in a list tends to be a feature nobody uses.",
      },
      {
        label: "Leave them shelved",
        plainly:
          "Nothing happens until the current handoff is finished, then it comes back. This is what " +
          "you chose on 19 September.",
        then:
          "The four words stay in the list and read like features that exist. The seed is barred " +
          "from writing them, so nothing fabricates evidence of a workflow that is not there.",
        recommended: true,
      },
    ],
    state: "answered",
    answer: {
      decided:
        "B — build all four. A clinician should be able to record a thought between visits, that " +
        "they prepared for a session, that they read somebody's trajectory, and that they adjusted " +
        "a plan link, and each should show on the person's record. This reverses the 19 September " +
        "decision to shelf them, which is recorded rather than overwritten. ALL FOUR ARE BUILT as " +
        "of 24 September; the fourth needed a feature rather than a writer, and what a plan link " +
        "is was settled separately below.",
      on: "2026-09-23",
    },
    asked: "2026-09-19",
  },
  {
    id: "ops.unclaimed-work-escalation",
    question:
      "When work has no clinician, after how long should it escalate, and to whom? This is about " +
      "how the service is run rather than how the product is built, and a default chosen here " +
      "would be this codebase inventing a duty-of-care rule.",
    audience: "operations",
    blocks: ["presentation.unassigned-work-accumulates"],
    meanwhile:
      "Nothing escalates, and the Command Center says so beside the count: how many items are " +
      "unclaimed, across how many people, and how long the oldest has waited — with no threshold " +
      "and no caution colour, because either would imply a deadline nobody agreed.",
    options: [
      {
        label: "A named person reviews the list daily",
        plainly:
          "Nothing moves on its own. Somebody — a duty clinician, a team lead — looks at the " +
          "unclaimed list once a day and assigns what is there.",
        then:
          "No code changes; the count is already on the clinician's home screen. What it needs is " +
          "somebody whose job it is.",
        recommended: true,
      },
      {
        label: "After a set number of days it goes to a named supervisor",
        plainly:
          "Work nobody has picked up for, say, three days automatically becomes one named " +
          "person's responsibility. You choose the number of days and the person.",
        then:
          "Real work: the rule, the assignment, and a way for that person to see what landed on " +
          "them. Nobody is notified — this build has no way to send anything.",
      },
      {
        label: "After a set number of days it goes to whoever is on duty",
        plainly:
          "Same, but it lands with whoever is covering that day rather than one fixed person.",
        then:
          "More work than the above, because the product has no concept of who is on duty. That " +
          "would have to be built first.",
      },
      {
        label: "Leave it as it is",
        plainly:
          "The unclaimed count stays visible with no deadline attached, and nobody is chased.",
        then:
          "Nothing changes. The screen says plainly that nothing escalates, so the absence is " +
          "visible rather than assumed.",
      },
    ],
    outstanding:
      "Who reviews the unclaimed list each day. The product needs nothing; the rota does.",
    state: "answered",
    answer: {
      decided:
        "A — a named person reviews the unclaimed list daily and assigns what is there. Nothing " +
        "escalates automatically, which is now a chosen operating control rather than an absent " +
        "rule. No code changes: the count, the number of people behind it and the age of the oldest " +
        "are already on the clinician's home screen. WHO that person is remains an operational " +
        "appointment.",
      on: "2026-09-23",
    },
    asked: "2026-09-19",
  },
  {
    id: "clinical.assignment-and-access",
    question:
      "Should being somebody's assigned clinician restrict who may act on them? The caseload model " +
      "is `hybrid` today: a named owner carries accountability and anyone in the tenant may still " +
      "act. Switching to `owned` would make the assignment a gate.",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Assignment records accountability and changes nothing about access, so a member in an " +
      "Immediate band never waits for one person to come back from leave. Acting on somebody " +
      "else's patient is now visible as coverage, which it could not be before, because nobody " +
      "had a patient.",
    options: [
      {
        label: "Anyone on the team may act",
        plainly:
          "Being somebody's clinician records who is accountable, and does not stop a colleague " +
          "from helping. If a member is in crisis and their clinician is on leave, whoever is " +
          "there can act, and the record shows it was cover.",
        then: "Nothing changes. This is how it works today.",
        recommended: true,
      },
      {
        label: "Only the assigned clinician may act",
        plainly:
          "A member's own clinician is the only person who can review or act on them. Anybody else " +
          "has to formally take the person over first.",
        then:
          "A real clinical risk to weigh: somebody in an Immediate band waits until their own " +
          "clinician is back, or until a handover is completed. That is the trade this option buys.",
      },
      {
        label: "Only the assigned clinician, with an emergency override",
        plainly:
          "As above, but anybody can step in for an urgent case by saying why, and that is recorded " +
          "and visible afterwards.",
        then:
          "The most work of the three, and the usual answer in clinical software. Needs a rule for " +
          "what counts as urgent enough.",
      },
    ],
    state: "answered",
    answer: {
      decided:
        "A — anyone on the team may act. Being somebody's clinician records who is accountable and " +
        "does not gate access, so a member in an Immediate band never waits for one person to come " +
        "back from leave, and stepping in is recorded as cover. No change: this is what the product " +
        "already does, now deliberately rather than by default.",
      on: "2026-09-23",
    },
    asked: "2026-09-23",
  },
  {
    id: "experience.command-center-layout",
    question:
      "On the busiest clinician screen: should a row's detail stay beside the list or move below " +
      "it, and should the one-line orienting sentence move above the counts? Both are defensible " +
      "and they produce visibly different screens.",
    audience: "design",
    blocks: ["experience.command-center-template"],
    meanwhile:
      "The Command Center keeps its own layout: detail beside the list at wide widths and a " +
      "dedicated detail view below it on a phone, with the orienting sentence after the counts.",
    options: [
      {
        label: "Leave the screen as it is",
        plainly:
          "Opening a row shows its detail beside the list on a laptop, and as its own screen on a " +
          "phone. The one-line summary stays under the counts.",
        then: "Nothing changes.",
        recommended: true,
      },
      {
        label: "Move the detail below the list",
        plainly:
          "Opening a row pushes its detail underneath the list instead of beside it, which is how " +
          "the other work screens behave. More consistent; the list and the detail are no longer " +
          "visible at once.",
        then:
          "A rebuild of the busiest clinician screen. Worth doing only if the consistency is worth " +
          "losing the side-by-side view.",
      },
      {
        label: "Move the summary line to the top",
        plainly:
          "The sentence saying what you are looking at moves above the counts, so it is the first " +
          "thing read rather than the fourth.",
        then:
          "Small change, and it can be taken on its own without the one above.",
      },
    ],
    state: "answered",
    answer: {
      decided:
        "B — the row's detail moves below the list rather than beside it, matching every other work " +
        "screen. The list and the detail are no longer visible at once, which is the cost. The " +
        "orienting sentence stays where it is: that was a separate option and was not chosen.",
      on: "2026-09-23",
    },
    asked: "2026-09-19",
  },
  {
    id: "release.human-evidence",
    question:
      "Four release lines only a person can answer: has anybody operated the product with a " +
      "keyboard and a screen reader and written down what happened; is there a defect register, " +
      "and does every confirmed high-priority defect have a reproduction test; has somebody made " +
      "each superseded document point at the current record; and do the product owner and " +
      "reviewers accept the scoped release?",
    audience: "product",
    blocks: [
      "accessibility.manual-and-human-testing",
      "defects.reproduction-and-regression",
      "docs.superseded-point-here",
      "acceptance.owner-and-reviewers",
    ],
    meanwhile:
      "The release console reports each as unanswered rather than assuming it. The accessibility " +
      "one is now on the critical path for more than the checklist: it is one of the gates the " +
      "environment policy requires before a real participant may be admitted.",
    options: [
      {
        label: "Put a name and a date against each of the four",
        plainly:
          "For each one — the screen-reader walkthrough, the defect list, the old documents, the " +
          "final acceptance — you say who does it and by when. They are jobs, not decisions.",
        then:
          "The accessibility one is the urgent one: until somebody has operated the product with a " +
          "keyboard and a screen reader and signed that off, real participants cannot be enrolled " +
          "at all.",
        recommended: true,
      },
      {
        label: "Do the accessibility one now, the rest later",
        plainly:
          "Only the screen-reader walkthrough is scheduled, because it is the one holding " +
          "enrollment shut. The other three wait.",
        then:
          "Unblocks the pilot. The release checklist stays incomplete and says so.",
      },
      {
        label: "Tell me there is no defect register",
        plainly:
          "One of the four asks whether every confirmed serious defect has a test that reproduces " +
          "it. If defects are not tracked anywhere, that line cannot be answered and should say so " +
          "rather than sit open.",
        then:
          "I record it as not applicable with the reason, instead of it reading as a job nobody " +
          "has done.",
      },
    ],
    outstanding:
      "A name and a date for each of the four jobs. The screen-reader walkthrough is the one that " +
      "matters today: it is a gate the environment policy requires, so real enrolment stays shut " +
      "until somebody has done it and signed it off.",
    state: "answered",
    answer: {
      decided:
        "A — a name and a date against each of the four. They are jobs rather than decisions. THE " +
        "NAMES AND DATES ARE STILL OUTSTANDING. The accessibility walkthrough is the urgent one: " +
        "it is a gate the environment policy requires, so until somebody has operated the product " +
        "with a keyboard and a screen reader and signed that off, no real participant can be " +
        "enrolled at all.",
      on: "2026-09-23",
    },
    asked: "2026-09-17",
  },

  // ---- Answered -----------------------------------------------------------
  {
    id: "governance.permitted-data-classes",
    question:
      "Is this a pilot with real people or a demonstration with fabricated data? Some wording says " +
      "pilot account and other wording says everything here is fabricated, and both cannot be true.",
    audience: "product",
    blocks: ["governance.environment-policy"],
    meanwhile:
      "Before the answer, nothing said which state a deployment was in and a reader inferred it " +
      "from a banner.",
    options: [
      { label: "Fabricated data only", plainly: "Nothing about a real person may ever be typed in, stored, shown or exported here — not even a real member of staff.", then: "Would have removed the pilot wording entirely. Not chosen." },
      { label: "Real participants, once the safety checks pass", plainly: "The pilot exists for real people with their consent, and no environment admits one until the checks that protect them have been signed off by somebody accountable.", then: "What was chosen. The environment now reports which state it is in, read from live facts rather than asserted.", recommended: true },
      { label: "Real participants now", plainly: "Open enrolment to real people immediately, without waiting for the protective checks to be signed.", then: "Not chosen. Would have needed confirmation of which checks had actually passed and who signed them." },
    ],
    state: "answered",
    asked: "2026-09-17",
    answer: {
      decided:
        "Real consented participants are what the pilot is FOR, and no environment takes one " +
        "until the gates that protect them pass. Two tiers, with the current one read from live " +
        "facts rather than declared.",
      on: "2026-09-19",
    },
  },
  {
    id: "clinical.standing-caseload",
    question:
      "Should the system know that a person is a particular clinician's patient, as a standing " +
      "fact? The field called primary clinician was whoever last decided a module-unlock request.",
    audience: "clinical",
    blocks: ["clinical.caseload-assignment"],
    meanwhile: "Before the answer, every row read Unassigned and no caseload could be named.",
    options: [
      { label: "Build it", plainly: "A person is assigned to a named clinician, and it stays that way until somebody changes it, with a record of who held them before.", then: "What was chosen. Every screen now names the clinician, and unclaimed work fell from 34 of 39 items to 3.", recommended: true },
      { label: "Keep per-task ownership only", plainly: "Somebody owns an individual piece of work, and nobody is ever recorded as looking after a person overall.", then: "Not chosen. Nobody could have answered \"who is my clinician\"." },
      { label: "Leave it and document it", plainly: "Change nothing in the product, and write down clearly that the system cannot say who looks after whom.", then: "Not chosen. Would have left every row reading as though nobody was responsible." },
    ],
    state: "answered",
    asked: "2026-09-19",
    answer: {
      decided:
        "Build it. A person is assigned to a named clinician and it stays until somebody changes " +
        "it, with the history kept. Accountability rather than access.",
      on: "2026-09-23",
    },
  },
  {
    id: "governance.gate-result-expiry",
    question:
      "When should a recorded gate result stop counting — on a clock, or when the thing it was " +
      "measured against changes?",
    audience: "product",
    blocks: ["governance.resolved-gate-results"],
    meanwhile: "Before the answer, two gates could not be part of the pilot check at all.",
    options: [
      { label: "Expire when the thing checked changes", plainly: "A completed check stays valid for as long as the thing it examined has not moved, and stops counting the moment it does.", then: "What was chosen. Nobody has to remember to re-run anything, and nothing expires while nothing has changed.", recommended: true },
      { label: "Expire on a timer", plainly: "A completed check goes stale after a set number of days, whether or not anything it examined has actually changed.", then: "Not chosen. It would shut the pilot overnight with nothing having happened, teaching people to re-run checks without reading them." },
    ],
    state: "answered",
    asked: "2026-09-23",
    answer: {
      decided:
        "On change, with no time cap. A result expiring on a timer closes the pilot tier overnight " +
        "with nothing having changed, which teaches an operator to re-run a check they have no " +
        "reason to believe is stale.",
      on: "2026-09-23",
    },
  },
  {
    id: "clinical.what-a-plan-link-is",
    question:
      "When the record says a clinician adjusted a plan link, what has actually been adjusted? The " +
      "words have been in the product's vocabulary since it was written and nothing in it had a " +
      "link on a plan, so the sentence described something that did not exist.",
    audience: "clinical",
    blocks: ["clinical.plan-link"],
    meanwhile:
      "Nothing wrote the words, so the record could never say it. The gap showed on the shared " +
      "plan: a person saw what they had said they wanted, and underneath it a list of what they " +
      "had been asked to do, with nothing joining the two.",
    options: [
      {
        label: "The goal a piece of work is meant to move",
        plainly:
          "Each thing a person is asked to do between visits names which of their own goals it is " +
          "for. Adjusting the link means saying that this exercise is now working towards a " +
          "different goal, or towards none.",
        then:
          "The person sees what their homework is for, in their own words, on the same screen that " +
          "asks them to do it. The clinician sees the goal and what state it is in. Nothing else " +
          "in the product moves, because the connection is one more fact about the thing that was " +
          "already being assigned.",
        recommended: true,
      },
      {
        label: "A web address to a plan kept somewhere else",
        plainly:
          "The link is literally a link: somebody pastes in the address of a care plan that lives " +
          "in another system, and adjusting it means pasting a different one.",
        then:
          "Quick to build and it answers nothing. The plan would still be somewhere this product " +
          "cannot read, so no screen could show what it says and no check could tell whether the " +
          "address still worked.",
      },
      {
        label: "Which version of the plan somebody is on",
        plainly:
          "Every plan is written under a set of rules, and those rules change. The link would say " +
          "which version this person's plan follows, and adjusting it would move them to a newer " +
          "one.",
        then:
          "This is already recorded on every assignment and every goal, and has been from the " +
          "start. Building it again under a second name would give one fact two homes that drift.",
      },
    ],
    state: "answered",
    answer: {
      decided:
        "A — a plan link is the goal a piece of assigned support is meant to move. Decided under " +
        "the 24 September instruction to go with the best use rather than the shortcut, and it is " +
        "the option that closes a gap somebody could see on the screen rather than one that adds " +
        "a field. Built the same day: a clinician sets it when they assign the work or afterwards, " +
        "both sides of the shared plan show it from the same sources, and the person reads it in " +
        "their own words. It refuses another person's goal, refuses a goal nobody has confirmed " +
        "with the person, and refuses a link that has not moved — recording care time for an " +
        "adjustment nobody made is worse than recording nothing.",
      on: "2026-09-24",
    },
    asked: "2026-09-23",
  },
  {
    id: "design.expansion-palette-and-type",
    question:
      "The Expansion Handoff proposes a new colour palette and one typeface, Atkinson Hyperlegible " +
      "Next, in place of the palette and the two typefaces the product already had. Adopt it?",
    audience: "design",
    blocks: ["accessibility.manual-and-human-testing"],
    meanwhile:
      "The product ran on its previous palette, whose colours had already been corrected once to " +
      "pass contrast, and on Inter with a Literata serif for page titles.",
    options: [
      {
        label: "Keep what the product has",
        plainly:
          "The existing colours were already adjusted so text is readable against every background " +
          "it sits on, and the existing type was chosen for tired readers. Take only the new " +
          "handoff's check-in design, which is what it actually asks to invest in.",
        then: "Nothing visible changes. The new palette stays a proposal.",
        recommended: true,
      },
      {
        label: "Adopt the new palette and typeface",
        plainly:
          "Every screen moves to the new cooler colours and one typeface drawn for readability. Each " +
          "colour is placed by the job it does rather than by its name, because two of the names " +
          "mean opposite things in the two systems, and every pairing is checked for contrast.",
        then:
          "A visible change on every screen. The reference screenshots are retaken, and the contrast " +
          "checks are rewritten for the new colours.",
      },
    ],
    state: "answered",
    answer: {
      decided:
        "Adopt — approved by the product owner on 24 September, against the recommendation to keep " +
        "the existing palette. Recorded rather than smoothed over, so the next reader can see the " +
        "question was weighed. Adopted BY ROLE: the handoff calls its page background ground, and " +
        "ground already meant the primary text colour in over a thousand places, so a name-for-name " +
        "swap would have made body text pale on a pale page. Every text pairing is verified in the " +
        "contrast checks; the automated accessibility scan passed on every route afterwards; the " +
        "typeface loads at exactly the two weights the handoff allows. Dark mode followed the same " +
        "day as its own change, checked the same way in both modes and scanned on every route with " +
        "the system set to dark.",
      on: "2026-09-24",
    },
    asked: "2026-09-24",
  },
  {
    id: "clinical.weekly-trauma-questionnaire-wording",
    question:
      "The two trauma questionnaires were given every week, but each asks about the past month, so " +
      "every answer mostly repeated weeks the last one had already covered. Keep them weekly and ask " +
      "about the past week instead, or give them monthly as written?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Until the new wording is signed, members answer the unchanged past-month wording once every " +
      "thirty days, so measurement carries on with wording that is approved. The app no longer lets " +
      "a questionnaire be taken again before the time it asks about has passed, on any screen or " +
      "the phone app.",
    options: [
      {
        label: "Weekly, asking about the past week",
        plainly:
          "The PTSD checklist is published by its authors in a past-week form for exactly this kind " +
          "of repeated check. The questions stay the same; only the time they ask about changes. " +
          "Weekly readings then cover separate weeks.",
        then:
          "Once signed, the checklist opens every seven days with the past-week wording. Scores in " +
          "the two wordings are kept apart, so a rise is only ever measured against the same wording.",
      },
      {
        label: "Monthly, as written",
        plainly:
          "Keep the standard wording and give it once a month, which is what the questionnaire " +
          "itself asks about. Care teams see one reading a month instead of four.",
        then: "Nothing further changes: this is what the app does while the wording is unsigned.",
      },
    ],
    state: "answered",
    answer: {
      decided:
        "Weekly, asking about the past week — the product owner's decision on 24 September. The " +
        "past-week wording is built and switched off until the psychologists sign it.",
      on: "2026-09-24",
    },
    outstanding:
      "The psychologists' signature on the past-week wording of the PTSD checklist, and on reading " +
      "the ten-point rise that raises a review against week-to-week scores.",
    asked: "2026-09-24",
  },
  {
    id: "product.referral-page-plain-words",
    question:
      "Members have a page showing what would go with them if they were referred to another " +
      "clinician. It listed each questionnaire by its clinical name with the member's score, and " +
      "the name of their internal care path. Show exactly what is sent, or describe it in plain " +
      "words without the numbers?",
    audience: "product",
    blocks: [],
    meanwhile: "The page showed the clinical names, the scores and the path name.",
    options: [
      {
        label: "Plain words, no numbers",
        plainly:
          "Say what kind of thing would be shared — the low-mood questionnaire's answers and score, " +
          "the date — without the numbers or the clinical names.",
        then: "Every item is still listed. The version a clinician would receive does not change.",
        recommended: true,
      },
      {
        label: "Show exactly what is sent",
        plainly: "Keep the names and scores on this one page, as a written-down exception.",
        then: "Nothing changes on the page; the rule holds everywhere else.",
      },
    ],
    state: "answered",
    answer: { decided: "Plain words, no numbers — the product owner's decision on 24 September.", on: "2026-09-24" },
    asked: "2026-09-24",
  },
  {
    id: "clinical.itq-between-visits",
    question:
      "The second trauma questionnaire (the International Trauma Questionnaire) has no published " +
      "past-week version that we know of. How often should members take it between visits?",
    audience: "clinical",
    blocks: [],
    meanwhile: "It is given once every thirty days, with its standard past-month wording.",
    options: [
      {
        label: "Monthly, as written",
        plainly:
          "Keep the published wording and give it once a month, next to the weekly checklist.",
        then: "Nothing changes.",
        recommended: true,
      },
      {
        label: "Weekly, with an adapted past-week wording",
        plainly:
          "Change its wording to ask about the past week. It would no longer be the published " +
          "questionnaire, and its scores could not be compared with published ones.",
        then: "The psychologists write and sign the adapted wording, then it opens every seven days.",
      },
      {
        label: "Only at the start",
        plainly: "Ask it once when someone joins and leave between-visit tracking to the checklist.",
        then: "It leaves the between-visit questionnaire list.",
      },
    ],
    state: "open",
    asked: "2026-09-24",
  },
  {
    id: "clinical.program-fit-pause-length",
    question:
      "After the first eight questions stop someone because of thoughts of self-harm in the past " +
      "month, or an unsafe situation now, how long before they may answer again?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Twenty-four hours, as before. Answers a person cannot truthfully change — a diagnosis, a " +
      "hospital stay in the past year, relying on substances, being under eighteen — now stay in " +
      "place until someone from the care team has reviewed them and written down what they did; " +
      "answering again no longer lifts them.",
    options: [
      {
        label: "Until the question's own period has passed",
        plainly:
          "The self-harm question asks about the past thirty days, so an honest answer cannot change " +
          "for thirty days. A person from the care team can reopen it sooner after talking with them.",
        then: "The pause becomes thirty days for that question, and stays twenty-four hours for an unsafe situation now.",
        recommended: true,
      },
      {
        label: "Fourteen days",
        plainly: "The figure in the clinical rules document the safety rules were built from.",
        then: "The pause becomes fourteen days for both questions.",
      },
      {
        label: "Keep twenty-four hours",
        plainly: "A short pause, relying on honest answers the second time.",
        then: "Nothing changes.",
      },
    ],
    state: "open",
    asked: "2026-09-24",
  },
  {
    id: "clinical.steadier-sleep-gates",
    question:
      "The sleep program's four parts came with no level of distress or safety at which each one " +
      "opens. The second part asks a member to get out of bed at night when they cannot sleep. " +
      "Which levels should the parts use?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "The levels you already signed for the two night practices (row A14), chosen by the product " +
      "owner on 25 September: parts one, three and four open on any day, even the hardest, like " +
      "\"After a bad dream\"; part two opens only on a steadier day with distress at 7 or below, " +
      "like \"Back to rest\". On other days it says \"not today\" and nothing is lost.",
    options: [
      {
        label: "Keep the night-practice levels",
        plainly: "What runs now. The part that asks a member to get up at night waits for a steadier day.",
        then: "Nothing changes.",
        recommended: true,
      },
      {
        label: "Open every part on any day",
        plainly: "Getting up after twenty minutes awake is safe enough to suggest even on the hardest days.",
        then: "Part two opens at the same level as the others.",
      },
      {
        label: "Hold the whole program for steadier days",
        plainly: "Treat it like the activity program, which waits for a steadier day throughout.",
        then: "Every part needs a steadier day, with distress at 7 or below.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "clinical.sleep-entry-screen-retake",
    question:
      "The sleep program asks three safety questions on joining; a yes to any leaves out the part " +
      "about getting up at night. If someone leaves the program and joins again, should the " +
      "questions be asked again?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Nothing had been built: the program was new, and the questions were asked only when someone " +
      "first joined.",
    options: [
      {
        label: "Yes, after leaving and rejoining",
        plainly:
          "Things change: a health question can stop applying. Leaving clears the answers and joining " +
          "again asks all three again. The risk: someone could answer no the second time only to get " +
          "the left-out part back.",
        then:
          "The earlier answer is kept, marked cleared, so the care team can see a change. A different " +
          "answer the second time brings the part back.",
      },
      {
        label: "No, the first answer stands",
        plainly: "Once a part is left out it stays out, unless someone from the care team reopens it.",
        then: "Joining again skips the questions and keeps the part left out.",
      },
    ],
    state: "answered",
    answer: {
      decided:
        "Yes, after leaving and rejoining — the product owner's decision on 25 September, with the " +
        "risk that a member could answer no the second time to get the left-out part back. For the " +
        "psychologists to confirm at the next review.",
      on: "2026-09-25",
    },
    asked: "2026-09-25",
  },
  {
    id: "product.feelings-word-list",
    question:
      "Two signed screens ask a member to pick from a feelings word list — Feeling and Relating's " +
      "\"Pick two words for how you feel right now\", and the thought record's \"What did you feel?\" — " +
      "but the signed content does not include a list. Should there be one, and which words?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Members type one or two words of their own. Nothing is suggested, so nobody is steered toward a " +
      "word that does not fit; the cost is that a member who cannot find a word gets no help finding one.",
    options: [
      {
        label: "Add a short list the psychologists write",
        plainly: "A plain list, including mixed and body-based words, reviewed like the rest of the pack.",
        then: "The list appears once its review row is signed, with typing still allowed.",
        recommended: true,
      },
      {
        label: "Keep typing only",
        plainly: "The member's own words, always. No list to steer them.",
        then: "Nothing changes.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "clinical.complex-path-program-before-review",
    question:
      "Feeling and Relating is signed for the complex trauma readiness path only once that path's " +
      "clinician review is done, but the app cannot record that review yet. What should members on " +
      "that path see meanwhile?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Nothing was built yet: the program was new, and nothing records a path's clinician review.",
    options: [
      {
        label: "Hide it until reviews exist",
        plainly:
          "Members on the complex trauma path do not see it, even if they are on the trauma path as well. " +
          "Recording a review becomes its own piece of work.",
        then: "Members on the trauma path alone see it; the complex path waits.",
        recommended: true,
      },
      {
        label: "Build the review mark now",
        plainly: "A care-team action on the person record that opens the program for that member.",
        then: "The complex path sees it once someone from the care team records the review.",
      },
    ],
    state: "answered",
    answer: {
      decided: "Hide it until reviews exist — the product owner's decision on 25 September.",
      on: "2026-09-25",
    },
    asked: "2026-09-25",
  },
  {
    id: "clinical.riding-strong-feelings-gates",
    question:
      "The signed row says Riding Strong Feelings is gated \"per underlying skills\" without giving " +
      "levels. Each part holds skills with different levels. When should a part open?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "A part opens when any of its skills would, and inside it each skill still shows only when its own " +
      "level allows. So on a very hard day, parts one and two open with \"Move it out\" and \"Find the " +
      "room\" — the skills made for that — and parts three and four wait for a steadier day.",
    options: [
      {
        label: "When any of its skills would",
        plainly: "What runs now. The program is there when feelings run high, showing only what fits the day.",
        then: "Nothing changes.",
        recommended: true,
      },
      {
        label: "Only when all of its skills would",
        plainly: "A part opens only when every skill in it is open, so the part is whole or not there.",
        then: "Parts one and two wait for a steadier day, with distress at 7 or below.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "clinical.thought-record-privacy",
    question:
      "Members' thought records are signed as \"private to the member\". The strength of the feeling, " +
      "before and after, is a number the care team could use to see whether the skill helps. Should those " +
      "two numbers reach the care team, without the words?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Nothing about a thought record reaches the care team: not the words, not the numbers, not that one " +
      "was written. The program activities are different: their ratings do reach the care team's analytics.",
    options: [
      {
        label: "Keep them fully private",
        plainly: "The signed row read strictly: a thought record is the member's alone, numbers included.",
        then: "Nothing changes.",
        recommended: true,
      },
      {
        label: "Share the two numbers only",
        plainly: "The care team sees that a record was made and how strong the feeling was before and after, never the words.",
        then: "The two numbers join the care team's analytics, the way program ratings do.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  // ---- Phase 3, the clinician-assigned lane: for the partner's clinical lead.
  // Built ahead of its gate for review and testing (25 September); none of
  // these holds up anything a member can reach, because the lane is absent
  // outside the demo until rows E01 to E05 are signed.
  {
    id: "partner.crisis-check-on-exposure-writing",
    question:
      "For the partner's clinical lead: every piece of writing in the app is checked for crisis language " +
      "before it is saved, and a match saves nothing and opens the crisis page. Exposure writing can " +
      "describe past harm in words that match. Should the check run on it, and what should happen on a match?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "The check runs. A match saves none of that step's writing, ends the practice, alerts the care team " +
      "without the words, and opens the crisis page. Earlier steps' writing stays saved.",
    options: [
      {
        label: "Check it, keep the writing, flag the clinician",
        plainly: "A match still opens the crisis page and alerts the care team, but the writing is kept for the assigning clinician.",
        then: "Nothing written is lost; the clinician sees it with the flag.",
        recommended: true,
      },
      {
        label: "Check it and save nothing, as now",
        plainly: "The same rule as everywhere else in the app.",
        then: "Nothing changes.",
      },
      {
        label: "Do not check exposure writing",
        plainly: "The assigning clinician reviews it; the distress ratings and flag still apply.",
        then: "The check is skipped for writing steps in this lane only.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "partner.who-reads-assigned-writing",
    question:
      "For the partner's clinical lead: what a person writes in a clinician-assigned practice is readable " +
      "by them and by the clinician who assigned it. Should anyone else on the care team be able to read it?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Only the person and the assigning clinician. A colleague who opens it is told whose it is and shown " +
      "nothing; the distress flag still reaches the care team's queue, without the words.",
    options: [
      {
        label: "Assigning clinician only",
        plainly: "As the handoff says: the person and the one clinician who gave them the practice.",
        then: "Nothing changes.", recommended: true,
      },
      {
        label: "Their whole care team",
        plainly: "Anyone caring for the person can read it, for continuity when the assigning clinician is away.",
        then: "Every clinician on the person's care team can open the writing; each read is still recorded.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "partner.assigned-writing-retention",
    question:
      "For the partner's clinical lead: how long is writing from a clinician-assigned practice kept, and " +
      "may the person delete it themselves?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Kept until the person's account is deleted. The person cannot delete it on their own, because it may " +
      "form part of the partner's clinical record; the handoff leaves this to the partner's record policy.",
    options: [
      {
        label: "The partner's record policy",
        plainly: "Kept for the period the partner's records must be kept, then removed.",
        then: "A retention period is set for this lane from the partner's policy.",
        recommended: true,
      },
      {
        label: "The person can delete it",
        plainly: "Like everything else they write in Steady, with two taps.",
        then: "A delete control appears beside their writing; the clinician's view shows it was deleted.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "partner.distress-flag-levels",
    question:
      "For the partner's clinical lead: the signed lane rule flags the assigning clinician when distress " +
      "after a practice is 3 or more above distress before, or above 7. Are those the right levels, and " +
      "should a practice the person stopped be flagged by the same rule?",
    audience: "clinical",
    blocks: [],
    meanwhile:
      "Those levels, applied whether the practice was finished or stopped, when a rating after was given. " +
      "A person who stops may skip the rating, and then nothing is flagged.",
    options: [
      { label: "Keep them, finished or stopped", plainly: "The rule as written, applied to every run with a rating.", then: "Nothing changes.", recommended: true },
      {
        label: "Also flag any stop",
        plainly: "A stop is not a failure, but the clinician may want to know it happened.",
        then: "Every stopped practice sends a gentle note to the clinician's queue.",
      },
      { label: "Different levels", plainly: "Name the rise, and the level after the practice, that should reach the clinician.", then: "The two levels change." },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "partner.lane-titles-and-lengths",
    question:
      "For the partner's clinical lead: the three practices need names a person reads and a length. The " +
      "handoff names one, \"Written exposure (clinician-assigned)\". Are \"Worksheets (clinician-assigned)\" " +
      "and \"Nightmare rehearsal (clinician-assigned)\", at about 30, 20 and 20 minutes, right?",
    audience: "clinical",
    blocks: [],
    meanwhile: "Those names and lengths, marked as drafts; no method is named to the person.",
    options: [
      { label: "Keep them", plainly: "Plain names that describe the activity without naming a method.", then: "Nothing changes.", recommended: true },
      { label: "The partner's own names", plainly: "Use whatever the partner's protocols call them for patients.", then: "The names and lengths change to the partner's." },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  // ---- Handoff 11 §6: questions for evolvedMD. They set the evaluation
  // tenant's settings (src/lib/tenants); asked of the partner, not the clinicians.
  {
    id: "partner.registry-and-export",
    question: "For the partner: which registry and EHR systems do your teams use, and which columns should the PHQ-9 and GAD-7 export have?",
    audience: "product",
    blocks: [],
    meanwhile: "The export is a file in the evaluation (CSV, and FHIR Observations coded with LOINC 44261-6 and 70274-6), in a generic column layout until the partner's is known.",
    options: [
      {
        label: "Send your column layout",
        plainly: "The CSV matches what your registry imports, column for column.",
        then: "The export's columns change to yours.",
        recommended: true,
      },
      {
        label: "Use the generic layout",
        plainly: "One row per measure: patient reference, instrument, date, total score, change from baseline.",
        then: "Nothing changes.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "partner.measure-cadence",
    question: "For the partner: how often should members complete the PHQ-9 and GAD-7 between visits?",
    audience: "product",
    blocks: [],
    meanwhile: "Every 14 days, and before each visit, as the handoff proposes.",
    options: [
      {
        label: "Every 14 days and before visits",
        plainly: "The handoff's proposal: often enough to see a trend, not so often it becomes a chore.",
        then: "Nothing changes.",
        recommended: true,
      },
      {
        label: "Another cadence",
        plainly: "Name the number of days, and whether to add one before each visit.",
        then: "The cadence in the tenant's settings changes.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "partner.treat-to-target",
    question: "For the partner: which treat-to-target thresholds do your consultants use?",
    audience: "product",
    blocks: [],
    meanwhile: "Response is a 50% drop in PHQ-9; remission is PHQ-9 below 5; a patient not responding by week 10 goes to consultant review.",
    options: [
      {
        label: "Keep those thresholds",
        plainly: "The collaborative care defaults the handoff proposes.",
        then: "Nothing changes.",
        recommended: true,
      },
      {
        label: "Your own thresholds",
        plainly: "Name the response drop, the remission score and the review week you use.",
        then: "The thresholds in the tenant's settings change.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "partner.care-team-contact",
    question: "For the partner: what care-team contact and hours should members see, and who should receive alerts?",
    audience: "product",
    blocks: [],
    meanwhile: "Members see 988 and SOS only; no care-team contact is shown until you supply one. In the evaluation, alerts go to a test inbox, never to a real phone.",
    options: [
      {
        label: "Supply a contact and hours",
        plainly: "A number and the hours it is answered, shown beside 988, never with a promised response time.",
        then: "Members see your contact; alerts route to the people you name, once live.",
        recommended: true,
      },
      {
        label: "Show 988 and SOS only",
        plainly: "No care-team contact is shown to members.",
        then: "Nothing changes.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "partner.most-used-interventions",
    question: "For the partner: which interventions do your behavioral health managers use most, and do you have worksheets to load?",
    audience: "product",
    blocks: [],
    meanwhile: "Assignable today: Steady's signed skills, programs and lessons, and member thought records; a problem-solving module is drafted for your review, and your own worksheets can be loaded into protocol slots.",
    options: [
      {
        label: "Tell us your top interventions",
        plainly: "Behavioral activation, problem solving, CBT skills or others, in the order your teams use them.",
        then: "The assign menu is ordered to match, and your worksheets are loaded into slots.",
        recommended: true,
      },
      {
        label: "Use Steady's catalog as it is",
        plainly: "The signed content, in its current order.",
        then: "Nothing changes.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "partner.pcp-view",
    question: "For the partner: do you want primary care providers to have a view of their own patients in Steady at all?",
    audience: "product",
    blocks: [],
    meanwhile: "The primary care role exists and sees nothing yet; the monthly summary is built later in this build.",
    options: [
      {
        label: "Yes, the monthly summary",
        plainly: "Each patient's engagement, measure direction and any open consultant recommendation, and nothing else.",
        then: "The summary is built as the handoff describes.",
        recommended: true,
      },
      {
        label: "No primary care view",
        plainly: "Primary care providers do not get accounts.",
        then: "The role and its page are removed from the evaluation tenant.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
  {
    id: "partner.pilot-sites",
    question: "For the partner: which sites or states would the eventual pilot use, and are the virtual Northeast sites the better first fit?",
    audience: "product",
    blocks: [],
    meanwhile: "The evaluation seeds generic site names across AZ, MA, NH and ME; nothing depends on the answer until a pilot is planned.",
    options: [
      {
        label: "Virtual Northeast sites first",
        plainly: "Largely virtual care, which fits a between-visit app most naturally.",
        then: "Pilot planning starts with MA, NH and ME virtual sites.",
        recommended: true,
      },
      {
        label: "Name the sites",
        plainly: "Tell us which sites and states you would start with.",
        then: "Pilot planning starts there.",
      },
    ],
    state: "open",
    asked: "2026-09-25",
  },
];

export const OPEN_DECISIONS = DECISION_REGISTER.filter((d) => d.state === "open");

export interface DecisionSummary {
  open: number;
  answered: number;
  /** Answered, and still waiting on information before anybody can act. */
  waitingOnInformation: number;
  /** Open decisions holding up at least one recorded piece of work. */
  blocking: number;
  byAudience: Record<DecisionAudience, number>;
}

export function decisionSummary(entries: readonly Decision[] = DECISION_REGISTER): DecisionSummary {
  const open = entries.filter((d) => d.state === "open");
  const byAudience = {
    clinical: 0, product: 0, operations: 0, security: 0, design: 0,
  } as Record<DecisionAudience, number>;
  for (const d of open) byAudience[d.audience]++;
  return {
    open: open.length,
    answered: entries.length - open.length,
    waitingOnInformation: entries.filter((d) => d.outstanding).length,
    // A DECISION THAT BLOCKS NOTHING IS STILL WORTH ASKING and is counted
    // separately rather than hidden: "should assignment gate access" holds up
    // no filed work, and it is the kind of question that turns out to matter
    // most. What it must not do is pad a count of things that are stuck.
    blocking: open.filter((d) => d.blocks.length > 0).length,
    byAudience,
  };
}
