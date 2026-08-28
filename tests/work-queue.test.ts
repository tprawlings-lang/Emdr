// The clinician work queue (GUI and Decision-Surface Handoff §10.3, §20.3).
//
// §20.3's acceptance criteria are the specification, and each is a property
// that is easy to break by accident later:
//
//   "Queue order is stable for the same policy version and evidence set."
//   "Each work item states why it exists and when the evidence arrived."
//   "Duplicate events collapse without losing count or evidence."
//   "Safety-stop override does not appear."
//
// Stability matters more than it looks. An unstable queue means "the third row"
// is not a thing a clinician can say to a colleague, and it means a row can
// move under the cursor between a glance and a click.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { GROUP_LABEL, inGroup, type WorkItem, type WorkQueue, type WorkGroup } from "../src/lib/clinical/work-queue";

// The sort and collapse rules are exercised through a hand-built queue rather
// than the database, so the properties are tested rather than the seed.
function item(over: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    group: "needs_action", band: "standard", personId: "p1", personName: "A",
    reason: "r", change: null, evidenceAt: "2026-08-28 10:00:00",
    ownerId: null, ownerName: null, dueAt: null, overdue: false,
    eventCount: 1, action: "review", actionable: true, blockedReason: null,
    ...over,
  } as WorkItem;
}

test("every group has a human label", () => {
  const groups: WorkGroup[] = [
    "needs_action", "review_today", "waiting_member", "waiting_staff", "recently_resolved",
  ];
  for (const g of groups) {
    assert.ok(GROUP_LABEL[g] && GROUP_LABEL[g].length > 3, `group ${g} has no label`);
  }
});

test("inGroup preserves queue order rather than re-sorting", () => {
  // The page renders per group; if inGroup sorted, the server's ordering
  // decision would be silently overridden on the way to the screen.
  const q = {
    items: [
      item({ id: "c", group: "needs_action" }),
      item({ id: "a", group: "review_today" }),
      item({ id: "b", group: "needs_action" }),
    ],
  } as WorkQueue;
  assert.deepEqual(inGroup(q, "needs_action").map((i) => i.id), ["c", "b"]);
});

test("the projection module never sorts in the component layer", () => {
  // §20.1: "No client component recalculates safety or priority." The row and
  // the page must not contain a sort, a band comparison, or a filter that
  // reorders — the projection decided, and a second opinion in the client is
  // how two orderings start to disagree.
  const files = [
    "src/components/clinical/WorkQueueRow.tsx",
    "src/app/clinician/work/page.tsx",
  ];
  const offenders: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(process.cwd(), f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    if (/\.sort\(/.test(src)) offenders.push(`${f} — sorts in the client`);
    // filter() by group is how the page splits an already-ordered list; a
    // filter on band or overdue would be re-triage.
    if (/\.filter\([^)]*\b(band|overdue|priority)\b/.test(src)) {
      offenders.push(`${f} — re-triages by band/overdue in the client`);
    }
  }
  assert.deepEqual(offenders, [], "priority is being recomputed client-side:\n  " + offenders.join("\n  "));
});

test("no clinical surface offers a safety-stop override", () => {
  // §15.2: "Attempt safety-stop override — do not render the action." Absent,
  // not disabled: a disabled control still teaches that the override exists and
  // is merely unavailable today.
  const walk = (d: string): string[] => {
    if (!fs.existsSync(d)) return [];
    const out: string[] = [];
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  };
  const offenders: string[] = [];
  for (const f of [...walk("src/app/clinician"), ...walk("src/components/clinical")]) {
    const src = fs.readFileSync(f, "utf8");
    // A <button>/<Link> whose visible text offers to override a safety stop.
    if (/>\s*[^<]{0,40}override[^<]{0,20}(safety|stop)[^<]{0,20}</i.test(src)) {
      offenders.push(path.relative(process.cwd(), f));
    }
  }
  assert.deepEqual(offenders, [], "a safety-stop override is rendered:\n  " + offenders.join("\n  "));
});

test("the row renders every field §10.3 requires", () => {
  // Read as source rather than rendered, because the point is that the field is
  // WIRED — a row that renders seven of eight pushes the eighth question back
  // onto the clinician.
  const src = fs.readFileSync("src/components/clinical/WorkQueueRow.tsx", "utf8");
  const required: Array<[string, RegExp]> = [
    ["priority band", /PriorityBadge/],
    ["person identity", /item\.personName/],
    ["reason for appearing", /item\.reason/],
    ["change since last review", /item\.change/],
    ["evidence time", /FreshnessLabel|item\.evidenceAt/],
    ["current owner", /OwnerChip/],
    ["due or response target", /DueLabel|item\.dueAt/],
    ["event count for collapsed rows", /item\.eventCount/],
  ];
  const missing = required.filter(([, rx]) => !rx.test(src)).map(([w]) => w);
  assert.deepEqual(missing, [], "the work row omits required fields: " + missing.join(", "));
});

test("a blocked row explains itself instead of offering a dead control", () => {
  // Comments stripped: the row's own note explaining why there is no disabled
  // control would otherwise trip the check that there is no disabled control.
  const src = fs.readFileSync("src/components/clinical/WorkQueueRow.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.match(src, /item\.blockedReason/,
    "a row the clinician cannot action does not say why");
  assert.doesNotMatch(src, /\bdisabled\b/,
    "the row renders a disabled control; §23.2 wants an owner and a possible action, " +
    "and a disabled button is neither");
});

test("state is never carried by colour alone", () => {
  // §12.2: "Never rely on green, amber, or red alone. Every state needs an
  // icon, a label, and one-sentence meaning." Each badge map must pair its
  // colour class with a glyph and a word.
  const src = fs.readFileSync("src/components/clinical/primitives.tsx", "utf8");
  const bandBlock = /const BAND_STYLE[\s\S]*?\n};/.exec(src);
  assert.ok(bandBlock, "no band style map found");
  const lines = bandBlock![0].split("\n").filter((l) => /cls:/.test(l));
  assert.ok(lines.length >= 5, "expected a style per band");
  for (const l of lines) {
    assert.match(l, /glyph:/, `a band carries colour with no glyph: ${l.trim()}`);
    assert.match(l, /label:/, `a band carries colour with no label: ${l.trim()}`);
  }
});

test("freshness is rendered against a server time, not the browser clock", () => {
  // §8.1: the client must not "fabricate freshness". A Date.now() in these
  // components would drift from the projection the moment the page sat open.
  for (const f of ["src/components/clinical/primitives.tsx", "src/components/clinical/WorkQueueRow.tsx"]) {
    const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    assert.doesNotMatch(src, /Date\.now\(\)|new Date\(\)/,
      `${f} reads the local clock; freshness must come from the projection's computedAt`);
  }
});

test("missing evidence and missing owner render as named states", () => {
  // §14: "no data" is not one condition, and an empty cell reads as a rendering
  // bug rather than as work.
  const src = fs.readFileSync("src/components/clinical/primitives.tsx", "utf8");
  assert.match(src, /none recorded/, "absent evidence renders blank rather than as a state");
  assert.match(src, /Unassigned/, "an unowned item renders blank rather than as a state");
});

test("the reason is human language, not a raw event key", () => {
  // Found by rendering it: the row headline read
  // "phq-9: suicidal_ideation_screen_positive (total 16)" — a machine key, a
  // scoring internal, and a fragment, in the field whose job is to tell a
  // clinician at a glance why they are looking at this person. Every alert type
  // createAlert() can raise needs a sentence.
  const src = fs.readFileSync("src/lib/clinical/work-queue.ts", "utf8");
  const actions = fs.readFileSync("src/lib/actions.ts", "utf8");

  const raised = [...actions.matchAll(/createAlert\(\{[\s\S]{0,200}?type:\s*"([a-z_]+)"/g)]
    .map((m) => m[1]);
  assert.ok(raised.length >= 8, `expected to find the alert types actions.ts raises, found ${raised.length}`);

  const missing = [...new Set(raised)].filter((t) => !new RegExp(`\\b${t}:`).test(src));
  assert.deepEqual(
    missing, [],
    "these alert types have no human reason and would render their raw key:\n  " +
    missing.join("\n  ") + "\nAdd them to REASON_FOR_TYPE in work-queue.ts."
  );
});

test("a resolved item shows when it resolved, not a live countdown", () => {
  // Also found by rendering it: a resolved row read "Due in just now", because
  // the age helper clamps a past deadline to zero. A resolved item's deadline
  // is history, so the row must not render one.
  const src = fs.readFileSync("src/components/clinical/WorkQueueRow.tsx", "utf8");
  assert.match(src, /item\.resolvedAt/,
    "the row does not branch on resolvedAt, so a resolved item renders a live deadline");
  // lastIndexOf, because the first "DueLabel" is the import line rather than
  // the usage — the usage is what has to sit inside the else branch.
  const dueUse = src.lastIndexOf("<DueLabel");
  const resolvedIdx = src.indexOf("item.resolvedAt ?");
  assert.ok(resolvedIdx > -1, "the row does not branch on resolvedAt before rendering a deadline");
  assert.ok(resolvedIdx < dueUse,
    "DueLabel is reached before the resolved branch, so a resolved row still counts down");
});
