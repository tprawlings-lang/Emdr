// Export as a job (handoff 09 §6, §10 Package 5).
//
// §6: "Export is a job, not a button. Review scope and columns, request,
// progress, ready, download — with authorization rechecked at download and
// expired, failed, and superseded outputs identified. Browser success is not a
// disclosure audit record."
//
// WHAT WAS ALREADY RIGHT, AND IS NOT BEING REBUILT. `createExport` refuses
// without a stated purpose, applies small-cell suppression to the FILE rather
// than the rendering, signs the content, and writes the audit row before
// returning. Those are the disclosure properties and they were the hard part.
//
// WHAT WAS MISSING WAS TIME. Every export row was implicitly "ready, forever":
// a file requested in March read the same as one requested a minute ago, a
// later export of the same filter did not mark the earlier one superseded, and
// a download re-checked nothing — the browser had the bytes, so the browser
// decided. §6's sentence about that is the sharpest in the section: "Browser
// success is not a disclosure audit record."
//
// SO THE LIFECYCLE IS SERVER STATE AND THE DOWNLOAD IS A DECISION. Not a
// progress bar over a synchronous call: the states exist because each one is a
// different answer to "may this person have this file now", and `expired`,
// `failed` and `superseded` are three ways of saying no that a reader must be
// able to tell apart.
//
// AND NO NEW FORMATS. §6: "Add no new export formats during shell work." This
// module changes when a file may be handed over, never what is in it.

import { data } from "../data";
import { audit } from "../audit";

export const EXPORT_STATES = [
  "requested",
  "running",
  "ready",
  "downloaded",
  "failed",
  "expired",
  "superseded",
] as const;
export type ExportState = (typeof EXPORT_STATES)[number];

/** What a reader is told. §6 wants expired, failed and superseded IDENTIFIED —
 *  three different reasons a file is not available, and a single "unavailable"
 *  would make them one. */
export const STATE_LABEL: Record<ExportState, string> = {
  requested: "Requested",
  running: "Preparing",
  ready: "Ready",
  downloaded: "Downloaded",
  failed: "Failed",
  expired: "Expired",
  superseded: "Superseded",
};

export const STATE_NOTE: Record<ExportState, string> = {
  requested: "The request is recorded. Nothing has been generated yet.",
  running: "Being generated. The row exists, so an interrupted run is visible rather than lost.",
  ready: "Generated and signed. Authorization is checked again at download.",
  downloaded: "Handed over at least once. Every download is counted and recorded.",
  failed: "Generation did not complete. Nothing was disclosed.",
  expired: "Past its download window. The record stays; the file does not.",
  superseded: "A later export of the same filter replaced this one. Kept so an old report can be traced.",
};

/** Which states a file may still be handed over from. `downloaded` is here
 *  because a second download of the same disclosure is legitimate — it is
 *  counted, not refused. */
const DOWNLOADABLE: ReadonlySet<ExportState> = new Set<ExportState>(["ready", "downloaded"]);

/** How long a generated export stays downloadable. Short by intent: a
 *  disclosure that can be fetched a year later is a disclosure nobody is
 *  tracking. */
export const DOWNLOAD_WINDOW_HOURS = 72;

export interface DownloadDecision {
  allowed: boolean;
  state: ExportState;
  /** Why not, in the reader's terms. Present exactly when `allowed` is false. */
  reason?: string;
}

interface JobRow {
  id: string;
  tenant_id: string;
  requested_by: string;
  surface: string;
  filter_hash: string;
  state: string;
  expires_at: string | null;
  superseded_by: string | null;
  download_count: number;
  created_at: string;
}

function asState(v: string): ExportState {
  return (EXPORT_STATES as readonly string[]).includes(v) ? (v as ExportState) : "failed";
}

export async function readJob(id: string): Promise<
  | (Omit<JobRow, "state"> & { state: ExportState })
  | null
> {
  const c = await data();
  const row = (await c.get(
    `SELECT id, tenant_id, requested_by, surface, filter_hash, state, expires_at,
            superseded_by, download_count, created_at
       FROM export_jobs WHERE id = ?`,
    [id]
  )) as JobRow | undefined;
  if (!row) return null;
  return { ...row, state: asState(row.state) };
}

/**
 * Whether this person may download this file, now.
 *
 * RECHECKED AT DOWNLOAD, WHICH IS THE WHOLE POINT. Authorization at request
 * time answers "may they ask"; this answers "may they have it", and between
 * the two an account can change tenant, lose a role, or have its access
 * revoked. The state is read fresh from the row rather than passed in, so a
 * caller cannot hand it a stale one.
 *
 * `now` is injectable so expiry is testable without waiting three days. It
 * defaults to the real clock, never the demonstration clock: a demo clock that
 * could un-expire a disclosure would be a governance hole with a friendly name,
 * which is the same reasoning the audit chain uses.
 */
export async function authorizeDownload(args: {
  jobId: string;
  actorId: string;
  actorTenantId: string;
  now?: Date;
}): Promise<DownloadDecision> {
  const job = await readJob(args.jobId);
  if (!job) {
    return { allowed: false, state: "failed", reason: "That export no longer exists." };
  }

  // Tenant first. A file from another organization is not a state question.
  if (job.tenant_id !== args.actorTenantId) {
    await audit({
      actorId: args.actorId, family: "security",
      type: "export_download_refused", target: job.id,
      detail: { refusal: "cross-tenant", surface: job.surface },
    });
    return { allowed: false, state: job.state, reason: "That export belongs to another organization." };
  }

  const now = args.now ?? new Date();
  if (job.expires_at && Date.parse(`${job.expires_at.replace(" ", "T")}Z`) < now.getTime()) {
    // Recorded on the row so the console says "expired" rather than
    // recomputing the comparison every time somebody looks.
    await markState(job.id, "expired", null);
    return {
      allowed: false,
      state: "expired",
      reason: `This export passed its ${DOWNLOAD_WINDOW_HOURS}-hour download window. Request it again.`,
    };
  }

  if (!DOWNLOADABLE.has(job.state)) {
    return {
      allowed: false,
      state: job.state,
      reason:
        job.state === "superseded"
          ? "A later export of the same filter replaced this one."
          : STATE_NOTE[job.state],
    };
  }

  return { allowed: true, state: job.state };
}

/** Hand the file over, and record that it happened.
 *
 *  §6: "Browser success is not a disclosure audit record." So the count moves
 *  and the audit row is written HERE, on the server, before the bytes go — a
 *  download the browser abandoned is still a disclosure that was authorized
 *  and released. */
export async function recordDownload(args: {
  jobId: string;
  actorId: string;
  actorRole: string;
}): Promise<void> {
  const c = await data();
  const at = new Date().toISOString().replace("T", " ").slice(0, 19);
  await c.run(
    `UPDATE export_jobs
        SET state = 'downloaded',
            download_count = download_count + 1,
            last_downloaded_at = ?
      WHERE id = ?`,
    [at, args.jobId]
  );
  const job = await readJob(args.jobId);
  await audit({
    actorId: args.actorId, actorRole: args.actorRole, family: "security",
    type: "export_downloaded", target: args.jobId,
    detail: {
      surface: job?.surface ?? "unknown",
      filterHash: job?.filter_hash ?? "unknown",
      downloadCount: job?.download_count ?? 1,
    },
  });
}

async function markState(id: string, state: ExportState, supersededBy: string | null): Promise<void> {
  const c = await data();
  await c.run(
    "UPDATE export_jobs SET state = ?, superseded_by = ? WHERE id = ?",
    [state, supersededBy, id]
  );
}

/**
 * Mark earlier exports of the same filter superseded.
 *
 * SAME TENANT, SAME SURFACE, SAME FILTER HASH. Not "same surface" alone: two
 * exports of different filters from one screen are two different disclosures
 * and neither replaces the other. The filter hash is what makes them the same
 * question asked twice.
 *
 * DOWNLOADED EXPORTS ARE SUPERSEDED TOO. The file is already out; what changes
 * is what the console says about it, and a downloaded-then-superseded row that
 * still read "Ready" would tell a reviewer the wrong file is current.
 */
export async function supersedeEarlier(args: {
  tenantId: string;
  surface: string;
  filterHash: string;
  newJobId: string;
}): Promise<number> {
  const c = await data();
  const { changes } = await c.run(
    `UPDATE export_jobs
        SET state = 'superseded', superseded_by = ?
      WHERE tenant_id = ? AND surface = ? AND filter_hash = ?
        AND id != ?
        AND state IN ('ready','downloaded')`,
    [args.newJobId, args.tenantId, args.surface, args.filterHash, args.newJobId]
  );
  return changes;
}

/** Stamp a freshly created export with its download window. Called after
 *  `createExport` has written the row. */
export async function openDownloadWindow(jobId: string, now = new Date()): Promise<void> {
  const c = await data();
  const expires = new Date(now.getTime() + DOWNLOAD_WINDOW_HOURS * 3_600_000)
    .toISOString().replace("T", " ").slice(0, 19);
  await c.run(
    "UPDATE export_jobs SET state = 'ready', expires_at = ? WHERE id = ?",
    [expires, jobId]
  );
}

/** Record that generation failed. The row survives: §6 wants a failed output
 *  IDENTIFIED, and a request that vanishes on failure is a request nobody can
 *  ask about. */
export async function markFailed(jobId: string, reason: string): Promise<void> {
  const c = await data();
  await c.run(
    "UPDATE export_jobs SET state = 'failed', failure_reason = ? WHERE id = ?",
    [reason, jobId]
  );
}
