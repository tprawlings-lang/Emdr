import { test, expect, type Page, type Browser } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ROUTE_REGISTER } from "../../src/lib/app/route-register";

// Dark mode, measured on the rendered screens (Expansion Handoff §8.2's dark
// column).
//
// tests/contrast.test.ts checks every token pairing the product draws, in both
// modes, from the stylesheet. That is necessary and not sufficient: a
// component can still pair a token with something that does not change with
// the theme, and the stylesheet cannot see it. So this renders every working
// route with the system set to dark and runs the contrast rule over it.
//
// AND IT CHECKS THE CRISIS ROUTES BY NAME, because they were the failure. They
// were `bg-ground text-white`: dark on light in light mode, and white on
// near-white in dark, since ground inverts and white does not. A person who
// keeps their phone in dark mode would have opened SOS and found a pale
// rectangle.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

const LOGINS: Record<string, { email: string; password: string }> = {
  member: { email: "patient.demo@steady.local", password: "patient1234" },
  clinician: { email: "clinician.demo@steady.local", password: "clinician1234" },
  organization: { email: "org.demo@steady.local", password: "org1234" },
  payer: { email: "payer.demo@steady.local", password: "payer1234" },
  reviewer: { email: "reviewer.demo@steady.local", password: "reviewer1234" },
};

async function darkPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ colorScheme: "dark" });
  return context.newPage();
}

async function signIn(page: Page, audience: string) {
  const who = LOGINS[audience];
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForLoadState("networkidle");
}

/** WCAG relative-luminance contrast between two computed `rgb(...)` strings. */
function contrast(a: string, b: string): number {
  const lum = (rgb: string) => {
    const [r, g, bl] = (rgb.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map((x) => {
      const c = Number(x) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("the system's dark setting actually turns the product dark", async ({ browser }) => {
  const page = await darkPage(browser);
  await page.goto("/crisis");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // §8.2's dark ground. If this is still the light page, every other test in
  // this file is measuring light mode and passing for the wrong reason.
  expect(bg, "the page did not switch to dark").toBe("rgb(22, 32, 35)");
  await page.context().close();
});

test("the crisis routes are readable in dark mode", async ({ browser }) => {
  const page = await darkPage(browser);
  await page.goto("/crisis");
  await page.locator("main").waitFor({ state: "visible" });

  // Every link and button on the crisis page, measured on what it actually
  // renders — text colour against its own background, or the page's if it has
  // none.
  const controls = await page.evaluate(() => {
    const pageBg = getComputedStyle(document.body).backgroundColor;
    return [...document.querySelectorAll("main a, main button")].map((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      const own = cs.backgroundColor;
      const transparent = own === "rgba(0, 0, 0, 0)" || own === "transparent";
      return { text: (el.textContent || "").trim().slice(0, 40), fg: cs.color, bg: transparent ? pageBg : own };
    }).filter((c) => c.text);
  });
  expect(controls.length, "no controls on the crisis page to measure").toBeGreaterThan(0);

  const unreadable = controls
    .map((c) => ({ ...c, ratio: contrast(c.fg, c.bg) }))
    .filter((c) => c.ratio < 4.5)
    .map((c) => `"${c.text}" ${c.ratio.toFixed(2)}:1 (${c.fg} on ${c.bg})`);
  expect(unreadable, "crisis controls below AA in dark mode:\n" + unreadable.join("\n")).toEqual([]);
  await page.context().close();
});

for (const audience of Object.keys(LOGINS)) {
  test(`dark: every working ${audience} route passes the contrast rule`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const page = await darkPage(browser);
    await signIn(page, audience);

    const routes = ROUTE_REGISTER
      .filter((r) => r.audience === audience && r.state === "working" && !r.path.includes("["))
      .map((r) => r.path);
    const failures: string[] = [];
    const scanned: string[] = [];

    for (const route of routes) {
      const response = await page.goto(route, { waitUntil: "networkidle" }).catch(() => null);
      if (!response || response.status() >= 400) continue;
      scanned.push(route);
      // THE CONTRAST RULE ONLY. Names, roles and structure do not change with
      // the colour scheme, and the light-mode scan already covers them.
      const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      for (const v of results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")) {
        const where = v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" · ");
        failures.push(`${route}: ${v.id} x${v.nodes.length} — ${where}`);
      }
    }

    await testInfo.attach(`dark-${audience}-coverage.json`, {
      body: JSON.stringify({ audience, scanned }, null, 2),
      contentType: "application/json",
    });
    expect(scanned.length, `nothing was scanned in dark for ${audience}`).toBeGreaterThan(0);
    expect(failures, `dark-mode contrast failures for ${audience}:\n${failures.join("\n")}`).toEqual([]);
    await page.context().close();
  });
}
