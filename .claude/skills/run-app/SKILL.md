---
name: run-app
description: Launch Steady's built app and drive it in a browser. Use when asked to run, start, serve, screenshot, or verify a change in the real app rather than in tests. Covers the verified start recipe, the demo logins, and the Playwright driver shape.
---

# Running Steady

## Start it

```bash
npm run build          # required — serve.sh refuses without .next/BUILD_ID
./scripts/serve.sh     # start (default), or: stop | status
```

**Do not hand-roll `next start`.** The script exists because a hand-rolled
start was wrong twice in one session, in a way that looked like success:

- `pkill -f next-server` matches the pkill's own command line, kills the shell
  running it, returns 144, and leaves the server alive.
- `lsof -ti tcp:3000` returns **nothing in this container** even while a server
  is answering. Anything built on it silently no-ops.
- `pgrep -x next-server` never matches — the kernel truncates the comm to
  `next-server (v1`.
- `curl … 200` is answered by whatever is listening. A stale server answers it
  exactly as happily as yours.

Together those turn "I rebuilt and re-checked" into two rounds of verifying a
build that was never running, and a bug hunt for a bug that was already fixed.

`serve.sh` proves the port went **silent** before starting, so a later 200 can
only be yours. If it cannot free the port it refuses rather than starting.

## Drive it

Playwright is installed; the browser is **not** in the default location.

```js
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
```

Write the driver **inside the repo** (`.drive.mjs`, deleted after) — a script
in `/tmp` cannot resolve `playwright`.

Log in by filling the form and waiting for the navigation together:

```js
await p.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.fill('input[name="email"]', email);
await p.fill('input[name="password"]', pass);
await Promise.all([
  p.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }),
  p.click('button[type="submit"]'),
]);
```

| Role | Email | Password |
|---|---|---|
| Member | `patient.demo@steady.local` | `patient1234` |
| Clinician | `clinician.demo@steady.local` | `clinician1234` |
| Clinician (2nd) | `clinician2.demo@steady.local` | `clinician1234` |
| Reviewer | `reviewer.demo@steady.local` | `reviewer1234` |
| Organization | `org.demo@steady.local` | `org1234` |
| Payer | `payer.demo@steady.local` | `payer1234` |
| Demo admin | `admin.demo@steady.local` | `demoadmin1234` |

## Look at what you got

**Read the screenshot.** A page that renders is not a page that is right, and
several defects this session were visible only in the image or the console:

```js
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
```

Section headings are CSS-uppercased, so `innerText` returns them in caps —
match case-insensitively or you will "find" nothing on a working page.

## Reset the data

```bash
EMDR_DATA_DIR=.e2e-data EMDR_DEMO=1 \
EMDR_SESSION_SECRET=e2e-placeholder-session-secret-not-a-real-secret \
EMDR_DATA_KEY=e2e-placeholder-data-key \
npm run demo -- reset
```

Rebuilds the 240-person fabricated population. Needed after a change to the
seed, and after any drive that wrote state you do not want the next one to
inherit — an open handoff, an applied data bundle.

## Environment traps

- Foreground `sleep` is **blocked** and kills the invocation. Wait with
  `curl --retry N --retry-delay 1 --retry-connrefused`, or a background
  `until` loop.
- Background processes are suspended between tool calls. Start the server in
  one call, use it in the next.
