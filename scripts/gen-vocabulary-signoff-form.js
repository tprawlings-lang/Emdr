// The clinician sign-off form for the display vocabulary.
//
// WHY A NEW FORM RATHER THAN REUSING THE 2026-07-22 SIGNATURES. The two
// reviewers who signed `beta-clinrev-2026-07` attached three conditions, and
// the third is this one:
//
//   "Any material configuration change resets sign-off and requires renewed
//    clinician review."
//
// Eighty-six clinician-facing terms that did not exist on 22 July are a
// material change by any reading, and the safest reading is theirs. Recording
// their names against this content because they signed something else would be
// the drift every guard in this repository exists to catch, committed against
// the one record that matters most.
//
// So this is the same two reviewers, the same house form, and a fresh
// signature. It follows scripts/gen-signoff-form.js in layout and palette so it
// reads as the document they have signed twice before.
//
//   node scripts/gen-vocabulary-signoff-form.js docs/approvals/<name>.docx

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageBreak,
  Header, Footer, PageNumber,
} = require("docx");

// The vocabulary and its binding, read from the source of truth rather than
// retyped — the whole point of the hash is that the form and the product
// cannot disagree about what was reviewed.
const { execFileSync } = require("child_process");
const payload = JSON.parse(execFileSync("npx", ["tsx", "-e", `
  import { EVENT_TERMS } from "./src/lib/clinical/event-vocabulary";
  import { DISPLAY_VOCABULARY_APPROVAL as A, vocabularyHash } from "./src/lib/governance/clinical-approval";
  process.stdout.write(JSON.stringify({ terms: EVENT_TERMS, approval: A, hash: vocabularyHash() }));
`], { cwd: process.cwd(), maxBuffer: 1 << 24 }).toString());

const TERMS = payload.terms;
const A = payload.approval;
const HASH = payload.hash;
const REF = "STEADY-VOCAB-CLINREV-2026-09-18-01";

const REVIEWERS = [
  { name: "Rebecca Altschuler, PhD", title: "Licensed Psychologist", license: "Psychologist — AZ PSY-005804 (Active, no board actions)", juris: "Arizona (Phoenix)" },
  { name: "John Allen, PhD", title: "Licensed Psychologist", license: "Psychologist — AZ PSY-002055 (Active, no board actions)", juris: "Arizona (Tucson)" },
];

const PAGE_W = 12240, PAGE_H = 15840;
const INK = "1F2933", MUTE = "5B6B7A", RULE = "9AA5B1";
const HEADBG = "1F3A5F", HEADFG = "FFFFFF";
const ZEBRA = "F0F3F7", FILLBLANK = "FFFDE7", AMBERBG = "FFF8E1";
const CHECK = "☐";

function txt(text, o = {}) {
  return new TextRun({ text, font: "Calibri", size: o.size ?? 20, bold: o.bold, italics: o.italics, color: o.color ?? INK });
}
function p(runs, o = {}) {
  return new Paragraph({
    alignment: o.align, spacing: { after: o.after ?? 80, before: o.before ?? 0, line: o.line ?? 264 },
    children: Array.isArray(runs) ? runs : [runs],
  });
}
function cell(children, o = {}) {
  return new TableCell({
    width: { size: o.w, type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    verticalAlign: o.valign ?? "top",
    columnSpan: o.span,
    children: Array.isArray(children) ? children : [children],
  });
}
function headRow(labels, widths) {
  return new TableRow({
    tableHeader: true,
    children: labels.map((l, i) =>
      cell([p(txt(l, { bold: true, color: HEADFG, size: 18 }), { after: 0 })], { w: widths[i], fill: HEADBG })),
  });
}
function table(widths, rows) {
  const b = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  return new Table({
    width: { size: widths.reduce((a, c) => a + c, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
    rows,
  });
}
function h(text, level) {
  return new Paragraph({
    heading: level, spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: "Calibri", bold: true, color: INK })],
  });
}
function blankLine(label, len = 60) {
  return p([txt(label + "  ", { bold: true, color: MUTE, size: 18 }), txt("_".repeat(len), { color: RULE })], { after: 140 });
}

const children = [];

// ---- title ---------------------------------------------------------------
children.push(p(txt("STEADY — CLINICAL DISPLAY VOCABULARY", { bold: true, size: 22, color: HEADBG }), { after: 40 }));
children.push(p(txt("Clinician review and sign-off form", { bold: true, size: 30 }), { after: 60 }));
children.push(p(txt(`Reference ${REF} · ${A.id} · prepared 18 September 2026`, { color: MUTE, size: 18 }), { after: 200 }));

// ---- why this needs a fresh signature ------------------------------------
children.push(h("Why you are being asked again", HeadingLevel.HEADING_1));
children.push(table([9360], [
  new TableRow({ children: [cell([
    p(txt("Your sign-off of 22 July 2026 (ref STEADY-CLINREV-2026-07-22-01) attached three conditions. The third reads:", { size: 19 })),
    p(txt("“Any material configuration change resets sign-off and requires renewed clinician review.”", { italics: true, size: 19 })),
    p(txt(`This form covers ${Object.keys(TERMS).length} clinician-facing terms that did not exist in July. They are a material change, so the July signatures do not extend to them and nothing in the product claims that they do. Until this form is signed, Steady displays these words with a notice saying they carry no clinical approval.`, { size: 19 }), { after: 0 }),
  ], { w: 9360, fill: AMBERBG })] }),
]));

// ---- what is being reviewed ---------------------------------------------
children.push(h("What you are reviewing", HeadingLevel.HEADING_1));
children.push(p(txt(A.scope, { size: 19 })));
children.push(p(txt("Each term replaces a raw event identifier in the Event column of a person's audit record. The raw identifier is still shown beneath the term — nothing is hidden — and each term carries a note stating what the event does and does not mean. Those notes are part of what you are approving: they are where the clinical boundaries live (opened is not reviewed; recorded is not delivered; proposed is not accepted).", { size: 19 })));
children.push(p([txt("Where these appear: ", { bold: true, size: 19 }), txt(A.appliesTo.join(", "), { size: 19 })]));

children.push(h("What this approval does NOT cover", HeadingLevel.HEADING_2));
for (const e of A.excludes) children.push(p(txt("• " + e, { size: 19 }), { after: 60 }));

children.push(h("What your signature is bound to", HeadingLevel.HEADING_2));
children.push(p(txt("Steady records this signature against a cryptographic hash of the exact words below — every key, every term and every note. If a single word changes afterwards, the hash no longer matches and the product reports these words as unapproved again rather than inheriting your signature.", { size: 19 })));
children.push(p([txt("Content hash (SHA-256): ", { bold: true, size: 18 }), txt(HASH, { size: 16, color: MUTE })], { after: 200 }));

// ---- reviewers -----------------------------------------------------------
children.push(h("Reviewers", HeadingLevel.HEADING_1));
children.push(table([2600, 2400, 3160, 1200], [
  headRow(["Name", "Title", "Licence", "Jurisdiction"], [2600, 2400, 3160, 1200]),
  ...REVIEWERS.map((r, i) => new TableRow({
    children: [
      cell([p(txt(r.name, { bold: true, size: 18 }), { after: 0 })], { w: 2600, fill: i % 2 ? ZEBRA : undefined }),
      cell([p(txt(r.title, { size: 18 }), { after: 0 })], { w: 2400, fill: i % 2 ? ZEBRA : undefined }),
      cell([p(txt(r.license, { size: 18 }), { after: 0 })], { w: 3160, fill: i % 2 ? ZEBRA : undefined }),
      cell([p(txt(r.juris, { size: 18 }), { after: 0 })], { w: 1200, fill: i % 2 ? ZEBRA : undefined }),
    ],
  })),
]));

// ---- the words -----------------------------------------------------------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h(`The words (${Object.keys(TERMS).length})`, HeadingLevel.HEADING_1));
children.push(p(txt("Mark each term. “Needs change” on any row is enough to withhold overall approval — write the replacement wording in the margin or on the final page.", { size: 19, italics: true }), { after: 140 }));

const W = [2300, 2200, 3660, 1200];
const rows = [headRow(["Event identifier", "Term shown", "What it means / does not mean", "Verdict"], W)];
Object.keys(TERMS).sort().forEach((k, i) => {
  const t = TERMS[k];
  const fill = i % 2 ? ZEBRA : undefined;
  rows.push(new TableRow({
    children: [
      cell([p(txt(k, { size: 15, color: MUTE }), { after: 0 })], { w: W[0], fill }),
      cell([p(txt(t.term, { size: 17, bold: true }), { after: 0 })], { w: W[1], fill }),
      cell([p(txt(t.note, { size: 16 }), { after: 0 })], { w: W[2], fill }),
      cell([p(txt(`${CHECK} Agree`, { size: 16 }), { after: 20 }), p(txt(`${CHECK} Needs change`, { size: 16 }), { after: 0 })], { w: W[3], fill: FILLBLANK }),
    ],
  }));
});
children.push(table(W, rows));

// ---- determination -------------------------------------------------------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Overall determination", HeadingLevel.HEADING_1));
children.push(p(txt(`${CHECK}  Approved as written.`, { size: 20 })));
children.push(p(txt(`${CHECK}  Approved with the changes marked above.`, { size: 20 })));
children.push(p(txt(`${CHECK}  Not approved.`, { size: 20 }), { after: 160 }));
children.push(p(txt("Conditions or notes:", { bold: true, size: 19 })));
for (let i = 0; i < 4; i++) children.push(p(txt("_".repeat(96), { color: RULE }), { after: 120 }));

children.push(h("Signatures", HeadingLevel.HEADING_1));
for (const r of REVIEWERS) {
  children.push(p(txt(r.name + " — " + r.license, { bold: true, size: 19 }), { before: 160, after: 100 }));
  children.push(blankLine("Signature", 52));
  children.push(blankLine("Date", 28));
}
children.push(p(txt("Return the signed form to the Steady product owner. The signature is recorded in src/lib/governance/clinical-approval.ts against the content hash on page 1, and the stored record at " + A.document + " is regenerated from it.", { size: 17, color: MUTE }), { before: 240 }));

const doc = new Document({
  styles: { default: { document: { run: { font: "Calibri", size: 20, color: INK } } } },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 } } },
    headers: { default: new Header({ children: [p(txt(`Steady — clinical display vocabulary sign-off · ${REF}`, { size: 16, color: MUTE }), { after: 0 })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt("Page ", { size: 16, color: MUTE }), new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 16, color: MUTE })] })] }) },
    children,
  }],
});

// Where the approval record says the form lives, so the document that points
// reviewers at a file and the script that writes it cannot disagree.
const out = process.argv[2] || A.signoffForm;
fs.mkdirSync(path.dirname(out), { recursive: true });
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log(`wrote ${out}: ${Object.keys(TERMS).length} terms, hash ${HASH.slice(0, 12)}…`);
});
