import { test } from "@playwright/test";
import { openPilotTier } from "./helpers/pilot-gates";

// Bring the deployment to the pilot tier, ONCE, before anything reads it.
//
// THIS WRITES GLOBAL STATE, which is the thing this config's project split
// exists to control: two release-gate sign-offs, eleven clinical copy
// approvals and a recorded parity result, all of which other specs can read.
// It first lived in a `beforeAll` inside the enrollment specs, where it ran
// TWICE — once per file — inside the parallel project, racing everything else.
// A full suite then failed three unrelated ways: the hook itself timed out at
// thirty seconds doing twenty-five page loads including a ledger rebuild, the
// demo clock could not find its own header, and a governed export gave up. Run
// alone it took seventeen seconds and passed, which is the shape of an
// interference problem rather than a slow one.
//
// So it is a SETUP PROJECT the others depend on: it happens first, once, and
// every spec that follows reads a settled environment rather than one being
// rewritten beside it. The same reasoning the config already applies to the
// specs that complete a review or move the clock.
//
// GENEROUS TIMEOUT, because the parity step rebuilds the ledger and that is
// the point of it — a check cheap enough to run on a page load would not be
// the check this gate asks for.
test("the pilot tier is open", async ({ page }) => {
  test.setTimeout(240_000);
  await openPilotTier(page);
});
