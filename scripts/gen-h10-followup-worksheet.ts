// The Handoff 10 follow-up worksheet: every question and sign-off still owed
// by a clinician (or the founder) after the 24 September review, as a
// printable PDF to send, mark and sign.
//
//   npx tsx scripts/gen-h10-followup-worksheet.ts
//     -> docs/approvals/handoff-10-followup-worksheet-2026-09-25.pdf
//
// Built from the registers, not typed: the decision register (questions and
// options), the content_v10 rows (Lane E and F), the signed record's
// interpretations and the pending knowledge-base row. So the sheet says what
// the app records, and when an answer comes back it goes into the same place.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { DECISION_REGISTER, type Decision } from "../src/lib/governance/decision-register";
import { CONTENT_RULES } from "../src/lib/content-signoff";
import { CONTENT_V10_APPROVAL } from "../src/lib/content-approval";
import { THERAPY_KB_RULES } from "../src/lib/therapy-kb/signoff";
import { LANE_MODULES, DISTRESS_CEILING_FLAG, DISTRESS_RISE_FLAG } from "../src/lib/content/h10-assigned-lane";

const DATE = "2026-09-25";
// Version 2 adds Handoff 11 (the evolvedMD evaluation build): rows CV11_01 to
// CV11_05 and its questions for evolvedMD. It supersedes version 1 of the same day.
const REF = "STEADY-CLINREV-2026-09-25-10F-v2";
const OUT = path.join(process.cwd(), `docs/approvals/handoff-10-followup-worksheet-${DATE}.pdf`);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const byId = (id: string) => {
  const d = DECISION_REGISTER.find((x) => x.id === id);
  if (!d) throw new Error(`decision ${id} is not in the register`);
  return d;
};

let n = 0;
function decisionItem(d: Decision, confirm = false, signers = 2): string {
  n += 1;
  const options = d.options.map((o) => `
    <li><span class="box"></span><b>${esc(o.label)}</b>${o.recommended ? ' <span class="rec">recommended</span>' : ""}
      <div class="plain">${esc(o.plainly)} <i>Then:</i> ${esc(o.then)}</div></li>`).join("");
  return `
  <section class="item">
    <div class="id">${n}. <code>${esc(d.id)}</code>${confirm ? ' <span class="tag">answered by the product owner — please confirm</span>' : ""}</div>
    <p class="q">${esc(d.question)}</p>
    <p class="now"><b>${confirm && d.answer ? "Decided" : "What happens now"}:</b> ${esc(confirm && d.answer ? d.answer.decided : d.meanwhile)}</p>
    <ul class="opts">${options}
      <li><span class="box"></span><b>Something else</b> <span class="line"></span></li></ul>
    <div class="notes">Notes:</div>
    <div class="initials">Initials ${Array(signers).fill("______").join(" ")}</div>
  </section>`;
}

function confirmItem(title: string, body: string, choices = ["Confirm as written", "Needs change (say what)"]): string {
  n += 1;
  return `
  <section class="item">
    <div class="id">${n}. ${esc(title)}</div>
    <p class="q">${esc(body)}</p>
    <ul class="opts">${choices.map((c) => `<li><span class="box"></span><b>${esc(c)}</b></li>`).join("")}</ul>
    <div class="notes">Notes:</div>
    <div class="initials">Initials ______ ______</div>
  </section>`;
}

function rowItem(id: string, reason: string, built: string): string {
  n += 1;
  return `
  <section class="item">
    <div class="id">${n}. <code>${id}</code></div>
    <p class="q">${esc(reason)}</p>
    <p class="now"><b>What is built:</b> ${esc(built)}</p>
    <ul class="opts">
      <li><span class="box"></span><b>Approve</b></li>
      <li><span class="box"></span><b>Approve with changes</b> (write them below)</li>
      <li><span class="box"></span><b>Needs change</b></li>
    </ul>
    <div class="notes">Notes:</div>
    <div class="initials">Initials ______</div>
  </section>`;
}

function signature(who: string, lines: string[]): string {
  return `<div class="sig"><h3>${esc(who)}</h3>${lines.map((l) => `
    <div class="sigrow"><span>${esc(l)}</span><span class="sl"></span><span>Date</span><span class="sd"></span></div>`).join("")}</div>`;
}

const rule = (id: string) => {
  const r = CONTENT_RULES.find((x) => x.id === id);
  if (!r) throw new Error(`row ${id} is missing`);
  return r.reason;
};

// ── Part A: the two psychologists ────────────────────────────────────────────

const OPEN_FOR_PSYCHOLOGISTS = DECISION_REGISTER.filter(
  (d) => d.audience === "clinical" && d.state === "open" && !d.id.startsWith("partner.")
);
const CONFIRM_ANSWERED = ["clinical.sleep-entry-screen-retake", "clinical.complex-path-program-before-review"].map(byId);
const kbRow = THERAPY_KB_RULES.find((r) => r.id === "KB_SELF_HOLD_REPLACES_BUTTERFLY");
if (!kbRow) throw new Error("KB_SELF_HOLD_REPLACES_BUTTERFLY is missing");

const partA = [
  `<h2>Part A — For Rebecca Altschuler, PhD, and John Allen, PhD</h2>
   <p class="lede">Follow-ups to the 24 September review (${CONTENT_V10_APPROVAL.reference}). Each item says what the app does today; mark one option or write your own. Nothing here changes a row you already signed unless you say so.</p>
   <h3>A1. Open questions</h3>`,
  ...OPEN_FOR_PSYCHOLOGISTS.map((d) => decisionItem(d)),
  `<h3>A2. Decisions the product owner made on 25 September — please confirm</h3>`,
  ...CONFIRM_ANSWERED.map((d) => decisionItem(d, true)),
  `<h3>A3. Wording and readings to confirm</h3>`,
  confirmItem("Row KB_SELF_HOLD_REPLACES_BUTTERFLY (unsigned)", kbRow.reason, ["Approve", "Needs change (say what)"]),
  confirmItem(
    "\"Marching in place\" in the skill \"Move it out\" (S04, signed as A02/A03)",
    "Step 1 reads: \"Pick something your body can do safely: a brisk walk, marching in place, pushing against a wall.\" Marching alternates left and right in a steady rhythm, which is close to the bilateral shape v1 excludes. It was signed as written and ships as written. Should it stay, or be replaced (for example with \"standing up and stretching\")?",
    ["Keep as written", "Replace (write the wording)"]
  ),
  ...CONTENT_V10_APPROVAL.interpretations.map((t, i) =>
    confirmItem(`How the 24 September sheet was read (${i + 1} of ${CONTENT_V10_APPROVAL.interpretations.length})`, t, ["That is what we meant", "We meant something else (say what)"])
  ),
  `<h3>A4. Handoff 11 (the evolvedMD evaluation build): rows for you</h3>
   <p class="lede">Handoff 11 names you as reviewers of these three. None is built yet; each says what will be.</p>`,
  rowItem("CV11_02", rule("CV11_02"), "Not built yet (Handoff 11 package 3). Until this row is approved, nothing a member writes reaches the care team, which is today's rule."),
  rowItem("CV11_03", rule("CV11_03"), "Not written yet (package 11). Steady will draft it for this row; it stays in the demo and evaluation tenant, marked pending review, until approved."),
  rowItem("CV11_05", rule("CV11_05"), "Not built yet (package 6). The prompt's wording will be added to this row before it is shown to anyone."),
  signature("Part A sign-off", ["Rebecca Altschuler, PhD (AZ PSY-005804)", "John Allen, PhD (AZ PSY-002055)"]),
].join("\n");

// ── Part B: the partner's clinical lead (Lane E) ─────────────────────────────

const lane = (id: string) => LANE_MODULES.find((m) => m.moduleId === id)!;
const BUILT: Record<string, string> = {
  CV10_E01:
    `Built and testable in the demo only. A practice is listed only for a person with a live assignment, which must have an end date; an expired or guessed link says "not available". Each start asks the existing safety engine (steady tier, no crisis today, no dissociation hold). Distress 0 to 10 before and after; a rise of ${DISTRESS_RISE_FLAG} or more, or above ${DISTRESS_CEILING_FLAG}, shows grounding and SOS and alerts the care team. Stop is on every step and is never counted against anyone.`,
  CV10_E02:
    `"${lane("wet-v1").title}", about ${lane("wet-v1").expectedMinutes} minutes. No protocol text: the partner supplies it; the demo shows placeholders. Writing is encrypted, readable by the person and the assigning clinician only, and unreachable from the companion and every AI path (tested).`,
  CV10_E03: `"${lane("cpt-worksheets-v1").title}", about ${lane("cpt-worksheets-v1").expectedMinutes} minutes. Worksheet boxes the partner defines; the same handling as E02.`,
  CV10_E04: `"${lane("irt-nightmares-v1").title}", about ${lane("irt-nightmares-v1").expectedMinutes} minutes. The same handling as E02; no content until supplied.`,
  CV10_E05: "Nothing is written by Steady. Each practice records its content owner as the partner and cannot run outside the demo until the partner's licensed content is loaded.",
};
const PARTNER_QUESTIONS = DECISION_REGISTER.filter((d) => d.id.startsWith("partner.") && d.state === "open");

const partB = [
  `<h2 class="break">Part B — For evolvedMD's clinical lead (Lane E, and Handoff 11)</h2>
   <p class="lede">The clinician-assigned lane was built ahead of its gate on the product owner's instruction (25 September) so a team can review and test it. It is not live: outside the demo it does not exist until these rows are approved. This part is for the clinical lead of the provider partner who will assign and review, not for Part A's reviewers.</p>
   <h3>B1. Rows</h3>`,
  ...["CV10_E01", "CV10_E02", "CV10_E03", "CV10_E04", "CV10_E05"].map((id) => rowItem(id, rule(id), BUILT[id])),
  `<h3>B2. Handoff 11 rows</h3>`,
  rowItem("CV11_01", rule("CV11_01"), "Not built yet (Handoff 11 package 4). The rules are written into this row as the handoff gives them; confirm or change them before they sort anyone's queue."),
  rowItem("CV11_04", rule("CV11_04"), "Not built yet (package 8). Today the member's crisis path is 988 and SOS; no care-team contact is shown until you supply one (question below)."),
  `<h3>B3. Questions</h3>`,
  ...PARTNER_QUESTIONS.map((d) => decisionItem(d, false, 1)),
  signature("Part B sign-off", ["Partner clinical lead (name, credentials, licence)"]),
].join("\n");

// ── Part C: the founder (not clinical) ───────────────────────────────────────

const partC = [
  `<h2 class="break">Part C — For you (founder, with counsel): not clinical</h2>
   <p class="lede">Items no clinician can sign. Tick when done and file the document where noted.</p>`,
  confirmItem("F01 — sleep measure licence", `${rule("CV10_F01")} You signed F01; the licence itself is not in the repository. Until its item text is supplied, the sleep program adds no measure (C05).`, ["Licence filed (where)", "Not yet"]),
  confirmItem("F04 — audio rights", `${rule("CV10_F04")} You signed F04; the agreements are not in the repository, and no recordings exist yet. Package 11 (audio) waits on them.`, ["Agreements filed (where)", "Not yet"]),
  confirmItem(
    "Phase 3 — before any real person uses the clinician-assigned lane",
    "Handoff 10 §6 lists four conditions and the lane was built before them on your instruction: (1) Handoff 03's activation gate, including the repo delta note and Handoff 02's scheduler; (2) a signed provider partner whose clinicians assign and review; (3) licensed protocol content from that partner; (4) HIPAA posture, a BAA, and the Postgres cutover. Part B's sign-off is also required.",
    ["Acknowledged: none of the four is met today", "Some are met (say which)"]
  ),
  signature("Part C sign-off", ["Founder"]),
].join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Handoff 10 follow-up worksheet</title>
<style>
  @page { size: Letter; margin: 0.7in 0.75in; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1F2933; font-size: 10.5pt; line-height: 1.4; }
  h1 { font-size: 18pt; margin: 0 0 4pt; } h2 { font-size: 14pt; margin: 18pt 0 4pt; color: #1F3A5F; }
  h3 { font-size: 11.5pt; margin: 14pt 0 6pt; } .break { page-break-before: always; }
  h2, h3 { break-after: avoid; page-break-after: avoid; }
  .meta { color: #5B6B7A; font-size: 9.5pt; } .lede { color: #3a4754; }
  .item { border: 1px solid #C9D1DA; border-radius: 6pt; padding: 8pt 10pt; margin: 8pt 0; page-break-inside: avoid; }
  .id { font-size: 9.5pt; color: #5B6B7A; } code { font-size: 9pt; }
  .q { margin: 4pt 0; font-weight: 600; } .now { margin: 4pt 0; background: #FFF8E1; padding: 4pt 6pt; border-radius: 4pt; }
  .opts { list-style: none; padding: 0; margin: 6pt 0; } .opts li { margin: 4pt 0; }
  .box { display: inline-block; width: 10pt; height: 10pt; border: 1.2px solid #1F2933; margin-right: 6pt; vertical-align: -1pt; }
  .plain { margin-left: 16pt; color: #3a4754; font-size: 9.5pt; }
  .rec { font-size: 8pt; background: #E3F1E7; color: #1E5B34; padding: 1pt 4pt; border-radius: 3pt; }
  .tag { font-size: 8pt; background: #E8EEF7; color: #1F3A5F; padding: 1pt 4pt; border-radius: 3pt; }
  .line { display: inline-block; width: 60%; border-bottom: 1px solid #9AA5B1; }
  .notes { margin-top: 6pt; height: 32pt; border-bottom: 1px solid #9AA5B1; color: #5B6B7A; font-size: 9pt; }
  .initials { text-align: right; font-size: 9pt; color: #5B6B7A; margin-top: 4pt; }
  .sig { margin-top: 14pt; page-break-inside: avoid; } .sigrow { display: flex; gap: 8pt; align-items: flex-end; margin: 14pt 0; }
  .sl { flex: 1; border-bottom: 1px solid #1F2933; } .sd { width: 90pt; border-bottom: 1px solid #1F2933; }
</style></head><body>
<h1>Steady — Handoff 10 and 11: clinical questions and sign-off</h1>
<p class="meta">Reference ${REF} · Prepared ${DATE} · Follows ${CONTENT_V10_APPROVAL.reference} · Generated from the app's registers by scripts/gen-h10-followup-worksheet.ts</p>
<p class="lede">Three parts, for three different people. Part A is for the two psychologists who signed the 24 September review. Part B is for evolvedMD's clinical lead (Handoff 11 names evolvedMD as the partner). Part C is the founder's. Mark one option per item, add notes, initial, and sign at the end of your part.</p>
${partA}
${partB}
${partC}
</body></html>`;

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.pdf({ path: OUT, format: "Letter", printBackground: true, displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="font-size:8px;color:#5B6B7A;width:100%;text-align:center">${REF} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    margin: { top: "0.7in", bottom: "0.7in", left: "0.75in", right: "0.75in" } });
  await browser.close();
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${n} items)`);
}

void main();
