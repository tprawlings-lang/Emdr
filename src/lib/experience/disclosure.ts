// When an explanation is an essay, and what folding one may not cost.
//
// UX 010: "Large explanation blocks and narrow columns bury working content.
// Use shared page templates and progressive disclosure." Measured on the
// console screens before it was fixed: the first thing a clinician could act
// on sat 813px down on Handoffs, 628 on the caseload, 559 on the module queue
// — below the fold on a laptop, in the ordinary case where nothing was waiting.
//
// THE RULE IS HERE RATHER THAN IN THE TEST because it is a product decision
// about how much a screen may say before it lets somebody work, and a decision
// that lives only in an assertion is a decision nobody can find. The test reads
// it from here.
//
// WHAT IS BEING REFUSED IS A STANDING ESSAY, NOT EXPLANATION. A sentence that
// changes with the data — a status line, a refusal, a result — is the screen
// doing its job. What folds is the paragraph identical on every visit about a
// fact that does not change. Nothing can tell those apart by reading, so the
// rule uses length, and length is a proxy: past this many words a paragraph is
// an essay.

/** Past this many words, a standing paragraph belongs behind a disclosure. */
export const ESSAY_WORD_LIMIT = 40;

/**
 * The prose blocks in a source file that are NOT inside a `<details>`.
 *
 * Deliberately crude: it reads JSX as text rather than parsing it, because the
 * question — "how much does this screen say before it lets you work" — is about
 * what reaches the page, and a more precise parser would not make the answer
 * more true.
 */
export function unfoldedProse(src: string): Array<{ words: number; text: string }> {
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  // Everything inside a disclosure is folded by definition.
  const unfolded = withoutComments.replace(/<details[\s\S]*?<\/details>/g, " ");

  const out: Array<{ words: number; text: string }> = [];
  for (const m of unfolded.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    // What a reader sees: tags and JSX expressions removed, because an
    // expression is a value rather than prose and a long className is not
    // something anybody reads.
    const text = m[1]
      .replace(/\{[^{}]*\}/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&\w+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push({ words: text.split(" ").length, text });
  }
  return out;
}

/** The paragraphs on one screen that are long enough to bury the work. */
export function essaysInFrontOfWork(src: string, limit = ESSAY_WORD_LIMIT) {
  return unfoldedProse(src).filter((p) => p.words > limit);
}
