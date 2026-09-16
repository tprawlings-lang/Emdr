// What each pilot participant actually agreed to, and what that permits.
//
// THE NOTICE CHANGED AFTER PEOPLE HAD ALREADY TICKED IT. The first version
// told enrollees three things that stopped being true the day the pilot gained
// a clinical workflow: that their answers are "not a medical record", that
// "nobody will contact you because of what you enter", and that they are "not
// shared". A signed clinical note is a record. A clinician acting on a safety
// alert is contact. The Anthropic API and an off-site backup are third
// parties.
//
// CONSENT CANNOT BE UPDATED BY EDITING THE PAGE. Rewriting the notice changes
// what the NEXT person agrees to and nothing about what the last one did, so
// the version each person accepted is the thing that decides how their data
// may be handled — not the version currently on screen. `consents` already
// records exactly that (`policy_version`, `granted_at`, `revoked_at`), which
// is why this is a read rather than a migration.
//
// NOBODY IS LOCKED OUT FOR BEING ON THE OLD TERMS. A participant still on v1
// keeps using everything they could use before; what they do not get is a
// clinician writing records about them or their text leaving this deployment.
// The stricter handling is the DEFAULT, applied on their behalf, rather than a
// penalty applied to them — and declining v2 is a permanent, costless answer.
// A pilot where "no" means "you are out" is not consent.

import { data } from "../data";

/** The acknowledgment scope; unchanged, so one person's history is one row set. */
export const PILOT_ACK_SCOPE = "wellness_acknowledgment";

/** The original notice. Answers are pilot feedback and nothing else. */
export const PILOT_TERMS_V1 = "wellness-ack-v1";

/** The notice that admits the clinical workflow and the three egress channels. */
export const PILOT_TERMS_V2 = "wellness-ack-v2";

/** What new enrollees are shown and agree to. */
export const CURRENT_PILOT_TERMS = PILOT_TERMS_V2;

export interface PilotHandling {
  /** The version this person accepted, or null when they have no grant. */
  version: string | null;
  /** May a clinician write records ABOUT this person — notes, decisions? */
  clinicalRecords: boolean;
  /** May this person's content leave the deployment (companion, export)? */
  egress: boolean;
  /** Said to an operator, in the words the refusal uses. */
  reason: string;
}

const V1: Omit<PilotHandling, "version"> = {
  clinicalRecords: false,
  egress: false,
  reason:
    "This participant agreed to the original notice, which said their answers are not a medical " +
    "record, that nobody would contact them because of what they enter, and that they are not " +
    "shared. Until they accept the current notice, nothing may be written about them and nothing " +
    "of theirs may leave.",
};

const V2: Omit<PilotHandling, "version"> = {
  clinicalRecords: true,
  egress: true,
  reason: "This participant accepted the current notice.",
};

// NO GRANT IS TREATED AS THE STRICTEST, NOT AS THE NEWEST. A person with no
// acknowledgment row is someone whose agreement cannot be demonstrated, and
// the answer to "we cannot show they agreed" is never "so anything goes".
const NONE: Omit<PilotHandling, "version"> = {
  clinicalRecords: false,
  egress: false,
  reason:
    "No acknowledgment is recorded for this participant, so what they agreed to cannot be shown. " +
    "Nothing may be written about them and nothing of theirs may leave until it can.",
};

/**
 * How this person's data may be handled.
 *
 * Reads the LATEST unrevoked acknowledgment. A person who accepts v2 after
 * holding v1 has two rows; the later one governs, and the earlier one stays as
 * the record that they were once handled differently.
 */
export async function pilotHandling(userId: string): Promise<PilotHandling> {
  const c = await data();
  const row = (await c.get(
    `SELECT policy_version FROM consents
      WHERE user_id = ? AND scope = ? AND revoked_at IS NULL
      ORDER BY granted_at DESC, id DESC LIMIT 1`,
    [userId, PILOT_ACK_SCOPE],
  )) as { policy_version: string } | undefined;

  const version = row?.policy_version ?? null;
  // AN UNRECOGNISED VERSION IS NOT A PASS. A future v3 that nobody taught this
  // function about must not inherit v2's permissions by being newer-looking:
  // the whole point is that permission follows the wording somebody read.
  const base = version === PILOT_TERMS_V2 ? V2 : version === PILOT_TERMS_V1 ? V1 : NONE;
  return { version, ...base };
}

/** Everyone in the pilot who is not yet on the current notice. The operator's
 *  re-consent worklist, and the number the backup warning needs. */
export async function participantsOnOldTerms(): Promise<{ userId: string; version: string | null }[]> {
  const c = await data();
  const { PILOT_TENANT_ID } = await import("./gate");
  const rows = (await c.all(
    `SELECT u.id AS user_id,
            (SELECT policy_version FROM consents
               WHERE user_id = u.id AND scope = ? AND revoked_at IS NULL
               ORDER BY granted_at DESC, id DESC LIMIT 1) AS version
       FROM users u JOIN persons p ON p.id = u.id
      WHERE u.tenant_id = ? AND u.role = 'member' AND u.status = 'active'
        AND p.provenance = 'real'`,
    [PILOT_ACK_SCOPE, PILOT_TENANT_ID],
  )) as { user_id: string; version: string | null }[];

  return rows
    .filter((r) => r.version !== PILOT_TERMS_V2)
    .map((r) => ({ userId: r.user_id, version: r.version }));
}
