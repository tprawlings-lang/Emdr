import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Automated WCAG audit of the critical unauthenticated pages. The gate is
// zero *serious* or *critical* violations against WCAG 2.0/2.1 A & AA rules;
// moderate/minor findings are reported in the attachment but do not fail the
// build (they are triaged, not ignored).
// Every public institutional page is audited, not a sample. A reviewer using a
// screen reader arrives at whichever page was linked to them, and an untested
// page is where the contrast failure lives.
const PAGES = [
  "/", "/platform", "/clinical", "/organizations", "/payers",
  "/about", "/trust", "/evidence", "/faq", "/request-review",
  "/demo", "/terms", "/privacy", "/accessibility",
  "/crisis", "/login", "/signup",
];

for (const path of PAGES) {
  test(`a11y: ${path} has no serious/critical WCAG violations`, async ({ page }, testInfo) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // Attach the full report for triage of moderate/minor items.
    await testInfo.attach(`axe-${path.replace(/\W+/g, "_")}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    const summary = blocking
      .map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`)
      .join("\n");
    expect(blocking, `serious/critical violations on ${path}:\n${summary}`).toEqual([]);
  });
}
