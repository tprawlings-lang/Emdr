import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const BASE = "http://localhost:3000";
const errs = [];
async function page() {
  const p = await (await b.newContext()).newPage();
  p.on("pageerror", e => errs.push(e.message.slice(0,90)));
  return p;
}
async function login(p, email, pw, land) {
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', pw);
  await Promise.all([p.waitForURL(land,{timeout:20000}).catch(()=>{}), p.locator('form:has(input[name="password"]) button[type="submit"]').click()]);
}

const c = await page();
await login(c, "clinician.pilot@steady.local", "pilotclin1234", /clinician/);
await c.goto(`${BASE}/clinician/patients`, { waitUntil: "networkidle" });
const href = await c.locator('main a[href*="/clinician/member/"]').first().getAttribute("href");
const id = href.split("/clinician/member/")[1].split("/")[0];
console.log("participant id:", id.slice(0,8));

// ---- 1. Session note ----
await c.goto(`${BASE}/clinician/member/${id}/note`, { waitUntil: "networkidle" });
const forms = await c.locator('main form').count();
const areas = await c.locator('main textarea').count();
console.log(`\nNOTE page: forms=${forms} textareas=${areas}`);
if (areas > 0) {
  const ta = c.locator('main textarea').first();
  await ta.fill("Internal test note: participant reported a harm urge on today's check-in; contacted and grounded. Follow-up tomorrow.");
  const submit = c.locator('main form button[type="submit"]').first();
  const label = (await submit.innerText().catch(()=>"")).trim();
  const before = c.url();
  await submit.click().catch(e=>console.log("  submit threw:", e.message.slice(0,60)));
  await c.waitForLoadState("networkidle").catch(()=>{});
  await c.waitForTimeout(800);
  const t = await c.locator("main").innerText();
  console.log(`  submitted via "${label}" -> ${new URL(c.url()).pathname}`);
  console.log(`  note now on page: ${t.includes("Internal test note") ? "YES" : "NO"}`);
  const refused = t.match(/refus\w+[^\n]{0,110}|cannot[^\n]{0,90}/i);
  if (refused) console.log("  refusal text:", refused[0].slice(0,120));
}

// ---- 2. Alert: close with an action ----
await c.goto(`${BASE}/clinician/today`, { waitUntil: "networkidle" });
const alertInput = c.locator('main form input[type="text"], main form textarea').first();
console.log(`\nALERT close: input present = ${await alertInput.count() > 0}`);
if (await alertInput.count()) {
  await alertInput.fill("Called participant, confirmed safe, grounding plan agreed.");
  const btn = c.getByRole("button", { name: /Close with action|Record contact/i }).first();
  if (await btn.count()) {
    await btn.click().catch(()=>{});
    await c.waitForLoadState("networkidle").catch(()=>{});
    await c.waitForTimeout(800);
    const t = await c.locator("main").innerText();
    console.log(`  after close: "Needs attention" count line -> ${(t.match(/Needs attention\s*\d+/)||["?"])[0]}`);
  } else console.log("  no close button found");
}

// ---- 3. Modules: what does the member see ----
const m = await page();
await login(m, "patient.demo@steady.local", "patient1234", /app/);
await m.goto(`${BASE}/app/paths`, { waitUntil: "networkidle" });
const mt = await m.locator("main").innerText();
console.log(`\nMEMBER /app/paths: main=${await m.locator("main").count()}`);
console.log("  locked/unlock words:", (mt.match(/unlock|locked|request/gi)||[]).slice(0,6).join(", ") || "none");
const req = m.getByRole("button", { name: /request|unlock/i }).first();
console.log("  request-unlock control:", await req.count() > 0 ? "present" : "absent");

console.log("\npage errors:", [...new Set(errs)].slice(0,5));
await b.close();
