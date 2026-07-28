const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageBreak,
  Header, Footer, PageNumber,
} = require("docx");

const PROTO_VERSION = "bls-protocol-v1-DRAFT";
const PAGE_W = 12240, PAGE_H = 15840;
const CONTENT_W = 9360;
const INK = "1F2933", MUTE = "5B6b7a", RULE = "9AA5B1";
const HEADBG = "5A2A1F", HEADFG = "FFFFFF"; // warm clay for a distinct instrument
const ZEBRA = "F5F0EC", FILLBLANK = "FFFDE7", REDBG = "FBE9E7";

const REVIEWERS = [
  { name: "Rebecca Altschuler", title: "Licensed Psychologist", license: "Psychologist — PSY-005804 (Active, exp. 02/29/2028; no board actions)", juris: "Arizona (Phoenix)" },
  { name: "John Allen", title: "Licensed Psychologist", license: "Psychologist — PSY-002055 (Active, exp. 08/31/2027; no board actions)", juris: "Arizona (Tucson)" },
];

const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const CHECK = "☐";
function txt(t, o = {}) { return new TextRun({ text: t, font: "Calibri", size: o.size ?? 20, bold: o.bold, italics: o.italics, color: o.color ?? INK }); }
function p(runs, o = {}) { return new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 80, before: o.before ?? 0, line: o.line ?? 264 }, children: Array.isArray(runs) ? runs : [runs] }); }
function cell(children, o = {}) {
  return new TableCell({
    width: { size: o.w, type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    verticalAlign: o.valign ?? "top", columnSpan: o.span,
    children: Array.isArray(children) ? children : [children],
  });
}
function headRow(labels, widths) {
  return new TableRow({ tableHeader: true, children: labels.map((l, i) => cell([p(txt(l, { bold: true, color: HEADFG, size: 18 }), { after: 0 })], { w: widths[i], fill: HEADBG })) });
}
function table(widths, rows) {
  const b = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  return new Table({ width: { size: widths.reduce((a, c) => a + c, 0), type: WidthType.DXA }, columnWidths: widths,
    borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b }, rows });
}
function h(text, level) { return new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, font: "Calibri", bold: true, color: INK })] }); }
function verdict(o = {}) { return [new TextRun({ text: CHECK + " " + (o.a ?? "Approve") + "   ", font: "Calibri", size: 18 }), new TextRun({ text: CHECK + " " + (o.b ?? "Revise"), font: "Calibri", size: 18 })]; }
function line(n) { return txt("_".repeat(n), { color: RULE }); }

// ── Part 2 data: BLS parameters ──────────────────────────────────────────
// [param, current code placeholder, typical EMDR reference (caveated)]
const PARAMS = [
  ["Modality permitted (beta)", "Auditory + self-tapping only; visual BLS OFF (BLS_NO_VISUAL_BETA)", "Auditory tones / tactile taps are standard alternatives to eye movement; visual requires a11y validation"],
  ["Visual flash ceiling (if ever visual)", "≤ 3 flashes/sec (WCAG 2.3.2) — hard ceiling", "Photosensitivity safety limit; not a clinical dosing value"],
  ["Speed (Hz)", "default 1.25 Hz; range 1.0–1.5; cautious 1.0", "~1 alternation/sec is common; faster used by some clinicians"],
  ["Desensitization set length", "20–30 s per set (module content)", "~24–30 passes standard; clinicians LENGTHEN while actively processing"],
  ["Resourcing / Calm-Place set length", "not yet distinct from above", "SHORT slow sets (~4–8 passes) so it does NOT open processing"],
  ["Max sets per session (beta)", "2 (SESSION.maxSets / BETA_CONFIG)", "Beta-conservative; standard sessions run many more with a clinician"],
  ["Extend-vs-stop policy per set", "fixed length; no adaptive extension (no clinician reading client)", "Clinicians extend on active processing, stop at a natural pause — needs an unsupervised-safe rule"],
  ["Starting-SUDS gate to permit a set", "> 5 denies stimulation (SESSION.startingSudsCeiling)", "Judgment-based clinically; a fixed ceiling is the unsupervised substitute"],
  ["Between-set procedure", "collect SUDS + dissociation + orientation; then reassess", "\"What do you get now?\" + brief check; the responsive window"],
  ["Containment triggers (auto-stop)", "SUDS Δ≥2, or ≥8 absolute, or rise ≥3 over start, or 2 consecutive +1s, or dissociation ≥4, or not oriented", "Conservative union — auto fail-safes, not a substitute for clinical read"],
  ["\"Stuck\" rule", "no SUDS change across 2 sets → close (\"stuck is a stop signal\")", "Confirm the count and the interpretation"],
  ["Session time limits", "wind-down (no new sets) 30 min; hard-stop 40 min", "Confirm for an unsupervised processing session"],
  ["Closure minimum + required content", "≥ 120 s; PLUS orientation confirmation + member-reported stability + escalation path on failure", "Closure is mandatory regardless of SUDS; define the exact required content"],
  ["Incomplete-session / container", "containment → cooldown; container exercise not yet specified", "Define the incomplete-target procedure + container the system uses"],
  ["Cooldown after containment-ending", "48 h (COOLDOWN_HOURS.containmentEnding)", "Minimum rest + fresh check-in; interval pending evidence (ledger A4)"],
];

// ── Part 5 self-administered safety constraints ──────────────────────────
const CONSTRAINTS = [
  "No live clinician is reading the client — the system must NOT extend a set based on inferred processing; set length is fixed/conservative.",
  "Ground-Me: a one-tap immediate halt is reachable at all times, locks stimulation for the session, no return.",
  "Loss of present orientation or inability to follow a stop instruction is an absolute hard stop (overrides SUDS).",
  "Every spoken line is deterministic or output-guarded: never instructs worst-memory recall / sustained imagery / \"stay with it until it drops\"; never interprets a falling SUDS as improvement when dissociation is possible.",
  "Crisis / high-activation input is scripted to present-safety + jurisdiction-aware resources with truthful notification status — never AI-generated, never implies live monitoring.",
  "Mandatory closure runs even on an incomplete/aborted session; the session cannot silently end mid-processing.",
  "A network/timing failure stops the set (never catches up or resumes) and routes to grounding + closure.",
];

// ── Part 6 validation gates ──────────────────────────────────────────────
const GATES = [
  "Independent clinical review of this protocol by ≥ 2 licensed trauma clinicians (this sheet).",
  "Human-factors testing specifically on the BLS session flow (stop-control salience, interruption recovery, distress de-escalation, comprehension).",
  "Red-team closure on BLS paths: abreaction, dissociation mid-set, network drop mid-set, stop reachability, output-guard on cues.",
  "Distinct, versioned PROCESSING-SESSION consent (separate from the care-program and voice consents) + counsel review.",
  "Staged Phase-4 rollout with predefined progression + stopping criteria and a kill switch.",
];

// ── Build ────────────────────────────────────────────────────────────────
const children = [];
children.push(new Paragraph({ spacing: { after: 40 }, children: [txt("STEADY — AUTONOMOUS SAFETY SYSTEM", { bold: true, size: 22, color: HEADBG })] }));
children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: HEADBG } }, spacing: { after: 160 },
  children: [txt("Bilateral Stimulation (BLS) Protocol — Clinician Sign-Off", { bold: true, size: 32, color: INK })] }));
children.push(p([txt("Protocol version: ", { bold: true, size: 20 }), txt(PROTO_VERSION, { bold: true, size: 20, color: HEADBG }),
  txt("     Date: ", { bold: true, size: 20 }), txt("__________", { size: 20 }), txt("     Ref: ", { bold: true, size: 20 }), txt("__________________", { size: 20 })], { after: 140 }));

children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W],
  borders: { top: { style: BorderStyle.SINGLE, size: 8, color: HEADBG }, bottom: { style: BorderStyle.SINGLE, size: 8, color: HEADBG }, left: { style: BorderStyle.SINGLE, size: 8, color: HEADBG }, right: { style: BorderStyle.SINGLE, size: 8, color: HEADBG }, insideHorizontal: noBorder, insideVertical: noBorder },
  rows: [new TableRow({ children: [cell([
    p([txt("Why this sheet exists. ", { bold: true, size: 18, color: HEADBG }), txt("The clinical review of config beta-clinrev-2026-07 explicitly did NOT ratify autonomous bilateral stimulation (ledger A7: “not ratified — nothing ships without this row”). Autonomous BLS / trauma-memory reprocessing is DISABLED in beta and stays disabled until this protocol is defined and signed. This sheet is that gate.", { size: 18 })], { after: 60 }),
    p([txt("Scope. ", { bold: true, size: 18, color: HEADBG }), txt("Signing authorizes ONLY the specific, self-administered BLS protocol defined here — no live clinician is present during the session. It does not authorize general reprocessing, and it does not take effect until the Part 6 validation gates are complete. The deterministic session engine still owns every clinical stop/closure decision; this defines the parameters and the words within those rails.", { size: 18 })], { after: 0 }),
  ], { w: CONTENT_W, fill: "FBF3EE" })] })],
}));
children.push(p(txt(" ", { size: 8 })));

// Part 1 — reviewers
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 1 — Reviewer identity & credentials", HeadingLevel.HEADING_1));
children.push(p(txt("At least two independent licensed trauma clinicians must sign (Vol I App. C). Signatures applied personally in Part 7.", { size: 18, color: MUTE, italics: true })));
function reviewerBlock(n, d) {
  const W = [2600, 6760];
  const row = (label, val) => new TableRow({ children: [cell([p(txt(label, { bold: true, size: 18, color: MUTE }), { after: 0 })], { w: W[0], fill: ZEBRA, valign: "center" }), cell([p(txt(val ?? " ", { size: 18 }), { after: 0 })], { w: W[1] })] });
  return table(W, [
    new TableRow({ children: [cell([p(txt(`Reviewer ${n}`, { bold: true, color: HEADFG, size: 20 }), { after: 0 })], { w: W[0] + W[1], span: 2, fill: HEADBG })] }),
    row("Full name", d?.name), row("Professional title", d?.title), row("License type & number", d?.license), row("Jurisdiction / state", d?.juris),
    row("EMDR training / certification"), row("Trauma-clinical experience"), row("Independence attestation"),
  ]);
}
children.push(reviewerBlock(1, REVIEWERS[0]));
children.push(p(txt(" ", { size: 8 })));
children.push(reviewerBlock(2, REVIEWERS[1]));

// Part 2 — parameters
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 2 — BLS parameters (define the authoritative value for each)", HeadingLevel.HEADING_1));
children.push(p(txt("For each parameter: the current code placeholder and a common EMDR reference are shown. Enter the authoritative value you approve for a self-administered protocol (or Approve the placeholder). Reference values are for context only and require your confirmation — they are not clinical direction.", { size: 18, color: MUTE, italics: true })));
{
  const W = [2100, 3160, 2100, 2000]; // param, current, reference, authoritative == 9360
  const trs = [headRow(["Parameter", "Current placeholder (in code)", "Common EMDR reference (confirm)", "Authoritative value you approve"], W)];
  PARAMS.forEach((r, i) => {
    const fill = i % 2 ? ZEBRA : undefined;
    trs.push(new TableRow({ children: [
      cell([p(txt(r[0], { bold: true, size: 16 }), { after: 0 })], { w: W[0], fill }),
      cell([p(txt(r[1], { size: 15 }), { after: 0 })], { w: W[1], fill }),
      cell([p(txt(r[2], { size: 14, color: MUTE }), { after: 0 })], { w: W[2], fill }),
      cell([p(txt(" ", { size: 16 }), { after: 0 })], { w: W[3], fill: FILLBLANK }),
    ] }));
  });
  children.push(table(W, trs));
}

// Part 3 — verbal facilitation
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 3 — Verbal facilitation model", HeadingLevel.HEADING_1));
children.push(p([txt("Proposed design: ", { bold: true, size: 19 }), txt("light + directive DURING a set (short pre-scripted cues on a fixed cadence — e.g. “go with that,” “just notice,” “breathe” — deterministic, not listening/reacting mid-set), and responsive check-ins only BETWEEN sets and at open/close. No conversational AI runs while stimulation is active.", { size: 19 })], { after: 100 }));
[
  ["Directive during-set cue bank", "Approve a fixed, clinician-authored list of short cues the system may speak during a set. It must be deterministic and output-guarded (no reprocessing instructions)."],
  ["Between-set check-in wording", "Approve the between-set prompt(s) (e.g. “What do you notice now?”) and how a numeric SUDS is collected."],
  ["Cognitive interweaves", "Approve whether/what interweaves the system may offer if processing loops or stalls — or require it to close/ground instead (no interweave without a clinician)."],
  ["“Never say” list", "Confirm the banned outputs: worst-memory recall, sustained imagery, “stay with it until it drops,” simulated feelings, monitoring claims."],
].forEach(([k, v], i) => {
  const W = [2700, 4260, 2400];
  children.push(table(W, [new TableRow({ children: [
    cell([p(txt(k, { bold: true, size: 17 }), { after: 0 })], { w: W[0], fill: i % 2 ? ZEBRA : undefined }),
    cell([p(txt(v, { size: 16 }), { after: 0 })], { w: W[1], fill: i % 2 ? ZEBRA : undefined }),
    cell([p(verdict({ a: "Approve", b: "Needs-change" }), { after: 20 }), p(line(24), { after: 0 })], { w: W[2], fill: FILLBLANK }),
  ] })]));
});
children.push(p([txt("Required changes / approved cue text (attach a page if needed): ", { bold: true, size: 17, color: MUTE }), line(40)], { before: 100 }));
children.push(p(line(96)));

// Part 4 — contraindications & consent
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 4 — Contraindications & consent", HeadingLevel.HEADING_1));
children.push(p(txt("Confirm who may NEVER do autonomous BLS, and the consent required. Mark Approve or write the correct rule.", { size: 18, color: MUTE, italics: true })));
[
  "Exclusions: high dissociation (e.g. DES-II threshold — DES-II currently omitted in beta), acute trauma window, standing restrictions (psychotic/dissociative dx, recent hospitalization, substance dependence pending human review), and anyone flagged not-safe today.",
  "A distinct, versioned PROCESSING-SESSION consent is required before any BLS set (separate from care-program + voice consents), disclosing that no live clinician is present and no real-time monitoring occurs.",
  "The member may stop at any time; stopping early is never penalized and is stated up front.",
].forEach((t) => children.push(p([new TextRun({ text: CHECK + "  ", font: "Calibri", size: 20 }), txt(t, { size: 18 })], { after: 60 })));
children.push(p([txt("Corrections: ", { bold: true, size: 17, color: MUTE }), line(70)], { before: 60 }));

// Part 5 — self-administered safety
children.push(h("Part 5 — Self-administered safety constraints (confirm each is adequate)", HeadingLevel.HEADING_2));
CONSTRAINTS.forEach((t) => children.push(p([new TextRun({ text: CHECK + "  ", font: "Calibri", size: 20 }), txt(t, { size: 18 })], { after: 60 })));

// Part 6 — validation gates
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 6 — Validation gates before any real-member BLS session", HeadingLevel.HEADING_1));
children.push(p(txt("None of these is waived by this sign-off; the protocol may not run for a real member until all are complete + documented.", { size: 18, color: MUTE, italics: true })));
{
  const W = [6560, 2800];
  const trs = [headRow(["Gate", "Status + evidence reference"], W)];
  GATES.forEach((g, i) => trs.push(new TableRow({ children: [
    cell([p(txt(g, { size: 18 }), { after: 0 })], { w: W[0], fill: i % 2 ? ZEBRA : undefined }),
    cell([p([new TextRun({ text: CHECK + " Complete   " + CHECK + " Pending", font: "Calibri", size: 16 })], { after: 20 }), p(txt("Ref: ____________", { size: 15, color: MUTE }), { after: 0 })], { w: W[1], fill: i % 2 ? ZEBRA : undefined }),
  ] })));
  children.push(table(W, trs));
}

// Part 7 — attestation & signatures
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 7 — Attestation & signatures", HeadingLevel.HEADING_1));
children.push(p([txt("By signing, each reviewer attests that: they are an independent, licensed trauma clinician; they have defined/confirmed the BLS parameters, verbal model, contraindications, and safety constraints above for a SELF-ADMINISTERED protocol with no live clinician present; and that no autonomous BLS may run for a real member until the Part 6 gates are complete. This authorization applies only to protocol version ", { size: 20 }), txt(PROTO_VERSION, { bold: true, size: 20 }), txt("; any change to an approved parameter voids it and requires renewed review. Signatures must be applied personally by the named reviewers.", { size: 20 })]));
children.push(p(txt("Overall determination:", { bold: true, size: 20 }), { before: 120, after: 60 }));
[
  "Protocol APPROVED for validation (Part 6) — all parameters set, no blocking Needs-change.",
  "Approved WITH CONDITIONS (list below).",
  "NOT approved — autonomous BLS remains disabled.",
].forEach((t) => children.push(p([new TextRun({ text: CHECK + "  ", font: "Calibri", size: 22 }), txt(t, { size: 20 })], { after: 60 })));
children.push(p([txt("Conditions / notes: ", { bold: true, size: 18, color: MUTE }), line(66)], { before: 40, after: 40 }));
children.push(p(line(96), { after: 160 }));
function sig(n, d) {
  const W = [4680, 4680];
  return table(W, [
    new TableRow({ children: [
      cell([p(line(38), { after: 20 }), p(txt(`Reviewer ${n} — signature`, { size: 16, color: MUTE }), { after: 0 })], { w: W[0] }),
      cell([p(txt(`${d.name} / ${d.license.split("(")[0].trim()}`, { size: 16 }), { after: 20 }), p(txt("Printed name / license #", { size: 16, color: MUTE }), { after: 0 })], { w: W[1] }),
    ] }),
    new TableRow({ children: [
      cell([p(line(22), { after: 20 }), p(txt("Date", { size: 16, color: MUTE }), { after: 0 })], { w: W[0] }),
      cell([p(txt(" ", { size: 16 }), { after: 0 })], { w: W[1] }),
    ] }),
  ]);
}
children.push(sig(1, REVIEWERS[0]));
children.push(p(txt(" ", { size: 10 })));
children.push(sig(2, REVIEWERS[1]));

const doc = new Document({
  creator: "Steady", title: "Steady BLS Protocol — Clinician Sign-Off",
  styles: { default: { document: { run: { font: "Calibri", size: 20, color: INK } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 27, bold: true, color: HEADBG, font: "Calibri" }, paragraph: { spacing: { before: 260, after: 130 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: RULE } } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 22, bold: true, color: INK, font: "Calibri" }, paragraph: { spacing: { before: 200, after: 100 } } },
    ] },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [txt("Steady — BLS Protocol Sign-Off  ·  " + PROTO_VERSION, { size: 14, color: MUTE })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0 }, children: [new TextRun({ text: "Confidential clinical governance record — ", font: "Calibri", size: 14, color: MUTE }), new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: "Calibri", size: 14, color: MUTE })] })] }) },
    children,
  }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(process.argv[2], buf); console.log("wrote", process.argv[2], buf.length, "bytes"); });
