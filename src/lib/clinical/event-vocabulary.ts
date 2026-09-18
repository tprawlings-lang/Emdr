// What a clinician reads where an event key used to be.
//
// UX 009, observed: "Raw event keys and routing values appear in routine
// clinical views. Add clinician-approved display mappings; retain raw values in
// details." Its acceptance condition is one sentence: "The same concept has one
// user-facing label across pages."
//
// THE ARTEFACT was `{e.type.replace(/_/g, " ")}` in the audit table, which put
// "clinician thought items saved" and "gate safety item fired" in the Event
// column of a person's record. Swapping underscores for spaces is not
// translation — it is the identifier with its punctuation changed, and it reads
// as English while meaning nothing a clinician would say.
//
// THREE RULES THIS FILE FOLLOWS, and the third is the one that matters:
//
//   THE RAW KEY IS RETAINED, NEVER REPLACED. The handoff says "retain raw
//   values in details", and the audit log is a record somebody may have to
//   reconcile against a database. The term is what the column shows; the key
//   stays one disclosure away.
//
//   EVERY TERM CARRIES WHAT IT DOES NOT MEAN. The distinctions this product
//   keeps — opened is not reviewed, recorded is not delivered, proposed is not
//   accepted, a model drafting is not a clinician approving — are exactly the
//   ones a two-word label loses. So each entry has a note, and the note is
//   where the boundary lives.
//
//   AN UNAPPROVED KEY IS MARKED, NOT GUESSED. `displayTermFor` returns
//   `approved: false` for anything absent here, and the surface renders it
//   visibly as a raw key rather than dressing it up. A vocabulary that
//   silently invents words for new events is a vocabulary whose approval means
//   nothing a month later — the clinical review covers THESE words and no
//   others, and coverage has to be visible for that to stay true.
//
// THE APPROVAL ITSELF IS NOT HERE. It is a separate record that binds named
// reviewers and a date to a hash of these entries, in
// `src/lib/governance/clinical-approval.ts`, so changing one word below breaks
// the binding rather than quietly inheriting somebody's sign-off.

export interface EventTerm {
  /** The clinician-facing words. */
  term: string;
  /** What it means, and — where the distinction matters — what it does not. */
  note: string;
}

/**
 * The approved terms, by event key.
 *
 * Ordered by family and then alphabetically, which is the order the approval
 * document lists them in, so a reviewer comparing the two reads one sequence.
 */
export const EVENT_TERMS: Record<string, EventTerm> = {
  // -- Attention and work ---------------------------------------------------
  attention_signal_acknowledged: {
    term: "Attention signal acknowledged",
    note: "A clinician marked that they had seen this signal. Acknowledging is not reviewing and decides nothing.",
  },
  attention_signal_state_changed: {
    term: "Attention signal changed state",
    note: "The signal moved between states under the attention policy. The policy decided this, not a person.",
  },
  work_assigned: {
    term: "Work assigned",
    note: "Ownership of this work was recorded against somebody. Nobody was notified — there is no delivery path in this build.",
  },
  command_context_opened: {
    term: "Person opened from the work queue",
    note: "A clinician opened this record from Command Center. Opening is not acknowledgement.",
  },
  review_completed: {
    term: "Review completed",
    note:
      "A clinician recorded that they reviewed this and what they decided. It records their judgement, not an outcome, and it does not close whatever the work was about.",
  },
  review_note_status: {
    term: "Review note status changed",
    note: "The status of a review note changed. It does not change any clinical decision the note describes.",
  },

  // -- Contact and outreach -------------------------------------------------
  contact_attempt_recorded: {
    term: "Contact attempt recorded",
    note: "A clinician recorded that they tried to make contact, and what happened. It is not proof that anything was delivered or received.",
  },
  autopilot_outreach: {
    term: "Automated outreach sent",
    note: "The product sent a scheduled message. Sending is not reading, and no reply is implied.",
  },

  // -- Accountability -------------------------------------------------------
  care_handoff_proposed: {
    term: "Transfer of accountability proposed",
    note: "One clinician asked another to take over. The person who proposed it remains accountable until it is accepted.",
  },
  care_handoff_resolved: {
    term: "Transfer of accountability answered",
    note: "The proposed transfer was accepted, declined or withdrawn. The detail says which.",
  },

  // -- Care plan and paths --------------------------------------------------
  care_track_selected: {
    term: "Care path selected",
    note: "A care path was chosen for this person. Paths are optional and the programme runs without one.",
  },
  care_track_archived: {
    term: "Care path archived",
    note: "A care path was closed. The record of it stays; only its active status changed.",
  },
  program_plan_generated: {
    term: "Programme draft generated",
    note: "A draft programme was produced. A draft is a suggestion until a clinician approves it, and generation is not approval.",
  },

  // -- Goals ----------------------------------------------------------------
  return_goal_created: {
    term: "Life goal recorded",
    note: "A goal was written down in the person's own words.",
  },
  return_goal_confirmed: {
    term: "Life goal confirmed",
    note: "A clinician confirmed the goal as written.",
  },
  return_goal_observation_recorded: {
    term: "Observation recorded against a goal",
    note: "Something observed was attached to a goal. The source — the person's report or a clinician's observation — is on the record.",
  },
  return_goal_observation_decided: {
    term: "Proposed observation answered",
    note: "A clinician accepted or rejected a proposed observation. A proposal is not evidence until somebody answers it.",
  },
  return_goals_opened: {
    term: "Life goals opened",
    note: "A clinician opened the goals screen. Opening changes nothing.",
  },

  // -- Measures, course and trajectory --------------------------------------
  screening_submitted: {
    term: "Measure completed",
    note: "The person completed a scored instrument. The score is on its own validated scale and is not combined with any other.",
  },
  person_course_opened: {
    term: "Course opened",
    note: "A clinician opened the course landing. Opening changes nothing.",
  },
  person_care_opened: {
    term: "Care opened",
    note: "A clinician opened the care section. Opening changes nothing.",
  },
  recovery_trajectory_opened: {
    term: "Trajectory opened",
    note: "A clinician opened the trajectory screen. Opening changes nothing.",
  },
  trajectory_snapshot_saved: {
    term: "Trajectory reading stored",
    note: "A reading was stored so it can be reproduced later from the same evidence, cutoff and policy version. It describes recorded observations and forecasts nothing.",
  },
  trajectory_reviewed: {
    term: "Trajectory reading reviewed",
    note: "A clinician agreed, disagreed or corrected a reading. The original reading stays on the record beside their answer.",
  },
  therapeutic_load_opened: {
    term: "Load and readiness opened",
    note: "A clinician opened the load screen. Opening changes nothing, and nothing on that screen restricts access.",
  },
  therapeutic_load_reviewed: {
    term: "Load and readiness reviewed",
    note: "A clinician recorded their reading of load and readiness.",
  },

  // -- Observed responses and interventions ---------------------------------
  intervention_recorded: {
    term: "Intervention recorded",
    note: "What was done with this person was written down. Recording is not a claim about what followed it.",
  },
  intervention_confirmed: {
    term: "Intervention confirmed",
    note:
      "A clinician confirmed an intervention as recorded. Confirming is standing behind the record of what was done; it is not a statement about what followed it.",
  },
  intervention_remapped: {
    term: "Intervention reclassified",
    note: "An intervention was moved to a different classification. Both the original and the correction stay readable.",
  },
  intervention_record_opened: {
    term: "Intervention record opened",
    note:
      "A clinician opened the intervention record. Opening is not reviewing and changes nothing.",
  },
  post_session_check: {
    term: "Post-session check recorded",
    note: "What was observed after a session was recorded. Things in the same period are context, and context is not cause.",
  },
  between_visit_care_action: {
    term: "Between-visit action recorded",
    note: "Something done between visits was recorded.",
  },
  between_visit_care_action_corrected: {
    term: "Between-visit action corrected",
    note: "A between-visit record was corrected. The original stays readable beside the correction.",
  },

  // -- Notes, thoughts and memory -------------------------------------------
  clinician_thought_started: {
    term: "Working note started",
    note: "A clinician began a working note. Working notes are theirs and are not part of the clinical record until filed.",
  },
  clinician_thought_captured: {
    term: "Working note captured",
    note: "A working note was captured, by voice or by typing.",
  },
  clinician_thought_written: {
    term: "Working note written",
    note:
      "A clinician typed a working note rather than speaking it. Both produce the same kind of note, and neither is part of the clinical record until items are approved from it.",
  },
  clinician_thought_saved: {
    term: "Working note saved",
    note: "A working note was saved. Saving is not filing and not signing.",
  },
  clinician_thought_items_saved: {
    term: "Note items approved into memory",
    note: "A clinician reviewed proposed items and approved them as reusable clinical memory. Nothing becomes memory without that review.",
  },
  clinician_thought_discarded: {
    term: "Working note discarded",
    note: "A working note was discarded before anything was approved from it.",
  },
  clinician_thought_organized: {
    term: "Working note organised",
    note: "A clinician rearranged their own working note. Nothing clinical changed.",
  },
  clinician_thoughts_opened: {
    term: "Notes opened",
    note: "A clinician opened the notes workspace. Opening changes nothing.",
  },
  clinician_transcript_corrected: {
    term: "Transcript corrected",
    note: "A clinician corrected a transcription. The original stays readable.",
  },
  clinical_memory_item_corrected: {
    term: "Approved memory corrected",
    note: "An item of approved clinical memory was corrected. The original stays readable beside it.",
  },
  clinical_record_corrected: {
    term: "Record corrected",
    note: "A clinical record was corrected. Both what was believed then and what is believed now keep their answers.",
  },
  note_draft_assembled: {
    term: "Note draft assembled",
    note: "Approved items were assembled into a draft to take into the record system. Steady does not sign it — a signature attests to a clinician's own statement.",
  },

  // -- Threads and connections ----------------------------------------------
  clinical_thread_created: {
    term: "Clinical thread created",
    note:
      "A thread was opened to follow one line of clinical thinking. A thread groups thinking; it is not a clinical finding and decides nothing.",
  },
  clinical_thread_connection_accepted: {
    term: "Suggested connection accepted",
    note: "A clinician accepted a suggested connection between records. The suggestion is not evidence; their acceptance is the decision.",
  },
  clinical_thread_connection_rejected: {
    term: "Suggested connection rejected",
    note: "A clinician rejected a suggested connection. The suggestion stays on the record with their answer.",
  },
  clinical_thread_connection_revisited: {
    term: "Connection decision revisited",
    note: "A clinician returned to a connection they had already answered.",
  },

  // -- Ask Steady -----------------------------------------------------------
  clinician_ask_answered: {
    term: "Question answered from the record",
    note: "An evidence-linked answer was produced from information this clinician is authorised to see. An answer is assistance, not an approved record.",
  },
  clinician_ask_scope_violation: {
    term: "Question refused: outside permitted scope",
    note: "An answer was refused because it would have drawn on something this clinician may not see. The refusal is the safe outcome, not an error.",
  },

  // -- The person's own activity --------------------------------------------
  practice_completed: {
    term: "Practice completed",
    note: "The person completed a practice. Use is not improvement.",
  },
  lesson_read: {
    term: "Lesson read",
    note: "The person opened a lesson. Reading is not improvement.",
  },
  companion_daily_chat_opened: {
    term: "Companion opened",
    note: "The person opened the companion. Opening changes nothing clinical.",
  },
  companion_message: {
    term: "Companion message",
    note: "A message passed between the person and the companion. The companion sets no clinical urgency and grants no access.",
  },
  companion_weekly_capped: {
    term: "Companion weekly limit reached",
    note: "The person reached the weekly companion limit. It is a usage limit, not a clinical judgement about them.",
  },
  companion_memory_deleted: {
    term: "Companion memory deleted",
    note: "The person deleted what the companion remembered. This is their choice and needs no clinical reason.",
  },
  trigger_updated: {
    term: "Trigger updated",
    note:
      "The person updated what they identified as a trigger, in their own words. It is the person's own account, not a clinician's observation.",
  },
  trigger_mapped_in_session: {
    term: "Trigger mapped in session",
    note:
      "A trigger was mapped during a session. Mapping records a connection the work surfaced; it is not a cause.",
  },

  // -- Sessions -------------------------------------------------------------
  session_prepared: {
    term: "Session prepared",
    note: "A session was set up. Preparation is not a session.",
  },
  session_started: {
    term: "Session started",
    note:
      "The person began a session. Starting is not completing, and nothing here says how it went.",
  },
  session_spoken_response: {
    term: "Spoken response recorded",
    note: "A spoken response was recorded during a session.",
  },

  // -- Safety and access ----------------------------------------------------
  gate_safety_item_fired: {
    term: "Safety rule applied",
    note: "A safety rule restricted what happens next. The rule decided this; nothing on a reading screen can change, clear or add to it.",
  },
  // These three name what raised a safety obligation. They appear in the
  // activity feed's headline as well as the audit column, which is why they are
  // written to read as a noun phrase in both places.
  checkin_safety_positive: {
    term: "Safety item answered on a check-in",
    note: "The person answered a safety item in a way the policy treats as requiring a response. It is an obligation to respond, not a conclusion about them.",
  },
  screening_risk_item: {
    term: "Risk item on a scored measure",
    note: "A risk item on an instrument was answered in a way that requires a response. The instrument's own scale decides this, not a clinician's reading of it.",
  },
  session_hard_stop: {
    term: "Session stopped by a safety rule",
    note: "A rule stopped a session in progress. The rule decided this; the stop is not a judgement about the person.",
  },
  alert_reviewed: {
    term: "Safety alert reviewed",
    note: "A clinician reviewed a safety alert. Reviewing is not closing.",
  },
  alert_closed: {
    term: "Safety alert closed",
    note: "A clinician closed a safety alert with a documented action.",
  },
  clinical_override: {
    term: "Clinical override recorded",
    note: "A clinician overrode an automated decision, with a reason on the record.",
  },
  clinical_review_approved: {
    term: "Clinical review approved",
    note:
      "A named clinician approved something that required clinical review. The approval covers what was put in front of them, not the surrounding work.",
  },
  unlock_requested: {
    term: "Module request made",
    note: "The person asked for a gated module to be opened. Asking is not opening; it waits for a clinician's decision and reason.",
  },
  module_override_opened: {
    term: "Module opened by decision",
    note: "A clinician opened a gated module with a reason the person can read. It relaxes the clinician gate only — the daily check-in, the cooldown, the per-day cap and the kill switch all still apply.",
  },
  module_override_closed: {
    term: "Module left closed by decision",
    note: "A clinician declined to open a gated module, with a reason the person can read.",
  },

  // -- Access to the record -------------------------------------------------
  //
  // These are security-family events and they belong in a clinical vocabulary
  // because they are what a person's audit tab is FOR: who looked, who
  // exported, and what was refused. `person_record_viewed` was left out of the
  // first pass and turned out to be three of the first five rows on the tab.
  person_record_viewed: {
    term: "Record opened",
    note: "Somebody opened this person's record. Opening is not treatment and not review; it is the access itself being recorded.",
  },
  export_created: {
    term: "Export prepared",
    note: "An export of records was prepared. Preparing is not sending, and nothing left the product because this row exists.",
  },
  export_downloaded: {
    term: "Export downloaded",
    note:
      "A prepared export was downloaded. This is the point at which data left the product; preparing one does not.",
  },
  export_download_refused: {
    term: "Export download refused",
    note: "A download was refused. The refusal is the control working, not an error.",
  },
  export_out_of_scope: {
    term: "Export refused: outside permitted scope",
    note: "An export was refused because it reached beyond what the requester may see. Nothing was produced.",
  },
  export_signature_invalid: {
    term: "Export refused: signature did not verify",
    note: "An export's signature did not verify, so it was refused. Treat the file as untrustworthy rather than merely stale.",
  },

  // -- Consent --------------------------------------------------------------
  pilot_terms_accepted: {
    term: "Pilot terms accepted",
    note: "The person accepted a named version of the pilot terms. What may be recorded about them follows the version they accepted, not the current one.",
  },
  pilot_terms_declined: {
    term: "Pilot terms declined",
    note: "The person declined the current pilot terms. Declining is a valid answer and is not a clinical event.",
  },

  // -- Account --------------------------------------------------------------
  login_failed: {
    term: "Sign-in failed",
    note: "A sign-in attempt failed. It says nothing about who was typing.",
  },
  login_locked: {
    term: "Sign-in paused after repeated failures",
    note: "Sign-in was paused for fifteen minutes after ten failures. A paused account is not a disengaged person.",
  },
  demo_patient_created: {
    term: "Fabricated person created",
    note: "A fabricated person was created for demonstration. Nobody real is involved.",
  },

  // -- Governance sign-off --------------------------------------------------
  autonomous_rule_signoff: {
    term: "Automated rule signed off",
    note: "A named reviewer signed off an automated rule.",
  },
  release_gate_signoff_stale: {
    term: "Sign-off out of date",
    note: "A recorded sign-off no longer matches the evidence it was given against, so it no longer counts as approval.",
  },
};

export interface DisplayTerm {
  /** What to show. */
  term: string;
  /** What it means and does not mean, or null when there are no approved words. */
  note: string | null;
  /** Whether these words carry a clinical approval. */
  approved: boolean;
  /** Always the raw key, for the detail line. Never dropped. */
  key: string;
}

/**
 * The words for one event key.
 *
 * AN UNKNOWN KEY IS NOT GUESSED AT. It comes back with `approved: false` and
 * the humanised key, so a surface can render it as the raw value it is. The
 * alternative — quietly inventing a label — would mean the clinical approval
 * covered whatever the vocabulary happened to contain on the day somebody read
 * it, which is the drift this product keeps finding in its own records.
 */
export function displayTermFor(key: string): DisplayTerm {
  const approved = EVENT_TERMS[key];
  if (approved) return { term: approved.term, note: approved.note, approved: true, key };
  return { term: key.replace(/_/g, " "), note: null, approved: false, key };
}

/** How much of what a surface shows carries approved words. Exposed so the
 *  gap is reportable rather than discovered. */
export function coverageOf(keys: readonly string[]): {
  total: number; approved: number; missing: string[];
} {
  const seen = [...new Set(keys)];
  const missing = seen.filter((k) => !EVENT_TERMS[k]).sort();
  return { total: seen.length, approved: seen.length - missing.length, missing };
}
