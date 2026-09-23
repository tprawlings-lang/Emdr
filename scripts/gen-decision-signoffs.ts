// One sheet per question, for somebody to read and sign.
//
//   npx tsx scripts/gen-decision-signoffs.ts
//
// A LIST OF OPEN QUESTIONS IS NOT A THING ANYBODY SIGNS. The decision register
// is checkable and lives in TypeScript, which makes it exactly the wrong shape
// for the person who has to answer it — a clinical lead does not open a source
// file, and a question they cannot read is a question that comes back
// unanswered or, worse, answered without being read.
//
// ONE SHEET EACH, on purpose. Seven questions on one page get skimmed and
// signed as a block; one page per question is one decision per signature, and
// the signature says which.
//
// GENERATED RATHER THAN WRITTEN, because a sheet somebody hand-writes drifts
// from the register the moment either moves — and then there are two accounts
// of what is open, which is the drift this whole family of registers exists to
// end. tests/decision-register.test.ts fails when the committed sheets stop
// matching the register.

import fs from "fs";
import path from "path";
import {
  DECISION_REGISTER, OPEN_DECISIONS, AUDIENCE_LABEL, type Decision,
} from "../src/lib/governance/decision-register";

const OUT = path.join(process.cwd(), "docs/decisions");

function sheet(d: Decision): string {
  const lines: string[] = [];
  lines.push(`# ${AUDIENCE_LABEL[d.audience]} — decision sheet`);
  lines.push("");
  lines.push(`**Reference:** \`${d.id}\`  `);
  lines.push(`**First asked:** ${d.asked}  `);
  lines.push(`**Sheet generated:** by \`scripts/gen-decision-signoffs.ts\` from the decision register`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## The question");
  lines.push("");
  lines.push(d.question);
  lines.push("");
  lines.push("## What happens while this is unanswered");
  lines.push("");
  lines.push(d.meanwhile);
  lines.push("");
  if (d.blocks.length > 0) {
    lines.push("## What this is holding up");
    lines.push("");
    for (const b of d.blocks) lines.push(`- \`${b}\``);
    lines.push("");
  }
  lines.push("## The choices");
  lines.push("");
  d.options.forEach((o, i) => {
    const letter = String.fromCharCode(97 + i).toUpperCase();
    lines.push(`### ${letter}. ${o.label}${o.recommended ? "  — *suggested*" : ""}`);
    lines.push("");
    lines.push(`${o.plainly}`);
    lines.push("");
    lines.push(`*What would change:* ${o.then}`);
    lines.push("");
  });
  lines.push("---");
  lines.push("");
  lines.push("## Decision");
  lines.push("");
  lines.push("Tick one.");
  lines.push("");
  d.options.forEach((o, i) => {
    lines.push(`- [ ] **${String.fromCharCode(97 + i).toUpperCase()}** — ${o.label}`);
  });
  lines.push("- [ ] **Something else** (write it below)");
  lines.push("");
  lines.push("**If something else, or if the choice needs a condition:**");
  lines.push("");
  lines.push("```");
  lines.push("");
  lines.push("");
  lines.push("```");
  lines.push("");
  // THE FIELDS A SIGNATURE NEEDS TO BE WORTH ANYTHING. A tick with no name is
  // an anonymous decision, and a decision with no date cannot be checked
  // against what the product did afterwards.
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push("| **Name** | |");
  lines.push("| **Role** | |");
  lines.push("| **Signature** | |");
  lines.push("| **Date** | |");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "*This sheet is generated from the decision register in the codebase. It is not a contract " +
    "and it is not clinical advice: it records which way somebody accountable chose to go, so " +
    "that what the product does afterwards can be checked against it.*"
  );
  lines.push("");
  return lines.join("\n");
}

function index(): string {
  const lines: string[] = [];
  lines.push("# Decisions waiting on a person");
  lines.push("");
  lines.push(
    "One sheet per question. Each says what the product does in the meantime, so a question can " +
    "be left open deliberately rather than by accident."
  );
  lines.push("");
  if (OPEN_DECISIONS.length === 0) {
    lines.push("**Nothing is waiting on a decision.** Every question below has been answered.");
    lines.push("");
  } else {
    lines.push("| For | Question | Sheet |");
    lines.push("|---|---|---|");
    for (const d of OPEN_DECISIONS) {
      const short = d.question.split(/(?<=\?)/)[0].trim();
      lines.push(`| ${AUDIENCE_LABEL[d.audience]} | ${short} | [\`${d.id}\`](./${d.id}.md) |`);
    }
    lines.push("");
  }

  // ANSWERED IS NOT THE SAME AS DONE WITH. "Who signs each gate" is answered —
  // one named person each — and three names are still missing. A page that
  // said nothing was open would be true and useless.
  const waiting = DECISION_REGISTER.filter((d) => d.outstanding);
  if (waiting.length > 0) {
    lines.push("## Answered, and still waiting on something");
    lines.push("");
    lines.push(
      "The decision is not in doubt. What is missing is the information needed to act on it."
    );
    lines.push("");
    lines.push("| For | Still needed |");
    lines.push("|---|---|");
    for (const d of waiting) {
      lines.push(`| ${AUDIENCE_LABEL[d.audience]} | ${d.outstanding} |`);
    }
    lines.push("");
  }
  const answered = DECISION_REGISTER.filter((d) => d.state === "answered");
  if (answered.length > 0) {
    lines.push("## Already answered");
    lines.push("");
    lines.push(
      "Kept, with the answer and its date, so the code is not left carrying a rationale nobody " +
      "can find and the next person does not re-open it."
    );
    lines.push("");
    lines.push("| Question | Decided | On |");
    lines.push("|---|---|---|");
    for (const d of answered) {
      const short = d.question.split(/(?<=\?)/)[0].trim();
      lines.push(`| ${short} | ${d.answer!.decided} | ${d.answer!.on} |`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("*Generated by `scripts/gen-decision-signoffs.ts`. Do not edit by hand — edit the register.*");
  lines.push("");
  return lines.join("\n");
}

export function sheets(): Map<string, string> {
  const out = new Map<string, string>();
  out.set("README.md", index());
  for (const d of OPEN_DECISIONS) out.set(`${d.id}.md`, sheet(d));
  return out;
}

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  // REMOVED WHEN THE QUESTION IS ANSWERED. A sheet for a decision that has been
  // taken is the same lie as a register entry nobody re-read, and it is worse
  // on paper because paper does not have a test.
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith(".md")) fs.unlinkSync(path.join(OUT, f));
  }
  const built = sheets();
  for (const [name, body] of built) fs.writeFileSync(path.join(OUT, name), body);
  console.log(`wrote ${built.size} file(s) to docs/decisions: ${OPEN_DECISIONS.length} open question(s)`);
}
