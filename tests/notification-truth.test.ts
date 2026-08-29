// Notification truth (GUI and Decision-Surface Handoff §3.8).
//
// Four member surfaces claimed a care team "has been notified" or "has been
// alerted". Each sentence rendered because `createAlert()` had just run, and
// `createAlert()` is one `INSERT INTO alerts` — no channel, no receipt, no
// `delivered_at` column to hold one. Meanwhile /demo, /trust and the home FAQ
// told reviewers that nobody monitors this environment and no care team is
// assigned. The product asserted both, and asserted the false half to the
// member at the moment it mattered most.
//
// §3.8: "The GUI must never claim notification from an attempted write. Only a
// delivery receipt can support 'delivered.' Only a separate acknowledgment
// event can support 'acknowledged.'"
//
// This is a test rather than a note because the sentence is a natural thing to
// write. It reads as reassurance, it is the kind of line added to soften a hard
// screen, and nothing about writing it feels like asserting a fact.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  deliveryNotice,
  escalationNotice,
  escalationState,
  ESCALATION_CHANNEL_CONFIGURED,
  NotificationTruthError,
} from "../src/lib/notify/delivery";

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const prose = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("no surface claims a notification, an alert, or a review that followed from a write", () => {
  // Scoped to the claim itself. "Your care team can see the updated trend" is
  // fine — it describes what the console shows, not a message that was sent.
  const CLAIMS = [
    { rx: /care team has been (notified|alerted)/i, what: '"care team has been notified/alerted"' },
    { rx: /has been (notified|alerted) and will/i, what: "a notification plus a promised response" },
    { rx: /we(?:'ve| have) (notified|alerted)/i, what: "a first-person notification claim" },
    { rx: /your (clinician|care team) will review (this|today)/i, what: "a promised human review" },
  ];
  const offenders: string[] = [];
  for (const f of [...walk("src/app"), ...walk("src/components")]) {
    const text = prose(fs.readFileSync(f, "utf8"));
    for (const { rx, what } of CLAIMS) {
      if (rx.test(text)) offenders.push(`${path.relative(process.cwd(), f)} — ${what}`);
    }
  }
  assert.deepEqual(
    offenders, [],
    "these surfaces claim a notification the system cannot prove:\n  " + offenders.join("\n  ") +
    "\nThere is no delivery channel and the alerts table has no receipt column, so the " +
    "claim can only have come from an attempted write. Use escalationNotice() from " +
    "src/lib/notify/delivery.ts, which says only what the state supports."
  );
});

test("the five states carry §3.8's member-safe language", () => {
  assert.equal(
    deliveryNotice({ state: "not_configured" }),
    "This activity is not monitored. Use the support options below."
  );
  assert.equal(
    deliveryNotice({ state: "queued" }),
    "Steady is trying to send an alert. Do not wait for a response if you need help now."
  );
  assert.equal(
    deliveryNotice({ state: "failed" }),
    "Steady could not deliver the alert. Use the support options below now."
  );
  // Both waiting states must tell the member not to wait. That is the clinical
  // point of separating them from "delivered", not a copy preference.
  for (const state of ["queued", "failed"] as const) {
    assert.match(deliveryNotice({ state }), /if you need help now|below now/i);
  }
});

test("'delivered' without a receipt time is refused", () => {
  assert.throws(
    () => deliveryNotice({ state: "delivered" }),
    NotificationTruthError,
    "a delivery was claimed with nothing to evidence it"
  );
  assert.match(
    deliveryNotice({ state: "delivered", at: "2026-08-28T14:14:00Z" }),
    /delivered to your care team at .+\. Response times vary\./
  );
});

test("'acknowledged' needs both a person and a time", () => {
  assert.throws(() => deliveryNotice({ state: "acknowledged", at: "2026-08-28T14:19:00Z" }),
    NotificationTruthError, "acknowledgement claimed with no acknowledging person");
  assert.throws(() => deliveryNotice({ state: "acknowledged", actorName: "Jordan Lee" }),
    NotificationTruthError, "acknowledgement claimed with no time");
  assert.match(
    deliveryNotice({ state: "acknowledged", at: "2026-08-28T14:19:00Z", actorName: "Jordan Lee" }),
    /^Jordan Lee acknowledged this alert at /
  );
});

test("with no channel configured, every surface reports not_configured", () => {
  // The honest state for this beta, and the same thing /demo and /trust say.
  assert.equal(ESCALATION_CHANNEL_CONFIGURED, false);
  assert.equal(escalationState().state, "not_configured");
  // A caller cannot talk the product into a stronger claim by supplying one.
  assert.equal(
    escalationState({ state: "delivered", at: "2026-08-28T14:14:00Z" }).state,
    "not_configured",
    "a caller-supplied receipt overrode the fact that no channel exists"
  );
  assert.match(escalationNotice(), /not monitored/);
});

test("the member-facing claim agrees with what reviewers are told", () => {
  // The two audiences read the same deployment. They were being told opposite
  // things about the same fact.
  const demo = fs.readFileSync("src/app/demo/page.tsx", "utf8");
  assert.match(demo, /no care team is assigned/i,
    "the demo page no longer states the monitoring posture the member copy is checked against");
  assert.match(escalationNotice(), /not monitored/i);
});
