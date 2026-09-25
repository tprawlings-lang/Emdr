import { test, expect } from "@playwright/test";
import { ROUTE_REGISTER } from "../../src/lib/app/route-register";
import { CLINICAL_LABEL } from "../../src/lib/governance/clinical-labels";

// No clinical label on any member screen, read off what renders (Expansion
// Handoff non-negotiable 6; Phase 0).
//
// tests/member-boundary.test.ts checks the copy at its source. This reads what
// a member actually sees, because a label can arrive through data as easily as
// through code — an instrument title passed through a component, a track name
// read from a table.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

test("every working member screen reads without an instrument name or diagnostic term", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("patient.demo@steady.local");
  await page.locator('input[name="password"]').fill("patient1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForLoadState("networkidle");

  const routes = ROUTE_REGISTER
    .filter((r) => r.audience === "member" && r.state === "working" && !r.path.includes("["))
    .map((r) => r.path);
  // The questionnaire pages are dynamic routes; the ones a member can open are
  // walked by name.
  routes.push("/app/measures/pcl-5", "/app/measures/itq");
  // One walk over every member screen, so its time grows with the product:
  // the default 30 seconds ran out on the last screen once there were 38. A
  // budget per screen rather than a total, so adding a screen cannot make
  // this fail for being thorough.
  test.setTimeout(15_000 + routes.length * 3_000);

  const found: string[] = [];
  for (const path of routes) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    const hit = text.match(new RegExp(CLINICAL_LABEL.source, "g"));
    if (hit) found.push(`${path} (landed on ${new URL(page.url()).pathname}): ${[...new Set(hit)].join(", ")}`);
  }
  expect(routes.length, "the walk found no member routes").toBeGreaterThan(10);
  expect(found, "clinical labels on member screens:\n" + found.join("\n")).toEqual([]);
});
