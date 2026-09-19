import { test, expect, type Page } from "@playwright/test";
import { ROUTE_REGISTER } from "../../src/lib/app/route-register";
import { TOUCH_TARGET_GOAL_PX, TOUCH_TARGET_FLOOR_PX } from "../../src/lib/experience/quality";

// Reflow and control size across the product (17 September handoff, P7).
//
// BOTH RULES EXISTED AND BOTH WERE MEASURED ON ONE SCREEN. The 320px overflow
// check walked two clinician routes; the touch-target report measured the
// member's Today page. §8.6 asks that "all interactions work at 320 CSS px and
// 200% zoom", and the interactions are spread across seventy-odd routes — the
// two that were checked are the two least likely to be wrong, because they are
// the two everybody looks at.
//
// So the list comes from the route register and the rules are the ones already
// ruled on: 24 × 24 is WCAG 2.2 SC 2.5.8's conformance floor and is asserted;
// 44 × 44 is the product goal and is REPORTED, because a screen can conform
// without meeting the goal and collapsing the two would either fail conforming
// screens or quietly promote a 24px control.
//
// This is automated evidence and it is not a manual accessibility review. It
// measures boxes. It cannot tell whether the focus order reads as sense, and
// the release definition records that nobody has listened to these screens yet.

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

async function aPersonId(page: Page): Promise<string | null> {
  await page.goto("/clinician/caseload");
  const href = await page
    .locator('a[href^="/clinician/member/"]').first().getAttribute("href").catch(() => null);
  return href ? href.split("/").pop()! : null;
}

/** Every control on the page, measured, with SC 2.5.8's exceptions honoured. */
async function measure(page: Page, goal: number, floor: number) {
  return page.evaluate(
    ({ goal, floor }) => {
      const sel = "a[href], button, input:not([type=hidden]), select, textarea";
      const clipped = (el: Element) => {
        const cs = getComputedStyle(el);
        return cs.clipPath === "inset(50%)" || cs.clip === "rect(0px, 0px, 0px, 0px)";
      };
      // SC 2.5.8's exception, as the success criterion actually words it: a
      // target is exempt when it is "in a sentence or block of text", where its
      // size is determined by the line height of the text around it.
      //
      // NOT "display: inline", WHICH IS WHAT THIS ASKED FIRST. A link set as
      // inline-block or as a block inside a paragraph is still a link in a
      // block of text, and the narrow reading reported dozens of them — "Open
      // the trajectory", "Who has access" — as conformance failures. Reporting
      // everything is the same as reporting nothing: the two controls that are
      // genuinely too small were in that list and invisible.
      const inTextBlock = (el: Element) => {
        if (el.tagName !== "A") return false;
        const around = (el.closest("p, li, td, dd, blockquote")?.textContent ?? "").trim().length;
        return around > (el.textContent ?? "").trim().length + 3;
      };
      const out = { meetsGoal: 0, meetsFloor: 0, belowFloor: 0, offenders: [] as string[] };
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (clipped(el) || inTextBlock(el)) continue;
        const shortest = Math.min(r.width, r.height);
        if (shortest >= goal) out.meetsGoal++;
        else if (shortest >= floor) out.meetsFloor++;
        else {
          out.belowFloor++;
          out.offenders.push(
            `${el.tagName} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent ?? "").trim().slice(0, 30)}"`,
          );
        }
      }
      return out;
    },
    { goal, floor },
  );
}

for (const audience of Object.keys(LOGINS)) {
  test(`at 320px every working ${audience} route reflows and keeps its controls reachable`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await signIn(page, audience);
    const personId = audience === "clinician" ? await aPersonId(page) : null;
    await page.setViewportSize({ width: 320, height: 640 });

    const scrolls: string[] = [];
    const tooSmall: string[] = [];
    const report: Record<string, { meetsGoal: number; meetsFloor: number; belowFloor: number }> = {};
    const skipped: string[] = [];

    for (const route of ROUTE_REGISTER.filter((r) => r.audience === audience && r.state === "working")) {
      let path = route.path;
      if (path.includes("[")) {
        if (personId && path.includes("/clinician/member/[id]")) path = path.replace("[id]", personId);
        else { skipped.push(route.path); continue; }
      }
      const response = await page.goto(path, { waitUntil: "networkidle" }).catch(() => null);
      if (!response || response.status() >= 400) { skipped.push(path); continue; }

      // §8.6's exception is real and is declared rather than assumed: a wide
      // table scrolls inside its own container and the PAGE still does not.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 2) scrolls.push(`${path} scrolls sideways by ${overflow}px`);

      const m = await measure(page, TOUCH_TARGET_GOAL_PX, TOUCH_TARGET_FLOOR_PX);
      report[path] = { meetsGoal: m.meetsGoal, meetsFloor: m.meetsFloor, belowFloor: m.belowFloor };
      for (const o of m.offenders) tooSmall.push(`${path}: ${o}`);
    }

    await testInfo.attach(`narrow-${audience}.json`, {
      body: JSON.stringify({ audience, report, skipped }, null, 2),
      contentType: "application/json",
    });

    expect(Object.keys(report).length, `nothing was measured for ${audience}`).toBeGreaterThan(0);
    expect(scrolls, `two-dimensional scrolling at 320px:\n${scrolls.join("\n")}`).toEqual([]);
    expect(
      tooSmall,
      `controls below the ${TOUCH_TARGET_FLOOR_PX}px conformance floor:\n${tooSmall.join("\n")}`,
    ).toEqual([]);
  });
}
