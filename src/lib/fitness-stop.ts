// What happens after the program-fit questions return a stop — one function,
// called by every submit path.
//
// The web action refunded, paused and raised a care-team alert. The mobile
// route did none of the three: a member stopped there kept their charge, and
// no clinician was told. That mattered more once a standing stop could only be
// lifted by a clinician closing the alert (fitness-screener.ts,
// STANDING_STOP_ITEMS) — with no alert, a mobile member would have been held
// with nobody able to release them. A path that cannot skip this is the fix;
// tests/fitness-retake.test.ts fails if a submit path stops calling it.

import { safetyRefundAndCancel } from "./billing";
import { createAlert } from "./clinical/alert-create";
import { FITNESS_STOP_ALERT, STANDING_STOP_ITEMS } from "./fitness-screener";

export async function respondToFitnessStop(userId: string, flags: string[]): Promise<void> {
  await safetyRefundAndCancel(userId);
  const standing = flags.some((f) => STANDING_STOP_ITEMS.some((id) => f === `hard_stop:${id}`));
  await createAlert({
    userId,
    type: FITNESS_STOP_ALERT,
    severity: "high",
    detail:
      "Fitness screening indicated this program is not a safe fit right now. Membership refunded and paused automatically." +
      (standing
        ? " Their answers include one that re-answering cannot lift: sessions stay closed until this alert is closed with a documented review, which lets them answer the program-fit questions again."
        : " They can answer the program-fit questions again once the pause ends."),
  });
}
