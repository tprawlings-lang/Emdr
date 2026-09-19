import { chromium } from "@playwright/test";
const B = "http://127.0.0.1:3000";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(`${B}/login`);
await p.fill('input[name="email"]', "patient.demo@steady.local");
await p.fill('input[name="password"]', "patient1234");
await p.click('button[type="submit"]');
await p.waitForLoadState("networkidle");
for (const r of ["/app/modules", "/app/activities"]) {
  await p.goto(`${B}${r}`);
  await p.waitForLoadState("networkidle");
  const t = await p.locator("main").innerText();
  const lines = t.split("\n").filter((l) => /min|minutes/i.test(l));
  console.log(`\n==== ${r} (member account) ====`);
  console.log(lines.slice(0, 14).join("\n"));
}
await b.close();
