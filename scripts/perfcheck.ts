// Per-surface performance gate (handoff 06 §31.2 wave 6).
//
//   BASE=http://localhost:3000 npm run perfcheck
//   BASE=... WRITE=1 npm run perfcheck     # also update the artefact
//
// The load gate beside this one (scripts/loadcheck.mjs) fires concurrency at
// the public home page and answers "does the server stand up". This answers a
// different question: is each SURFACE fast enough for what somebody is doing on
// it. A member opening grounding because they are activated and a payer analyst
// opening a cohort report are not owed the same number, and averaging them
// answers neither.
//
// It signs in as each role, requests each declared surface enough times for a
// percentile to mean something, and exits non-zero on a breach. The budgets and
// their reasons live in src/lib/performance/budget.ts; nothing here
// decides what is fast enough.

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3000";
const SAMPLES = Number(process.env.SAMPLES || 25);
const WRITE = process.env.WRITE === "1";
const OUT = path.join(process.cwd(), "src/lib/performance/run.generated.ts");

// A placeholder replaced during the browser phase with a real chart path. A
// dynamic route cannot be timed without an id, and hard-coding one would tie
// the gate to a particular seed.
const RECORD_SURFACE = "__record__";

const ROLES = {
  member: ["patient.demo@steady.local", "patient1234"],
  clinician: ["clinician.demo@steady.local", "clinician1234"],
  organization: ["org.demo@steady.local", "org1234"],
  payer: ["payer.demo@steady.local", "payer1234"],
  reviewer: ["reviewer.demo@steady.local", "reviewer1234"],
};

// One surface per class per role, chosen for what somebody is doing on it
// rather than for coverage. A gate that timed ninety routes would take long
// enough that nobody would run it.
const SURFACES: Array<[keyof typeof ROLES, string]> = [
  ["member", "/app/ground"],
  ["member", "/crisis"],
  ["member", "/app/today"],
  ["member", "/app/progress"],
  ["clinician", "/clinician/today"],
  ["clinician", "/clinician/caseload"],
  ["organization", "/organization/overview"],
  ["payer", "/payer/overview"],
  ["reviewer", "/review/audit"],
  ["reviewer", "/review/security"],
  // A person's chart, resolved at run time — see `resolveMemberChart`. The
  // record class had no measurement at all until this was added, and the screen
  // said so: a declared budget nobody has ever tested is a number, not a gate.
  ["clinician", RECORD_SURFACE],
];

// SIGNED IN THROUGH A BROWSER, then measured with plain fetch.
//
// Login is a server action, not a form POST to a URL — a raw POST to /login
// answers 200 and sets no cookie, which is the app working and the script being
// wrong about it. So a browser does the sign-in once per role and hands over
// the session cookie; the timing loop is fetch, because a browser's own
// navigation timing measures rendering as well and the budgets here are about
// how long somebody waits before the page starts arriving.
async function signIn(browser: import("playwright").Browser, role: keyof typeof ROLES) {
  const [email, password] = ROLES[role];
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
  const cookies = await context.cookies();
  await context.close();
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  if (!cookie) throw new Error(`could not sign in as ${role}`);
  return cookie;
}

/** Time to the server's first byte. Measured to the RESPONSE HEADERS, not to
 *  the end of the body: the budget is about how long somebody waits before the
 *  page starts arriving, and streaming a long page should not count against
 *  it. */
/** One member's chart, found the way the console finds it. The record budget is
 *  about a person's chart, and there is no such path without an id. */
async function resolveMemberChart(browser: import("playwright").Browser): Promise<string> {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(ROLES.clinician[0]);
  await page.locator('input[name="password"]').fill(ROLES.clinician[1]);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
  await page.goto(`${BASE}/clinician/patients`, { waitUntil: "domcontentloaded" });
  const href = await page
    .locator('a[href*="/clinician/member/"]')
    .first()
    .getAttribute("href");
  await context.close();
  const id = (href ?? "").split("/")[3];
  if (!id) throw new Error("could not resolve a member chart to measure the record budget against");
  return `/clinician/member/${id}`;
}

async function timeOnce(url: string, cookie: string) {
  const started = performance.now();
  const res = await fetch(url, { headers: { cookie }, redirect: "manual" });
  const ttfb = performance.now() - started;
  await res.arrayBuffer();
  return { ttfb, status: res.status };
}

async function main() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}
  );
  const cookies: Record<string, string> = {};
  let recordPath: string | null = null;
  try {
    for (const role of Object.keys(ROLES) as Array<keyof typeof ROLES>) {
      cookies[role] = await signIn(browser, role);
    }
    recordPath = await resolveMemberChart(browser);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    await browser.close();
    process.exit(1);
  }
  await browser.close();

  const rows: Array<{ role: string; route: string; samples: number[] }> = [];
  for (const [role, declared] of SURFACES) {
    const route = declared === RECORD_SURFACE ? recordPath! : declared;
    // RECORDED AS THE ROUTE, MEASURED AS THE INSTANCE. The chart of one
    // fabricated person is what gets timed; what goes into the artefact and
    // onto the review screen is the route pattern, so the committed file does
    // not churn on every reseed and no id is printed on a screen that has no
    // reason to name one.
    const label = declared === RECORD_SURFACE ? "/clinician/member/[id]" : declared;
    const url = `${BASE}${route}`;
    // One warm-up that is not measured. The first request to a route in a fresh
    // server compiles or fills a cache, and a budget written around that number
    // would be a budget about the first visitor of the day.
    await timeOnce(url, cookies[role]);
    const samples = [];
    let bad = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const { ttfb, status } = await timeOnce(url, cookies[role]);
      // A REDIRECT IS NOT THE SURFACE. `redirect: "manual"` means a 307 to the
      // login page comes back in single-digit milliseconds and looks like the
      // fastest screen in the product — so a 3xx fails the gate rather than being
      // recorded. A budget measured against a redirect is worse than no budget.
      if (status >= 300) bad += 1;
      else samples.push(Math.round(ttfb));
    }
    if (bad > 0) {
      console.error(`PERF GATE FAILED: ${route} answered ${bad}/${SAMPLES} times with an error or a redirect`);
      process.exit(1);
    }
    rows.push({ role, route: label, samples });
  }

  const { measure, measurable, MIN_SAMPLES } = await import(
    "../src/lib/performance/budget"
  );

  const measurements: ReturnType<typeof measure>[] = [];
  const breaches: string[] = [];
  for (const { route, samples } of rows) {
    if (!measurable(samples)) {
      console.error(`PERF GATE FAILED: ${route} produced ${samples.length} samples, under ${MIN_SAMPLES}`);
      process.exit(1);
    }
    const m = measure(route, samples);
    measurements.push(m);
    const flag = m.withinBudget ? "ok " : "OVER";
    console.log(
      `${flag} ${route.padEnd(28)} ${String(m.cls).padEnd(10)} ` +
      `p95 ${String(m.p95Ms).padStart(5)}ms  budget ${m.budgetMs}ms  ` +
      `(min ${m.samples[0]}ms, max ${m.samples[m.samples.length - 1]}ms)`
    );
    if (!m.withinBudget) breaches.push(`${route}: p95 ${m.p95Ms}ms > ${m.budgetMs}ms (${m.cls})`);
  }

  if (WRITE) {
    const run = {
      takenAt: new Date().toISOString(),
      conditions: process.env.CONDITIONS
        || `${SAMPLES} samples per surface against ${BASE}, warm, single client, no concurrency`,
      measurements,
      breaches,
    };
    fs.writeFileSync(OUT, `// GENERATED — do not edit by hand.
  //
  // Regenerate against a running server with:
  //   BASE=http://localhost:3000 WRITE=1 node scripts/perfcheck.mjs
  //
  // A committed measurement rather than a live one: the review screen reports
  // what was measured, when, and under what conditions. A number with no
  // conditions is a number somebody will quote in a year.

  import type { PerformanceRun } from "./budget";

  export const PERFORMANCE_RUN: PerformanceRun = ${JSON.stringify(run, null, 2)};
  `);
    console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
  }

  if (breaches.length) {
    console.error("PERF GATE FAILED:\n  - " + breaches.join("\n  - "));
    process.exit(1);
  }
  console.log(`perf: ${measurements.length} surfaces within budget`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
