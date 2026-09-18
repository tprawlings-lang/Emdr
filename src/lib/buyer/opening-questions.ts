// The questions a buyer console opens with (17 September handoff, P5).
//
//   "These pages should begin with decisions and work, not a collection of
//   charts." And the acceptance: "users can answer each opening question and
//   trace figures to denominator, window, missingness, and definition."
//
// THE CONSOLES WERE NOT WRONG — they were unasked. The organization overview
// already carried denominators on every figure, a funnel with its largest drop
// marked, a rebuild stamp and a named window. What it did not do was say what
// the reader had come to find out. Three questions bring somebody to that
// screen — where is access delayed, where is work accumulating, are delivery
// and safety policies being followed — and answering them meant reading three
// charts on three tabs and doing the joining yourself.
//
// SO AN ANSWER IS A RECORD, not a paragraph. Each carries the sentence, the
// figure, and the four things the handoff says must be traceable from it. A
// buyer console whose headline number cannot produce its own denominator is the
// spreadsheet these pages replaced.
//
// AND "WE CANNOT ANSWER THAT" IS AN ANSWER. A question whose projection failed
// or whose data is suppressed says so, in the same shape, rather than being
// dropped — a console that quietly asks two questions today and three tomorrow
// teaches nobody anything about what it knows.

export type BuyerAudience = "organization" | "payer" | "reviewer";

export interface OpeningQuestion {
  id: string;
  audience: BuyerAudience;
  /** The reader's own words, as the handoff puts them. */
  question: string;
}

export const OPENING_QUESTIONS: readonly OpeningQuestion[] = [
  { id: "org.access-delayed", audience: "organization", question: "Where is access delayed?" },
  { id: "org.work-accumulating", audience: "organization", question: "Where is work accumulating?" },
  {
    id: "org.policies-followed",
    audience: "organization",
    question: "Are delivery and safety policies being followed?",
  },
  { id: "payer.eligible", audience: "payer", question: "Who was eligible?" },
  { id: "payer.participated", audience: "payer", question: "Who participated?" },
  { id: "payer.measured", audience: "payer", question: "What was measured?" },
  {
    id: "payer.evidence-maturity",
    audience: "payer",
    question: "How mature and complete is the evidence?",
  },
];

export function questionsFor(audience: BuyerAudience): OpeningQuestion[] {
  return OPENING_QUESTIONS.filter((q) => q.audience === audience);
}

/**
 * An answer, with everything the handoff requires be traceable from it.
 *
 * The four trace fields are not optional and not free-form decoration: they are
 * the acceptance criterion. `assertTraceable` refuses an answer missing any of
 * them, so a console cannot ship a confident sentence over a number nobody can
 * take apart.
 */
export interface TracedAnswer {
  questionId: string;
  question: string;
  /** One sentence. What the reader came for. */
  answer: string;
  /** The number, written with its denominator, or null when the answer is not
   *  a number. */
  figure: string | null;
  /** What the figure is out of. */
  denominator: string;
  /** Over what period, and whether that is the whole record. */
  window: string;
  /** What is not in it: suppressed cells, unarrived feeds, people with no row. */
  missingness: string;
  /** What the thing being counted actually means. */
  definition: string;
  evidenceHref: string;
  evidenceLabel: string;
}

export class OpeningQuestionError extends Error {}

/** Every trace field present, or the answer does not render. */
export function assertTraceable(a: TracedAnswer): TracedAnswer {
  const blank = (["denominator", "window", "missingness", "definition"] as const)
    .filter((k) => !a[k] || !a[k].trim());
  if (blank.length > 0) {
    throw new OpeningQuestionError(
      `${a.questionId} cannot be traced to ${blank.join(", ")}. The handoff's acceptance for a ` +
      "buyer view is that every figure opens into all four."
    );
  }
  if (!a.answer.trim()) {
    throw new OpeningQuestionError(`${a.questionId} has no answer, only a question.`);
  }
  return a;
}

/**
 * The answer to give when the projection could not be read.
 *
 * SAME SHAPE, so the question stays on the screen. A console that drops a
 * question it cannot answer today looks, to somebody comparing two screenshots,
 * like a console that was never asked it.
 */
export function unanswered(
  q: OpeningQuestion, args: { because: string; evidenceHref: string; evidenceLabel: string }
): TracedAnswer {
  return {
    questionId: q.id,
    question: q.question,
    answer: `Not answered here. ${args.because}`,
    figure: null,
    denominator: "No figure, so nothing to divide.",
    window: "No window, because nothing was counted.",
    missingness: args.because,
    definition: "Not applicable while there is no figure.",
    evidenceHref: args.evidenceHref,
    evidenceLabel: args.evidenceLabel,
  };
}
