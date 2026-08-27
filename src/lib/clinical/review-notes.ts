// Reviewer change requests (Phase 4 testing cycle).
//
// The environment exists so that a clinician, an executive, a security reviewer,
// or an investor can walk it and say what they would change. That only works if
// there is somewhere for the answer to land. Without this, feedback arrives as a
// verbal aside in a call and is gone by the next commit — and the reviewer, who
// spent an hour on it, sees nothing change and concludes the review was
// decorative.
//
// Design decisions worth stating:
//
//   TWO FIELDS, NOT ONE. "What you saw" and "what you want instead" are
//   captured separately. A single free-text box produces notes that describe a
//   feeling about a screen; the pair produces something actionable, and the gap
//   between them is often where the real disagreement is.
//
//   PRIORITY IS THE REVIEWER'S, NOT OURS. A clinician saying "this is a
//   blocker" is a clinical judgement and is recorded as given. Nobody
//   downgrades it on the way in.
//
//   CONFIGURATION IS STAMPED. A note about alert deadlines means nothing
//   without knowing which coverage model was active when it was written. The
//   policy and safety-config versions are captured automatically, because a
//   reviewer should not have to know they matter.

import { data } from "../data";
import { newId } from "../db";
import { audit } from "../audit";
import { activePolicy } from "../clinical-policy";
import { SAFETY_CONFIG_VERSION } from "../safety/governance";

/** How urgent the reviewer considers it. Their call, recorded as given. */
export type NotePriority =
  /** Would stop a pilot. */
  | "blocker"
  /** Should change before real use. */
  | "change"
  /** Needs an answer before they can judge it. */
  | "question"
  /** Worth considering, not required. */
  | "idea";

export const PRIORITY_LABEL: Record<NotePriority, string> = {
  blocker: "Blocker — would stop a pilot",
  change: "Change — should change before real use",
  question: "Question — needs an answer to judge",
  idea: "Idea — worth considering",
};

export type NoteStatus = "open" | "acknowledged" | "actioned" | "declined";

export const STATUS_LABEL: Record<NoteStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  actioned: "Actioned",
  declined: "Declined",
};

/** What the note is about. Offered as a list so notes group into a work plan
 *  rather than a pile, and so a reviewer is prompted toward the dimensions we
 *  actually need judged. */
export const CATEGORIES = [
  "Clinical safety",
  "Clinical accuracy",
  "Workflow fit",
  "Alert handling",
  "Caseload and prioritisation",
  "AI output and citations",
  "Wording and framing",
  "Consent and disclosure",
  "Accessibility",
  "Security and privacy",
  "Data and reporting",
  "Something is broken",
] as const;

/** The surfaces a reviewer can be on. Free text is allowed too — an unlisted
 *  surface is a finding in itself. */
export const SURFACES = [
  "Caseload",
  "Member record / timeline",
  "Summary and citations",
  "Alerts",
  "Alert trail / audit history",
  "BLS Part 6 oversight",
  "Autonomous review console",
  "Member experience — check-in",
  "Member experience — session",
  "Member experience — companion",
  "Member experience — grounding / SOS",
  "Onboarding and consent",
  "Public site",
  "Other",
] as const;

export interface ReviewNote {
  id: string;
  reviewerId: string;
  reviewerRole: string;
  reviewerName: string;
  surface: string;
  category: string;
  priority: NotePriority;
  observed: string;
  requested: string;
  status: NoteStatus;
  subjectId: string | null;
  configVersion: string | null;
  policyVersion: string | null;
  createdAt: string;
}

export class ReviewNoteError extends Error {}

/** File a change request. */
export async function fileNote(args: {
  reviewerId: string;
  reviewerRole: string;
  surface: string;
  category: string;
  priority: NotePriority;
  observed: string;
  requested: string;
  subjectId?: string | null;
}): Promise<string> {
  const observed = args.observed.trim();
  const requested = args.requested.trim();

  // Both halves are required. A note with only the complaint cannot be acted
  // on, and a note with only the request loses the evidence for it.
  if (observed.length < 3) {
    throw new ReviewNoteError("Describe what you saw. A request without the observation behind it cannot be judged later.");
  }
  if (requested.length < 3) {
    throw new ReviewNoteError("Describe what you want instead. Without it this is a reaction rather than a change request.");
  }

  const id = newId();
  const c = await data();

  // Tenant and reviewer name are stored, not joined. A demo reset deletes and
  // re-seeds users; the note has to remain readable, attributable, and scoped
  // afterwards, because it is feedback about the product rather than a record
  // about a person. Reading the tenant from the reviewer's own row also means a
  // caller cannot supply one.
  const who = (await c.get(
    "SELECT name, tenant_id FROM users WHERE id = ?", [args.reviewerId]
  )) as { name: string | null; tenant_id: string } | undefined;
  if (!who) throw new ReviewNoteError("Unknown reviewer.");

  await c.run(
    `INSERT INTO review_notes
       (id, reviewer_id, reviewer_name, tenant_id, reviewer_role, surface, category,
        priority, observed, requested, subject_id, config_version, policy_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, args.reviewerId, who.name ?? "unnamed", who.tenant_id, args.reviewerRole,
      args.surface, args.category, args.priority, observed, requested,
      args.subjectId ?? null, SAFETY_CONFIG_VERSION, activePolicy().version,
    ]
  );

  await audit({
    actorId: args.reviewerId,
    actorRole: args.reviewerRole === "clinician" ? "clinician" : "member",
    // A blocker from a clinical reviewer is a safety signal, and is filed where
    // safety review will look rather than in a product backlog.
    family: args.priority === "blocker" ? "safety" : "clinical",
    type: "review_note_filed",
    target: args.subjectId ?? null,
    detail: { surface: args.surface, category: args.category, priority: args.priority },
  });

  return id;
}

export async function setNoteStatus(args: {
  noteId: string;
  status: NoteStatus;
  actorId: string;
}): Promise<void> {
  const c = await data();
  await c.run("UPDATE review_notes SET status = ? WHERE id = ?", [args.status, args.noteId]);
  await audit({
    actorId: args.actorId, actorRole: "clinician", family: "clinical",
    type: "review_note_status", target: args.noteId, detail: { status: args.status },
  });
}

/** Notes filed by reviewers in this tenant.
 *
 *  Scoped on the note's own `tenant_id`, stamped at write time from the
 *  reviewer's record. No join, so a note survives a reset that re-seeds users
 *  and stays correctly scoped either way. */
export async function listNotes(args: {
  tenantId: string;
  status?: NoteStatus;
}): Promise<ReviewNote[]> {
  const c = await data();
  const params: unknown[] = [args.tenantId];
  let sql = `SELECT n.* FROM review_notes n WHERE n.tenant_id = ?`;
  if (args.status) {
    sql += " AND n.status = ?";
    params.push(args.status);
  }
  sql += " ORDER BY CASE n.priority WHEN 'blocker' THEN 0 WHEN 'change' THEN 1 WHEN 'question' THEN 2 ELSE 3 END, n.created_at DESC";

  const rows = (await c.all(sql, params)) as Array<Record<string, string | null>>;
  return rows.map((r) => ({
    id: r.id as string,
    reviewerId: r.reviewer_id as string,
    reviewerRole: r.reviewer_role as string,
    reviewerName: (r.reviewer_name as string) ?? "unknown",
    surface: r.surface as string,
    category: r.category as string,
    priority: r.priority as NotePriority,
    observed: r.observed as string,
    requested: r.requested as string,
    status: r.status as NoteStatus,
    subjectId: r.subject_id,
    configVersion: r.config_version,
    policyVersion: r.policy_version,
    createdAt: r.created_at as string,
  }));
}

export interface NoteSummary {
  total: number;
  byPriority: Record<NotePriority, number>;
  byStatus: Record<NoteStatus, number>;
  openBlockers: number;
}

export function summarise(notes: ReviewNote[]): NoteSummary {
  const byPriority: Record<NotePriority, number> = { blocker: 0, change: 0, question: 0, idea: 0 };
  const byStatus: Record<NoteStatus, number> = { open: 0, acknowledged: 0, actioned: 0, declined: 0 };
  for (const n of notes) {
    byPriority[n.priority] += 1;
    byStatus[n.status] += 1;
  }
  return {
    total: notes.length,
    byPriority,
    byStatus,
    openBlockers: notes.filter((n) => n.priority === "blocker" && n.status === "open").length,
  };
}

/** Render the notes as Markdown so a review session ends with something the
 *  founder can paste into a plan, rather than a screen someone has to
 *  transcribe. */
export function toMarkdown(notes: ReviewNote[]): string {
  if (notes.length === 0) return "# Reviewer change requests\n\nNo notes filed.\n";

  const out: string[] = ["# Reviewer change requests", ""];
  const s = summarise(notes);
  out.push(
    `${s.total} note(s) — ${s.byPriority.blocker} blocker, ${s.byPriority.change} change, ` +
    `${s.byPriority.question} question, ${s.byPriority.idea} idea.`,
    ""
  );

  for (const p of ["blocker", "change", "question", "idea"] as NotePriority[]) {
    const group = notes.filter((n) => n.priority === p);
    if (group.length === 0) continue;
    out.push(`## ${PRIORITY_LABEL[p]}`, "");
    for (const n of group) {
      out.push(
        `### ${n.surface} — ${n.category}`,
        "",
        `**Observed:** ${n.observed}`,
        "",
        `**Requested:** ${n.requested}`,
        "",
        `*${n.reviewerName} (${n.reviewerRole}) · ${n.createdAt} · status ${n.status} · ` +
        `policy \`${n.policyVersion ?? "—"}\` · safety config \`${n.configVersion ?? "—"}\`*`,
        ""
      );
    }
  }
  return out.join("\n");
}
