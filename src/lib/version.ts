// What is actually running here.
//
// THIS EXISTS BECAUSE THE QUESTION WAS UNANSWERABLE. Asked whether a merged
// pull request had reached production, the honest answer was "I cannot tell":
// nothing the deployed app serves says which commit built it. The available
// proxy was comparing hashed asset filenames between two fetches, which is
// wrong in both directions — it changes when nothing meaningful did, and it
// does NOT change for a server-only release, which is exactly the case that
// prompted the question. A server-only change can deploy and leave every byte
// of client output identical.
//
// Three findings in the September handoff are the same gap wearing different
// clothes: a demo clock reading a date the code cannot produce, live routes
// differing from the inspected source, and a release checklist whose first
// task is "identify the deployed commit". None of them are answerable without
// this, and every verification claim downstream inherits the doubt.
//
// IT REPORTS WHAT IT KNOWS AND SAYS WHEN IT DOES NOT. A version endpoint that
// invents a plausible commit is worse than none: it converts "I don't know"
// into a confident wrong answer, which is the failure this codebase names
// everywhere else — an absent value rendered as a reassuring one. So every
// field below is nullable, `detail` explains any null in a sentence, and
// nothing is inferred from anything else.
//
// NO SECRETS AND NO MEMBER DATA. It carries a commit, a branch, a build time,
// the dataset versions and two booleans. The booleans reveal nothing new:
// whether enrollment is open is already visible to anyone who loads /signup,
// and whether this is a demo environment is stamped across every page.

import { DEMO_SEED_VERSION } from "./demo-seed";
import { DATASET_VERSION } from "./demo-population-manifest";

/**
 * When this process began, derived from the process's own age.
 *
 * IT USED TO BE `new Date().toISOString()` AT MODULE LOAD, on the reasoning
 * that module load is close enough to process start. It is not, and production
 * said so: the first response after this endpoint shipped reported
 * `startedAt` ten seconds earlier than the request, beside an
 * `uptimeSeconds` of 3,396. A standalone Next server loads a route's modules
 * the first time that route is asked for, so "module load" is the first
 * request to /api/version — which for a page nobody visits can be hours after
 * the process started.
 *
 * The damage was in the field whose whole job is to tell a redeploy from a
 * restart. It was stable per process, so polling it twice looked right; it
 * was simply the wrong moment, and it disagreed with the uptime beside it by
 * fifty-seven minutes.
 *
 * Deriving it from `process.uptime()` makes the two consistent by
 * construction rather than by both being computed correctly.
 */
export function startedAtFrom(uptimeSeconds: number, nowMs: number): string {
  return new Date(nowMs - uptimeSeconds * 1000).toISOString();
}

export interface VersionReport {
  /** The commit this build came from, or null when nothing reported one. */
  commit: string | null;
  /** Short form, for reading aloud and for comparing against `git log`. */
  commitShort: string | null;
  branch: string | null;
  /** When the image was built, if the build recorded it. */
  builtAt: string | null;
  /** When THIS process started. A redeploy moves it; a page refresh does not. */
  startedAt: string;
  uptimeSeconds: number;
  /** Where the commit came from, so a reader can weigh it. */
  source: "platform" | "build" | "none";
  environment: {
    demo: boolean;
    nodeEnv: string;
    enrollmentOpen: boolean;
  };
  data: {
    seedVersion: string;
    datasetVersion: string;
  };
  /** A sentence a person can act on, especially when `commit` is null. */
  detail: string;
}

export function versionReport(
  /** The process clock, injectable so a test can create the divergence this
   *  field exists to avoid. A test process is seconds old, so with the real
   *  clock every wrong answer — module load, "now", a hardcoded zero — is
   *  within a second of the right one and no assertion can separate them. */
  clock: { uptimeSeconds?: number; nowMs?: number } = {}
): VersionReport {
  const uptime = clock.uptimeSeconds ?? process.uptime();
  const nowMs = clock.nowMs ?? Date.now();
  // PLATFORM FIRST, BUILD SECOND. Render sets RENDER_GIT_COMMIT on the running
  // service; the build args are the fallback for anywhere it does not (a plain
  // `docker run`, another host). They are read in that order rather than
  // merged, so `source` can say which one answered.
  const platform = process.env.RENDER_GIT_COMMIT?.trim() || null;
  const baked = process.env.EMDR_BUILD_COMMIT?.trim() || null;
  const commit = platform ?? baked;
  const source: VersionReport["source"] = platform ? "platform" : baked ? "build" : "none";

  const detail =
    commit === null
      ? "No commit was reported by the platform or baked at build time, so this build cannot be " +
        "identified. On Render this means RENDER_GIT_COMMIT is unset; elsewhere, pass " +
        "EMDR_BUILD_COMMIT as a build argument. startedAt still distinguishes a redeploy from a restart."
      : source === "platform"
        ? "Reported by the hosting platform for the running service."
        : "Baked in at build time; the platform did not report a commit.";

  return {
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    branch: process.env.RENDER_GIT_BRANCH?.trim() || process.env.EMDR_BUILD_BRANCH?.trim() || null,
    builtAt: process.env.EMDR_BUILD_TIME?.trim() || null,
    startedAt: startedAtFrom(uptime, nowMs),
    uptimeSeconds: Math.round(uptime),
    source,
    environment: {
      demo: process.env.EMDR_DEMO === "1",
      nodeEnv: process.env.NODE_ENV ?? "unknown",
      // A BOOLEAN, NEVER THE CODE. The code is the gate; its presence is
      // already public the moment /signup renders a form instead of a refusal.
      enrollmentOpen: Boolean(process.env.EMDR_ENROLLMENT_CODE),
    },
    data: {
      seedVersion: DEMO_SEED_VERSION,
      datasetVersion: DATASET_VERSION,
    },
    detail,
  };
}
