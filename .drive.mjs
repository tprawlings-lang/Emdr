import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await b.newContext();
const p = await ctx.newPage();
const seen = {};
p.on("response", r => { const u = new URL(r.url()).pathname; if (!seen[u] && /clinician|app\//.test(u)) { seen[u] = r.headers()["cache-control"] ?? "(none)"; } });
await p.goto("http://localhost:3000/login");
await p.fill('input[name="email"]', "clinician.demo@steady.local");
await p.fill('input[name="password"]', "clinician1234");
await p.getByRole("button", { name: "Continue" }).click();
await p.waitForLoadState("networkidle");
await p.goto("http://localhost:3000/clinician/today");
await p.waitForLoadState("networkidle");
const before = (await p.locator("main").innerText()).slice(0, 120);
console.log("signed in, page shows:", JSON.stringify(before.split("\n")[0]));
console.log("cache-control headers:", JSON.stringify(seen, null, 1));

// Sign out.
const out = p.getByRole("button", { name: /sign out/i }).first();
if (await out.count()) { await out.click(); } else { await p.goto("http://localhost:3000/logout"); }
await p.waitForLoadState("networkidle");
console.log("after sign out:", p.url());

// THE INJECTION: press Back.
await p.goBack();
await p.waitForTimeout(1500);
console.log("after back:", p.url());
const after = await p.locator("body").innerText();
console.log("back page first line:", JSON.stringify(after.split("\n").filter(Boolean)[0]));
console.log("restricted content visible after back:", /fabricated\)/.test(after) || /Who needs you today/.test(after));
await b.close();
