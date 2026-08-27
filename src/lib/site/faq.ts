// FAQ content (Redesign handoff §13, §14).
//
// The answers below are the handoff's approved drafts, kept close to their
// approved wording rather than reworded for tone. Two rules from §13 shape the
// structure:
//
//   "Lead every answer with the direct answer: Yes, No, Not yet, or In the
//    fabricated demo only."
//
//   "Do not use FAQ copy to make claims that the main page avoids."
//
// The second is the one that gets broken by accident. An FAQ is where a
// carefully bounded claim quietly becomes a confident one, because the format
// invites a reassuring answer. Every answer here carries its own lead verdict,
// and the copy guard scans this file with the same rules it applies to pages.

export type Verdict = "Yes" | "No" | "Not yet" | "In the fabricated demo only";

export interface FaqItem {
  q: string;
  /** The direct answer, always first. */
  verdict: Verdict;
  a: string;
  /** Where a reader goes to check the answer themselves. */
  link?: { href: string; label: string };
  /** Answers with legal, clinical, or security consequence carry a review date. */
  lastReviewed?: string;
  owner?: string;
}

export interface FaqGroup {
  id: string;
  title: string;
  blurb: string;
  items: FaqItem[];
}

export const FAQ: FaqGroup[] = [
  {
    id: "platform",
    title: "Platform",
    blurb: "What Steady is, what runs today, and who it is for.",
    items: [
      {
        q: "What is Steady?",
        verdict: "In the fabricated demo only",
        a: "Steady is a development-stage behavioral health platform that combines structured between-visit experiences, clinician review workflows, and longitudinal signals. The current environment is a fabricated demonstration, not clinical care.",
        link: { href: "/platform", label: "How the platform works" },
      },
      {
        q: "What parts are working today?",
        verdict: "In the fabricated demo only",
        a: "The member experience, the deterministic access gates, the clinician caseload and timeline, cited summaries, the audit log, and event replay all run in the review environment. Each capability on this site carries a status label, and the labels come from a single registry rather than being written per page.",
        link: { href: "/platform", label: "Capability status" },
      },
      {
        q: "What is simulated rather than working?",
        verdict: "In the fabricated demo only",
        a: "The deterministic safety engine computes decisions and logs them without governing access. BLS Part 6 is shown as a labelled simulation. Organization and payer population views are planned and not built.",
      },
      {
        q: "Who is the platform designed for?",
        verdict: "Not yet",
        a: "The intended users are members, clinicians, healthcare organizations, and payers. At this stage the platform is designed for review by those audiences rather than use by them.",
      },
    ],
  },
  {
    id: "clinical",
    title: "Clinical",
    blurb: "Care boundaries, oversight, and what the AI does and does not decide.",
    items: [
      {
        q: "Is Steady therapy or medical care?",
        verdict: "No",
        a: "The current environment does not provide therapy, medical care, diagnosis, treatment, or emergency services.",
        lastReviewed: "2026-08-27",
        owner: "Clinical",
      },
      {
        q: "Are clinicians monitoring activity?",
        verdict: "No",
        a: "The demonstration shows a proposed clinician workflow, but no one monitors activity in real time and no care team is assigned. The member-facing coverage statement is derived from the configured schedule, so it cannot promise more than a rota could deliver.",
        lastReviewed: "2026-08-27",
        owner: "Clinical",
      },
      {
        q: "Does AI make clinical decisions?",
        verdict: "No",
        a: "Deterministic rules control safety and access behavior. AI-generated summaries or suggestions must be labelled and reviewed by a person. The newer autonomous engine remains off or in shadow mode, and no configuration can promote it to govern access.",
        link: { href: "/clinical", label: "Where people stay accountable" },
        lastReviewed: "2026-08-27",
        owner: "Clinical + Engineering",
      },
      {
        q: "How are alerts handled?",
        verdict: "In the fabricated demo only",
        a: "Alerts carry a severity band, a named owner, and a deadline computed from the configured coverage schedule. Immediate and high bands close with a documented action rather than an acknowledgement, and never by the passage of time.",
      },
      {
        q: "What is BLS Part 6?",
        verdict: "Not yet",
        a: "It is an active clinical validation workstream. The fabricated demo may show the workflow, including stop and escalation behavior. It is not approved for real-person use.",
        link: { href: "/evidence", label: "Evidence and validation" },
        lastReviewed: "2026-08-27",
        owner: "Clinical",
      },
    ],
  },
  {
    id: "organizations",
    title: "Organizations",
    blurb: "Pilots, roles, integration, and configuration.",
    items: [
      {
        q: "How would a pilot work?",
        verdict: "Not yet",
        a: "A supervised pilot would be limited in scope: adults only, one organization, a named care team, under protocol. Several prerequisites are open, including clinical review, security review, counsel determination, and vendor agreements.",
        link: { href: "/organizations", label: "What a pilot would require" },
      },
      {
        q: "What roles are required?",
        verdict: "Not yet",
        a: "A clinical owner, a security owner, privacy and legal review, support, incident response, and an evaluation owner. None of these roles is currently named.",
      },
      {
        q: "Does Steady integrate with an EHR?",
        verdict: "No",
        a: "Record-system and identity integration are target architecture. No integration exists in the reviewed build, and none is claimed.",
      },
      {
        q: "Can organizations configure policies?",
        verdict: "In the fabricated demo only",
        a: "Six clinical policy questions are implemented as versioned configuration a reviewer can switch and compare — companion content access, caseload ownership, coverage schedule, alert consequence, re-entry, and engine mode. The defaults are demonstration assumptions, not approvals.",
        link: { href: "/clinical", label: "Policies you can compare" },
      },
    ],
  },
  {
    id: "payers",
    title: "Payers",
    blurb: "Measurement, reimbursement, and evaluation design.",
    items: [
      {
        q: "What can Steady measure?",
        verdict: "In the fabricated demo only",
        a: "Structured, timestamped signals: check-in state, instrument scores, session participation and outcomes, intervention completion, and safety events. Aggregate views over fabricated data can demonstrate the shape of an evaluation.",
      },
      {
        q: "Is reimbursement established?",
        verdict: "No",
        a: "No reimbursement path is presented as established. Steady is exploring partner-sponsored, payer-supported, value-based, and self-pay models with reviewers.",
        lastReviewed: "2026-08-27",
        owner: "Founder",
      },
      {
        q: "Are savings proven?",
        verdict: "No",
        a: "No cost, utilization, or return-on-investment claim is made. The candidate measures are exactly that — candidates for evaluation, not proven leading indicators.",
        link: { href: "/payers", label: "Candidate measures" },
        lastReviewed: "2026-08-27",
        owner: "Founder",
      },
      {
        q: "How would an evaluation be designed?",
        verdict: "Not yet",
        a: "Collaboratively, with agreed measures and data boundaries set in advance, and a stated definition of what would count as a result worth acting on.",
      },
    ],
  },
  {
    id: "security",
    title: "Security and privacy",
    blurb: "Data in the environment, compliance posture, and vendor exposure.",
    items: [
      {
        q: "Does the demo contain protected health information?",
        verdict: "No",
        a: "It must not. The review environment is restricted to fabricated personas and scripted data. Any real-person information appearing in it is a stop condition: the environment is isolated, evidence preserved, exposure assessed, and the cause corrected before use resumes.",
        lastReviewed: "2026-08-27",
        owner: "Security",
      },
      {
        q: "Is Steady HIPAA compliant?",
        verdict: "No",
        a: "Steady does not make that claim today. The team is building and testing technical controls, while contracts, business associate agreements, operating procedures, independent review, and production deployment controls all remain required before real healthcare use.",
        link: { href: "/trust", label: "Control status and known gaps" },
        lastReviewed: "2026-08-27",
        owner: "Security + Counsel",
      },
      {
        q: "What data reaches the AI provider?",
        verdict: "In the fabricated demo only",
        a: "Companion messages, recent conversation history, model-exposable memories, and profile context are sent to a commercial model provider to generate a response. Because the environment is fabricated, no real person's content has ever been sent. No agreement with the provider is in place, and one is required before any real content could be.",
        link: { href: "/trust", label: "AI and vendors" },
        lastReviewed: "2026-08-27",
        owner: "Security",
      },
      {
        q: "Are business associate agreements in place?",
        verdict: "No",
        a: "None are in place with any vendor. Executing them with every vendor that could reach protected data is a prerequisite before real data enters any environment.",
        lastReviewed: "2026-08-27",
        owner: "Founder + Counsel",
      },
      {
        q: "How is tenant isolation tested?",
        verdict: "In the fabricated demo only",
        a: "Forty-two cross-tenant attack cases across three suites, including twelve that run against a real Postgres cluster and block the build. The controls are built and tested; they are not yet on the request path of the running environment, and that distinction is stated wherever isolation is described.",
        link: { href: "/trust", label: "Tenancy controls" },
        lastReviewed: "2026-08-27",
        owner: "Security",
      },
    ],
  },
  {
    id: "access",
    title: "Access and stage",
    blurb: "Who can use Steady, and when that changes.",
    items: [
      {
        q: "Can individuals sign up?",
        verdict: "No",
        a: "Not at this stage. Public enrollment and subscription billing are closed while Steady is prepared for clinical, security, privacy, and partner review.",
        lastReviewed: "2026-08-27",
        owner: "Founder",
      },
      {
        q: "Can we use real patient data?",
        verdict: "No",
        a: "No real patient, payer, or employee health information may enter any Steady environment at this stage. This holds for demonstrations and reviewer sessions without exception — a demonstration is not an exemption.",
        lastReviewed: "2026-08-27",
        owner: "Founder + Compliance",
      },
      {
        q: "How do we review the demo?",
        verdict: "Yes",
        a: "Request a review and choose the clinical, organization, payer, investor, or security path. Approved reviewers receive scoped access, a guided fabricated scenario, and the matching evidence packet.",
        link: { href: "/request-review", label: "Request a review" },
      },
      {
        q: "When will production use begin?",
        verdict: "Not yet",
        a: "There is no date. Production use follows clinical, security, privacy, legal, and operational review gates, and those gates decide the timing rather than a schedule deciding them.",
      },
    ],
  },
  {
    id: "evidence",
    title: "Evidence",
    blurb: "What supports the claims, and what does not exist yet.",
    items: [
      {
        q: "Is Steady clinically validated?",
        verdict: "Not yet",
        a: "Published evidence about clinician-delivered EMDR supports the method, not Steady itself. Steady still needs human-factors work, clinical review, security review, and staged product evaluation.",
        link: { href: "/evidence", label: "Evidence and validation" },
        lastReviewed: "2026-08-27",
        owner: "Clinical",
      },
      {
        q: "What evidence supports EMDR?",
        verdict: "Yes",
        a: "Published research and clinical practice guidelines describe EMDR delivered by trained clinicians. That evidence is about the method as practised by clinicians, and is presented separately from anything about Steady for exactly that reason.",
        lastReviewed: "2026-08-27",
        owner: "Clinical",
      },
      {
        q: "What product evidence exists?",
        verdict: "Yes",
        a: "Deterministic tests, replay verification, tenant attack cases, safety scenarios, dependency and secret scans, and accessibility checks. Each is runnable, and the commands are published so a reviewer can execute them rather than take the claim on trust.",
        link: { href: "/evidence", label: "Runnable evidence" },
      },
      {
        q: "What review is still needed?",
        verdict: "Not yet",
        a: "Human-factors testing, clinical workflow review, an independent security audit, a pilot protocol, product outcome evaluation, and payer evaluation design.",
      },
    ],
  },
];

/** Homepage preview: six to eight top questions (§13). */
export const FAQ_HIGHLIGHTS = [
  "Can individuals sign up?",
  "Is Steady therapy or medical care?",
  "Are clinicians monitoring activity?",
  "Does the demo contain protected health information?",
  "Is Steady HIPAA compliant?",
  "Is Steady clinically validated?",
];

export function faqItem(question: string): FaqItem {
  for (const g of FAQ) {
    const found = g.items.find((i) => i.q === question);
    if (found) return found;
  }
  throw new Error(`Unknown FAQ question: "${question}"`);
}
