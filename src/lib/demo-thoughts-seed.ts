import crypto from "crypto";
import type Database from "better-sqlite3";
import { demoId } from "./demo-seed";
import { demoEpoch } from "./demo-population-calendar";
import { encryptField } from "./crypto";
import { hashTranscript } from "./clinical/transcription";
import type * as FixtureModule from "./clinical/extraction-fixture";
import type * as ContractModule from "./clinical/extraction-contract";

// Clinician Thoughts, seeded (Phases 1–3).
//
// The surface is correct and empty without this. A reviewer opens a demo
// member's Thoughts tab, finds nothing, and the only way to see the feature is
// to record something — which works, and which shows one thought at the start
// of its life. What it cannot show is the thing the feature is FOR: memory
// accumulating, a theme with evidence under it across months, and a suggestion
// waiting on a judgement.
//
// THE ITEMS COME FROM THE REAL EXTRACTOR. `fixtureExtraction` is a pure
// function, so the seed runs the same pipeline the product runs and stores what
// it returns. Hand-writing plausible items instead would let the seed drift
// from the extractor and demonstrate a screen the code cannot actually produce
// — which is the failure mode of every demo that is maintained separately from
// the thing it demonstrates.
//
// WHAT IS DELIBERATELY LEFT UNDECIDED. One connection is pending and one was
// refused. A console where every decision is already made shows the outcome and
// never the act, and the act — Connect, Not related, and the refusal that
// stays refused — is what Phase 3 is.

const THOUGHTS_SEED_VERSION = "thoughts-demo-2026-09-v1";

function tId(kind: string, key: string): string {
  return crypto
    .createHash("sha256")
    .update(`${THOUGHTS_SEED_VERSION}:${kind}:${key}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
}

function at(dayOffset: number): string {
  return new Date(demoEpoch().getTime() + dayOffset * 86_400_000)
    .toISOString().replace("T", " ").slice(0, 19);
}

/** The two fabricated transcripts this seed uses, with the day each was
 *  recorded. Two rather than one so a theme can have evidence from more than a
 *  single moment — a "pattern" built from one observation is not a pattern. */
const RECORDINGS: Array<{ key: string; day: number; text: string }> = [
  {
    key: "sleep-and-sister",
    day: 300,
    text:
      "She semed steadier today. Not calm exactly, but she stayed in the room with it, "
      + "which she has not managed before. She said \"I keep waiting for it to go wrong\" — "
      + "her words, not mine. I think this might connect to the thing with her sister, but I "
      + "am not sure yet and I do not want to lead her there. Sleep is still poor, maybe four "
      + "hours. Follow up on the sleap next session.",
  },
  {
    key: "cancellation-call",
    day: 355,
    text:
      "Short one. She cancelled and then called, so this is from the phone conversation rather "
      + "than a session. She sounded flat. Said she has not been doing the practice and "
      + "\"there is no point\" — I am recording that as her words because I do not want it "
      + "read as my assessment of her motivation. Worth a check-in before the next appointment.",
  },
  {
    key: "lateness-and-distress",
    day: 340,
    text:
      "Third session in a row where she has arrived late and apologised for it. Not reading "
      + "that as avoidance yet. Distress went from about a seven to a three during the set, "
      + "which is the biggest shift she has had. She used the cue word without being prompted. "
      + "I want to check whether the work thing is still active before we go further.",
  },
];

export function seedClinicianThoughts(db: Database.Database, tenantId: string): void {
  const already = db.prepare("SELECT 1 FROM clinician_thoughts LIMIT 1").get();
  if (already) return;

  const memberId = demoId(0);
  const clinicianId = demoId(2);
  // Both must exist as PERSONS, not just users: every thoughts table points at
  // persons. Skipping rather than failing keeps a non-demo-seeded database from
  // taking the boot down — same reasoning as the review console seed.
  const havePersons = db
    .prepare("SELECT COUNT(*) AS n FROM persons WHERE id IN (?, ?)")
    .get(memberId, clinicianId) as { n: number };
  if (havePersons.n < 2) return;

  // Loaded at call time: the extraction fixture reaches the contract, which is
  // in the same import cycle that took the boot down twice already.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { fixtureExtraction } = require("./clinical/extraction-fixture") as typeof FixtureModule;
  const { validateExtraction } = require("./clinical/extraction-contract") as typeof ContractModule;
  const { FIXTURE_MARKER } = require("./clinical/transcription-fixture") as { FIXTURE_MARKER: string };
  /* eslint-enable @typescript-eslint/no-require-imports */

  const insThought = db.prepare(
    `INSERT INTO clinician_thoughts
       (id, tenant_id, person_id, clinician_person_id, status, audio_storage_key,
        audio_retention_policy, audio_deleted_at, current_transcript_id, recorded_at, saved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'saved', NULL, 'delete_after_verified_transcript', ?, ?, ?, ?, ?, ?)`
  );
  const insTranscript = db.prepare(
    `INSERT INTO clinician_thought_transcripts
       (id, tenant_id, person_id, thought_id, version, transcript_text, transcript_hash,
        provider, provider_model, language, confidence_json, created_by, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, 'fixture', 'fixture-transcripts-v1', 'en', NULL, 'transcription_service', ?)`
  );
  const insItem = db.prepare(
    `INSERT INTO clinical_memory_items
       (id, tenant_id, person_id, source_thought_id, source_transcript_id, source_span_json,
        item_type, statement_class, normalized_label, display_text, status,
        approved_by, approved_at, supersedes_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  );
  const insThread = db.prepare(
    `INSERT INTO clinical_threads
       (id, tenant_id, person_id, thread_type, canonical_label, status, created_by,
        first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, 'theme', ?, 'active', 'clinician', ?, ?, ?, ?)`
  );
  const insMember = db.prepare(
    `INSERT INTO clinical_thread_memberships
       (id, tenant_id, person_id, thread_id, memory_item_id, relationship, status,
        proposed_by, decided_by, decided_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'supports', ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    // Keyed by the item's own TEXT. The first version keyed on the extractor's
    // normalized label and guessed one of them wrong — "her sister" where the
    // fixture says "sibling relationship" — so the thread wiring below silently
    // found nothing and the demo shipped a theme with no evidence and no
    // pending decision. The text is what the fixture states outright.
    const byText = new Map<string, { id: string; day: number }>();

    for (const rec of RECORDINGS) {
      const text = `${rec.text}\n\n${FIXTURE_MARKER}`;
      const thoughtId = tId("thought", rec.key);
      const transcriptId = tId("transcript", rec.key);

      insThought.run(
        thoughtId, tenantId, memberId, clinicianId,
        at(rec.day), transcriptId, at(rec.day), at(rec.day), at(rec.day), at(rec.day)
      );
      insTranscript.run(
        transcriptId, tenantId, memberId, thoughtId, text, hashTranscript(text), at(rec.day)
      );

      const raw = fixtureExtraction(transcriptId, text);
      if (!raw) continue;
      // Through the SAME validator the product uses. If the contract would
      // refuse an item, the demo must not contain it — a seed that bypassed
      // validation could show a screen state the pipeline cannot reach.
      const { items } = validateExtraction(raw, transcriptId, text);

      items.forEach((item) => {
        const itemId = tId("item", `${rec.key}:${item.tempId}`);
        // The two deliberately-wrong candidates stay REJECTED here, which is
        // what a clinician would have done with them — and is why the kept list
        // reads as somebody's judgement rather than as everything the model said.
        const wrong =
          item.displayText === "Lateness reflects avoidance." ||
          item.displayText === "Clinician assesses motivation as low.";
        const status = wrong ? "rejected" : "approved";
        insItem.run(
          itemId, tenantId, memberId, thoughtId, transcriptId,
          JSON.stringify({
            ...(item.sourceStart !== null && item.sourceEnd !== null
              ? { start: item.sourceStart, end: item.sourceEnd }
              : {}),
            ...(item.numericFacts ? { numericFacts: item.numericFacts } : {}),
          }),
          item.itemType, item.statementClass,
          item.normalizedLabel ? encryptField(item.normalizedLabel) : null,
          encryptField(item.displayText),
          status,
          status === "approved" ? clinicianId : null,
          status === "approved" ? at(rec.day) : null,
          at(rec.day)
        );
        if (status === "approved") byText.set(item.displayText, { id: itemId, day: rec.day });
      });
    }

    // --- One theme with evidence under it. -------------------------------
    const sleepThread = tId("thread", "sleep");
    insThread.run(sleepThread, tenantId, memberId, encryptField("sleep"), at(300), at(340), at(300), at(340));
    for (const text of [
      "Sleep remains poor — around four hours.",
      "Follow up on sleep next session.",
    ]) {
      const item = byText.get(text);
      if (!item) continue;
      insMember.run(
        tId("member", `sleep:${text}`), tenantId, memberId, sleepThread, item.id,
        "accepted", "clinician", clinicianId, at(item.day), at(item.day)
      );
    }

    // --- One theme carrying an open decision and a closed one. -----------
    //
    // Everything accepted under it is a hypothesis or an uncertainty, which is
    // deliberate: it is what makes the screen's "nothing here has been recorded
    // as observed" warning visible on a real theme rather than only in a test.
    const sisterThread = tId("thread", "sister");
    insThread.run(sisterThread, tenantId, memberId, encryptField("her sister"), at(300), at(300), at(300), at(300));

    const held = byText.get("Holding back from naming the connection so as not to lead.");
    if (held) {
      insMember.run(
        tId("member", "sister:held"), tenantId, memberId, sisterThread, held.id,
        "accepted", "clinician", clinicianId, at(held.day), at(held.day)
      );
    }
    // PENDING. The reviewer arrives with a judgement still to make, which is the
    // only way to see Connect / Not related actually work.
    const hypothesis = byText.get("Possible connection to the material about her sister. Not established.");
    if (hypothesis) {
      insMember.run(
        tId("member", "sister:pending"), tenantId, memberId, sisterThread, hypothesis.id,
        "proposed", "system", null, null, at(340)
      );
    }
    // REFUSED, and it stays refused — visible only behind "previously not
    // related", which is the seen half of the rule that the matcher may not ask
    // again.
    const distress = byText.get("Distress fell from about 7 to about 3 across the set — largest shift so far.");
    if (distress) {
      insMember.run(
        tId("member", "sister:refused"), tenantId, memberId, sisterThread, distress.id,
        "rejected", "system", clinicianId, at(341), at(340)
      );
    }
  })();
}
