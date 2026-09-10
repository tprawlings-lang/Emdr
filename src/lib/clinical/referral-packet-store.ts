// Compiling a referral packet from what the product already holds
// (handoff 09 §11's passive-compilation decision).
//
// Every section here is read from records that exist for another reason — the
// consents the member granted, the instruments they completed, the check-in
// they filled in this morning. Nothing is asked for at the moment of referral,
// which is the decision: the worst time to ask somebody to curate their own
// history is the moment they are being referred out of it.
//
// EVERY VALUE IS SHAPED BEFORE IT IS ASSEMBLED. `compile` refuses a field whose
// value does not fit its declared shape, so a column that starts carrying prose
// stops the packet rather than travelling in it.

import { data } from "../data";
import {
  compile, type PacketSection, type ReferralPacket,
} from "./referral-packet";

const day = (v: unknown): string => String(v ?? "").slice(0, 10);

export async function buildReferralPacket(args: {
  personId: string;
  tenantId: string;
  now?: Date;
}): Promise<ReferralPacket> {
  const c = await data();
  const now = args.now ?? new Date();

  // TENANT-SCOPED, like every other read of a person's record. A packet
  // assembled across a tenant boundary would be a disclosure twice over.
  const person = (await c.get(
    "SELECT id FROM users WHERE id = ? AND tenant_id = ?",
    [args.personId, args.tenantId]
  )) as { id: string } | undefined;
  if (!person) throw new Error("no such person in this tenant");

  const consents = (await c.all(
    "SELECT scope, granted_at FROM consents WHERE user_id = ? AND revoked_at IS NULL ORDER BY scope",
    [args.personId]
  )) as Array<{ scope: string; granted_at: string }>;

  // The latest reading per instrument. A packet reports where somebody is now,
  // not every score they have ever produced — the trend belongs to the chart.
  const measures = (await c.all(
    `SELECT instrument, instrument_version, total_score, created_at
       FROM screenings s
      WHERE s.user_id = ?
        AND s.created_at = (
          SELECT MAX(created_at) FROM screenings x
           WHERE x.user_id = s.user_id AND x.instrument = s.instrument)
      ORDER BY instrument`,
    [args.personId]
  )) as Array<{ instrument: string; instrument_version: string; total_score: number; created_at: string }>;

  const latestCheckin = (await c.get(
    `SELECT recommended_action, checkin_date FROM checkins
      WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1`,
    [args.personId]
  )) as { recommended_action: string; checkin_date: string } | undefined;

  const since = new Date(now.getTime() - 28 * 86400000).toISOString().slice(0, 10);
  const engagement = (await c.get(
    `SELECT
       (SELECT COUNT(*) FROM checkins WHERE user_id = ? AND checkin_date >= ?) AS checkins,
       (SELECT COUNT(*) FROM therapy_sessions WHERE user_id = ? AND status = 'completed') AS sessions`,
    [args.personId, since, args.personId]
  )) as { checkins: number; sessions: number };

  const readiness = (await c.get(
    `SELECT recommended_track FROM readiness_assessments
      WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [args.personId]
  )) as { recommended_track: string } | undefined;

  const sections: PacketSection[] = [
    {
      kind: "consent",
      title: "Consent on file",
      why: "A receiving clinician has to know what this person agreed to, and when.",
      fields: consents.map((r) => ({
        label: r.scope,
        shape: "date" as const,
        value: day(r.granted_at),
        source: "The consent you granted, with the date it was recorded.",
      })),
      absent: consents.length === 0
        ? "No active consent is on file, which is itself the answer to the question."
        : null,
    },
    {
      kind: "measures",
      title: "Latest validated measures",
      why:
        "The scores a receiving clinician would otherwise re-collect, with the instrument " +
        "version they were scored under.",
      fields: measures.map((r) => ({
        label: `${r.instrument} (${r.instrument_version})`,
        shape: "score" as const,
        value: String(r.total_score),
        source: `Your most recent ${r.instrument}, completed ${day(r.created_at)}.`,
      })),
      absent: measures.length === 0 ? "No validated measure has been completed yet." : null,
    },
    {
      kind: "safety",
      title: "Current safety state",
      why:
        "What the safety engine decided most recently, so a receiving clinician is not " +
        "surprised by a restriction they cannot see.",
      // THE STATE, NEVER THE REASONS. A rule id in a disclosure invites a
      // reader to re-derive a judgement without the inputs.
      fields: latestCheckin
        ? [{
            label: "Most recent routing",
            shape: "code" as const,
            value: latestCheckin.recommended_action,
            source: `The check-in you completed on ${day(latestCheckin.checkin_date)}.`,
          }]
        : [],
      absent: latestCheckin ? null : "No check-in has been completed, so there is no current state to report.",
    },
    {
      kind: "engagement",
      title: "Engagement",
      why: "How much of the program has actually been used, as counts rather than a rate.",
      fields: [
        {
          label: "Check-ins in the last 28 days",
          shape: "count" as const,
          value: String(engagement?.checkins ?? 0),
          source: "Counted from your own check-ins.",
        },
        {
          label: "Sessions completed",
          shape: "count" as const,
          value: String(engagement?.sessions ?? 0),
          source: "Counted from sessions that reached a close.",
        },
      ],
      absent: null,
    },
    {
      kind: "program",
      title: "Program state",
      why: "Which track the readiness assessment placed this person on.",
      fields: readiness
        ? [{
            label: "Recommended track",
            shape: "code" as const,
            value: readiness.recommended_track,
            source: "Your most recent readiness assessment.",
          }]
        : [],
      absent: readiness ? null : "No readiness assessment has been recorded yet.",
    },
  ];

  return compile({
    personId: args.personId,
    sections,
    compiledAt: now.toISOString(),
    scopes: consents.map((r) => r.scope),
  });
}
