import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ROUTE_REGISTER } from "../../src/lib/app/route-register";

// Automated accessibility over the SIGNED-IN product (17 September handoff, P7).
//
// THE EXISTING SCAN STOPS AT THE FRONT DOOR. tests/e2e/a11y.spec.ts audits the
// seventeen public pages and audits them well — and every console a person
// actually works in was unscanned: the clinician's queue and every section of a
// person's record, the member's day, the organization and payer consoles, the
// reviewer's screens. The release gate's blocking condition is "any blocked
// keyboard or screen-reader path", and the paths where somebody spends an hour
// were the ones nothing looked at.
//
// AUTOMATED EVIDENCE IS ONE FORM OF EVIDENCE, which the handoff says in as many
// words, and this file does not pretend otherwise. Axe finds contrast, names,
// roles and structure. It does not find a keyboard trap that only appears after
// three interactions, a focus order that reads as nonsense aloud, or a control
// somebody cannot hit. Those need a person, and the release definition records
// that they have not had one.
//
// THE LIST COMES FROM THE ROUTE REGISTER rather than being typed here, so a
// route added next month is scanned without anybody remembering to add it. A
// dynamic segment is resolved against the seeded population, because a person's
// record is the largest clinical surface in the product and skipping it because
// its URL has a bracket in it would leave the most-used screen unscanned.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

const LOGINS: Record<string, { email: string; password: string }> = {
  member: { email: "patient.demo@steady.local", password: "patient1234" },
  clinician: { email: "clinician.demo@steady.local", password: "clinician1234" },
  organization: { email: "org.demo@steady.local", password: "org1234" },
  payer: { email: "payer.demo@steady.local", password: "payer1234" },
  reviewer: { email: "reviewer.demo@steady.local", password: "reviewer1234" },
};

async function signIn(page: Page, audience: string) {
  const who = LOGINS[audience];
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForLoadState("networkidle");
}

/** A real person id from the seeded caseload, for the routes that need one. */
async function aPersonId(page: Page): Promise<string | null> {
  await page.goto("/clinician/caseload");
  const href = await page
    .locator('a[href^="/clinician/member/"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  return href ? href.split("/").pop()! : null;
}

function routesFor(audience: string): string[] {
  return ROUTE_REGISTER.filter((r) => r.audience === audience && r.state === "working").map((r) => r.path);
}

for (const audience of Object.keys(LOGINS)) {
  test(`a11y: every working ${audience} route has no serious or critical violation`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page, audience);

    const personId = audience === "clinician" ? await aPersonId(page) : null;
    const failures: string[] = [];
    const scanned: string[] = [];
    const skipped: string[] = [];

    for (const route of routesFor(audience)) {
      let path = route;
      if (path.includes("[")) {
        // Only the person record's segment can be resolved from the seed. A
        // route whose id cannot be resolved is RECORDED AS UNSCANNED rather
        // than dropped: an unscanned route that nobody lists is indistinguishable
        // from a clean one.
        if (personId && path.includes("/clinician/member/[id]")) {
          path = path.replace("[id]", personId);
        } else {
          skipped.push(route);
          continue;
        }
      }

      const response = await page.goto(path, { waitUntil: "networkidle" }).catch(() => null);
      if (!response || response.status() >= 400) {
        skipped.push(`${route} (${response ? response.status() : "no response"})`);
        continue;
      }
      scanned.push(path);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      for (const v of blocking) {
        failures.push(`${path}: ${v.id} (${v.impact}) x${v.nodes.length} — ${v.help}`);
      }
    }

    // THE COVERAGE IS PART OF THE EVIDENCE. A pass over three routes and a pass
    // over thirty look identical in a green tick, so what ran is attached.
    await testInfo.attach(`a11y-${audience}-coverage.json`, {
      body: JSON.stringify({ audience, scanned, skipped }, null, 2),
      contentType: "application/json",
    });

    expect(scanned.length, `nothing was scanned for ${audience}`).toBeGreaterThan(0);
    expect(failures, `serious/critical violations for ${audience}:\n${failures.join("\n")}`).toEqual([]);
  });
}
