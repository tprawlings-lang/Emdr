"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireUser } from "../auth";
import { audit } from "../audit";
import { scenario } from "./scenario-registry";
import {
  begin, transition, resumable, type ScenarioProgress, type Transition,
} from "../experience/scenario";
import { environmentStatus, meetsRequirements } from "./preflight";
import { acquireLock, releaseLock } from "./environment-lock";
import { getDb } from "../db";

// Running a walkthrough (handoff 09 §7.2, §7.3; Package 4).
//
// PROGRESS LIVES IN A COOKIE, and that is a deliberate choice rather than a
// shortcut. A walkthrough is a presenter's position in a story — it is not
// clinical state, it belongs to one person at one keyboard, and it must not
// survive into somebody else's session. A table would make it durable, shared
// and resettable, which are three properties it should not have. §9's view
// state rule says the same thing from the other direction: presentation
// position is stored apart from anything clinical.
//
// THE ENVIRONMENT LOCK IS THE PART THAT IS NOT PRESENTATION. Starting a
// walkthrough takes the environment (§7.3), and that is shared state a second
// operator has to be able to see, so it lives in a table.
//
// EVERY ADVANCE RE-READS PREFLIGHT. §7.3's "a reset failure never displays
// ready" is not only about the admin console: a walkthrough that keeps
// advancing into screens after the environment stopped being fit is the same
// failure reaching an audience instead of an operator. The environment can
// change under a running walkthrough — somebody else can interrupt and reset —
// so the check is per-transition rather than at the start.

const PROGRESS_COOKIE = "steady_walkthrough";

export interface WalkthroughState {
  progress: ScenarioProgress | null;
  /** Why there is no progress, when a stored walkthrough was refused. */
  refusal: string | null;
}

/** Read the presenter's position, refusing one that no longer fits its story. */
export async function readWalkthrough(): Promise<WalkthroughState> {
  const raw = (await cookies()).get(PROGRESS_COOKIE)?.value;
  if (!raw) return { progress: null, refusal: null };

  let parsed: ScenarioProgress;
  try {
    parsed = JSON.parse(raw) as ScenarioProgress;
  } catch {
    return { progress: null, refusal: null };
  }
  const s = scenario(parsed.scenarioId);
  if (!s) return { progress: null, refusal: "That story is no longer registered." };

  // §7.2: claims and limitations stay attached to the scenario version, so a
  // walkthrough that began under a different one is refused rather than
  // migrated into a story whose claims changed while it was running.
  const check = resumable(s, parsed);
  if (!check.ok) return { progress: null, refusal: check.reason ?? "That walkthrough cannot be resumed." };

  return { progress: parsed, refusal: null };
}

async function writeWalkthrough(progress: ScenarioProgress | null): Promise<void> {
  const store = await cookies();
  if (!progress) {
    store.delete(PROGRESS_COOKIE);
    return;
  }
  store.set(PROGRESS_COOKIE, JSON.stringify(progress), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 4,
  });
}

/** Start a story. Takes the environment lock and refuses on a failed preflight. */
export async function startWalkthrough(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("scenario") ?? "");
  const s = scenario(id);
  if (!s) return;

  // A blocked environment does not start a walkthrough. §7.3's rule, applied
  // at the only moment where refusing it costs nothing.
  const status = environmentStatus(getDb());
  const met = meetsRequirements(status, s.requires);
  if (!met.ready) {
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "walkthrough_refused", target: s.id,
      detail: {
        reason: "preflight",
        missing: met.missing.map((c) => c.id),
        unknown: met.unknown,
      },
    });
    revalidatePath("/demo/scenarios");
    return;
  }

  const lock = acquireLock({
    scenarioId: s.id,
    scenarioVersion: s.version,
    personId: user.id,
    personName: user.name ?? null,
  });
  if (!lock.ok) {
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "walkthrough_refused", target: s.id,
      detail: { reason: "environment held", heldBy: lock.lock?.heldBy ?? null },
    });
    revalidatePath("/demo/scenarios");
    return;
  }

  await writeWalkthrough(begin(s, new Date().toISOString()));
  await audit({
    actorId: user.id, actorRole: user.role, family: "security",
    type: "walkthrough_started", target: s.id,
    detail: { version: s.version, audience: s.audience },
  });
  revalidatePath("/demo/scenarios");
}

/** Move within a story. Every transition goes through the pure rule. */
export async function moveWalkthrough(formData: FormData): Promise<void> {
  const user = await requireUser();
  const to = String(formData.get("to") ?? "") as Transition;
  const { progress } = await readWalkthrough();
  if (!progress) return;
  const s = scenario(progress.scenarioId);
  if (!s) return;

  if (to === "exit") {
    releaseLock("Walkthrough ended by the presenter.");
    await writeWalkthrough(null);
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "walkthrough_ended", target: s.id,
      detail: { at: progress.index },
    });
    revalidatePath("/demo/scenarios");
    return;
  }

  // Re-read, per the header: the environment can stop being fit under a
  // running walkthrough, and advancing anyway puts a broken screen in front of
  // an audience.
  const status = environmentStatus(getDb());
  const ready = meetsRequirements(status, s.requires).ready;

  const result = transition(s, progress, to, ready);
  if (!result.allowed) {
    revalidatePath("/demo/scenarios");
    return;
  }
  await writeWalkthrough(result.next);
  revalidatePath("/demo/scenarios");
}
