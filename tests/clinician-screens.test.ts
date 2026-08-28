// The clinician screen atlas (Web GUI handoff §26, §20.3, §30.6).
//
// §26 gives the clinician 14 screens and a role-level acceptance list:
//
//   "Queue order is stable and explainable."
//   "Every alert has evidence arrival time, owner and possible action."
//   "Person claims open cited evidence without a second search."
//
// The first two are held in work-queue.test.ts. This holds the atlas itself,
// the tenant boundary on every person sub-route, and the two rules that were
// broken in the code this wave touched.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const CLIN = path.join(process.cwd(), "src", "app", "clinician");
const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const prose = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** §26's clinician atlas, by route. */
const ATLAS: Array<[string, string]> = [
  ["today", "Know who needs attention"],
  ["caseload", "Scan change, owner and freshness"],
  ["member/[id]", "Understand current state"],
  ["member/[id]/safety", "Respond to fixed gate event"],
  ["member/[id]/measures", "Review validated change"],
  ["member/[id]/sessions", "Review session pattern"],
  ["member/[id]/session/[sid]", "Understand state and response"],
  ["member/[id]/plan", "Review active plan and versions"],
  ["member/[id]/audit", "Trace access and decisions"],
  ["messages", "Communicate with context"],
  ["referrals", "Move intake to first contact"],
  ["handoffs", "Keep accountability through transfer"],
  ["schedule", "See visits and reviews"],
  ["reports", "Review team quality"],
];

test("every §26 clinician screen exists", () => {
  const missing = ATLAS
    .filter(([r]) => !fs.existsSync(path.join(CLIN, r, "page.tsx")))
    .map(([r, q]) => `/clinician/${r} — "${q}"`);
  assert.deepEqual(missing, [], "these §26 clinician screens do not exist:\n  " + missing.join("\n  "));
});

test("every clinician screen is reachable from the nav or the person record", () => {
  const nav = read(path.join(process.cwd(), "src/components/clinical/ClinicianNav.tsx"));
  const shell = read(path.join(process.cwd(), "src/components/clinical/PersonShell.tsx"));
  const rows = read(path.join(process.cwd(), "src/components/clinical/WorkQueueRow.tsx"));
  const sources = nav + shell + rows;

  const orphans: string[] = [];
  for (const [r] of ATLAS) {
    if (r.startsWith("member/[id]")) {
      // Person sub-routes are reached through the record's own tab strip.
      const slug = r.replace("member/[id]", "").replace("/session/[sid]", "");
      if (slug && !shell.includes(`"${slug}"`)) orphans.push(`/clinician/${r}`);
    } else if (!sources.includes(`/clinician/${r}`)) {
      orphans.push(`/clinician/${r}`);
    }
  }
  assert.deepEqual(orphans, [],
    "these clinician screens are not linked from anywhere: " + orphans.join(", "));
});

test("every person sub-route is tenant scoped", () => {
  // The bug this exists to stop recurring: the measures page read
  //   SELECT ... FROM users WHERE id = ? AND role = 'member'
  // with no tenant predicate, so any member id opened their measures,
  // screenings, check-ins and session history across tenants — and the access
  // was audited under the clinician's name, which makes it look sanctioned.
  //
  // §30.6 step 1 resolves the acting tenant before anything else; §20.3
  // requires a cross-tenant request to return no record detail.
  const offenders: string[] = [];
  for (const [r] of ATLAS.filter(([x]) => x.startsWith("member/[id]"))) {
    const src = prose(read(path.join(CLIN, r, "page.tsx")));
    if (!src) continue;
    const scoped = /loadPersonHeader\s*\(/.test(src) || /tenant_id\s*=\s*\?/.test(src);
    if (!scoped) offenders.push(`/clinician/${r}`);
    // notFound, never a distinguishable refusal.
    if (!/notFound\(\)/.test(src)) offenders.push(`/clinician/${r} — no notFound path`);
  }
  assert.deepEqual(offenders, [],
    "these person sub-routes are not tenant scoped:\n  " + offenders.join("\n  "));
});

test("a users lookup on a clinician surface always carries a tenant predicate", () => {
  // Broader than the atlas: any SELECT from users on a clinician page that
  // filters by a person id must also filter by tenant.
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
  for (const f of walk(CLIN)) {
    const src = prose(read(f));
    for (const m of src.matchAll(/SELECT[^"'`]*FROM users WHERE[^"'`]*/gi)) {
      const q = m[0];
      // A lookup of the acting clinician by their own id is already scoped by
      // authentication; it is the person lookups that need the predicate.
      if (/role = 'member'/.test(q) && !/tenant_id/.test(q)) {
        offenders.push(`${path.relative(process.cwd(), f)} — ${q.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    "unscoped member lookups on clinician surfaces:\n  " + offenders.join("\n  "));
});

test("documenting a safety response does not claim to clear the gate", () => {
  // §27.5 and the page example's own acceptance: "Response does not erase or
  // alter the gate." A clinician who believes documenting clears the stop will
  // document one in order to clear it.
  const src = read(path.join(CLIN, "member/[id]/safety/page.tsx"));
  assert.ok(src.length > 0, "the safety review screen is missing");
  assert.match(src, /does not erase the gate/i,
    "the response form does not say that it leaves the gate standing");
  assert.doesNotMatch(prose(src), /\b(clear|reopen|unblock|lift)\s+(the\s+)?(gate|stop|block)\b/i,
    "the safety review offers to clear the gate");
});

test("the safety review does not assert a notification it cannot evidence", () => {
  // The page example's gate record ends "5. Clinician owner notified" as a
  // completed fact. There is no delivery channel, so that line must render the
  // real state rather than the aspiration.
  const src = read(path.join(CLIN, "member/[id]/safety/page.tsx"));
  assert.match(src, /deliveryNotice|escalation/i,
    "the gate record states owner notification without going through the delivery contract");
  assert.doesNotMatch(prose(src), /owner notified<|Clinician owner notified\b(?!.*deliveryNotice)/i,
    "the gate record asserts a notification as a completed fact");
});

test("screens with no capability say so and render no working-looking control", () => {
  // Same rule as the member side. An empty list with the right columns reads as
  // "no items today" rather than "this does not work yet", and a clinician who
  // believes the first will stop checking.
  for (const slug of ["messages", "referrals", "handoffs", "schedule"]) {
    const src = read(path.join(CLIN, slug, "page.tsx"));
    assert.ok(src.length > 0, `/clinician/${slug} is missing`);
    assert.doesNotMatch(src, /<form|<textarea|type="submit"/,
      `/clinician/${slug} offers a control for a capability that does not exist`);
    assert.match(src, /not (part of this environment|yet recorded)|no calendar|does not exist/i,
      `/clinician/${slug} does not say the capability is absent`);
  }
});

test("clinician reports never present an outcome claim", () => {
  // §26 puts outcomes under organization and payer. A caseload-sized
  // denominator cannot support one, and a screen that shows one invites the
  // reading that it can.
  const src = read(path.join(CLIN, "reports/page.tsx"));
  assert.ok(src.length > 0, "the reports screen is missing");
  assert.match(src, /not outcome measures/i,
    "reports does not state that these are operational counts rather than outcomes");
  assert.match(src, /\{n\} of \{total\}|of \{total\}/,
    "a rate is rendered without its denominator (§23.3)");
});


test("no section reference leaks into user-facing copy", () => {
  // Found by reading the rendered page: the handoffs screen told a clinician
  // "§27.5 makes handoff an action with its own audit event". That is a note to
  // an engineer, printed at a clinician. The handoff documents are the reason
  // this codebase is legible, and quoting them at users is the one place they
  // do not belong.
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
  for (const f of [...walk(path.join(process.cwd(), "src/app")), ...walk(path.join(process.cwd(), "src/components"))]) {
    const body = prose(read(f));
    const hit = /§\d+(\.\d+)?/.exec(body);
    if (hit) offenders.push(`${path.relative(process.cwd(), f)} — "${hit[0]}"`);
  }
  assert.deepEqual(offenders, [],
    "these surfaces quote a handoff section at the user:\n  " + offenders.join("\n  ") +
    "\nKeep the reference in a comment and say the thing in the user's words.");
});

test("a person's contact details do not appear on routine record tabs", () => {
  // §27.2: "Use minimum-necessary display identity. Legal identity stays out of
  // routine views unless required." The measures tab rendered the member's
  // email under the heading; a measures review does not need it, and the
  // record shell already says who this is.
  const offenders: string[] = [];
  for (const r of ["member/[id]", "member/[id]/measures", "member/[id]/sessions",
                   "member/[id]/plan", "member/[id]/safety", "member/[id]/audit"]) {
    const src = prose(read(path.join(CLIN, r, "page.tsx")));
    if (/\{\s*(member|person)\.email\s*\}/.test(src)) offenders.push(`/clinician/${r}`);
  }
  assert.deepEqual(offenders, [],
    "these record tabs render contact details they do not need:\n  " + offenders.join("\n  "));
});
