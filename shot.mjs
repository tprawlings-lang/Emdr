import { chromium } from "@playwright/test";
const OUT = "/tmp/claude-0/-home-user-Emdr/79012abf-dcac-5dad-a784-666a1ed68d14/scratchpad";
const B = "http://127.0.0.1:3000";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1150 } });
const p = await ctx.newPage();
await p.goto(B + "/login");
await p.locator('input[name="email"]').fill("operations@example.com");
await p.locator('input[name="password"]').fill("demo1234");
await p.getByRole("button", { name: "Continue" }).click();
await p.waitForLoadState("networkidle");
console.log("landed:", p.url());
for (const [n, u] of [
  ["o-overview","/organization/overview"], ["o-access","/organization/access"],
  ["o-outcomes","/organization/outcomes"], ["o-capacity","/organization/capacity"],
  ["o-locations","/organization/locations"], ["o-safety","/organization/safety"],
]) {
  await p.goto(B + u); await p.waitForLoadState("networkidle");
  await p.screenshot({ path: `${OUT}/shot-${n}.png` });
}
await b.close();
