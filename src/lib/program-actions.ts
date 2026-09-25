"use server";

// Member actions for programs (Handoff 10 §3.2). Thin: every rule lives in
// programs.ts and program-activities.ts, where the tests reach it.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "./auth";
import { enrollInProgram, leaveProgram, ProgramRefused } from "./programs";
import { ActivityRefused, deleteActivityEntry, saveActivityEntry, type ActivityPayload } from "./program-activities";

const safeId = (v: FormDataEntryValue | null) => String(v ?? "").replace(/[^a-z0-9-]/g, "").slice(0, 60);

export async function joinProgramAction(formData: FormData) {
  const user = await requireMember();
  const programId = safeId(formData.get("programId"));
  try {
    await enrollInProgram(user.id, programId);
  } catch (e) {
    if (e instanceof ProgramRefused) redirect("/app/programs");
    throw e;
  }
  revalidatePath("/app/programs");
  redirect(`/app/programs/${programId}`);
}

export async function leaveProgramAction(formData: FormData) {
  const user = await requireMember();
  const programId = safeId(formData.get("programId"));
  await leaveProgram(user.id, programId);
  revalidatePath("/app/programs");
  redirect("/app/programs");
}

function parse(formData: FormData): ActivityPayload | null {
  const kind = String(formData.get("kind") ?? "");
  const text = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() ? v : undefined;
  };
  const num = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && /^(10|[0-9])$/.test(v) ? Number(v) : undefined;
  };
  if (kind === "values-pick") {
    return { kind, areas: formData.getAll("area").map(String), other: text("other") };
  }
  if (kind === "activity-plan") {
    const items: Array<{ text: string; own?: boolean; day?: string }> = formData.getAll("item").map((v) => {
      const t = String(v);
      return { text: t, day: text(`day:${t}`) };
    });
    const own = text("own");
    if (own) items.push({ text: own, own: true, day: text("day:own") });
    return { kind, items, remember: text("remember") };
  }
  if (kind === "activity-reflect") {
    const outcome = String(formData.get("outcome") ?? "") as "did" | "partly" | "not";
    const choice = text("notThisTime") as "smaller" | "keep" | "skip" | undefined;
    return {
      kind, planItem: String(formData.get("planItem") ?? ""), outcome,
      mastery: num("mastery"), enjoyment: num("enjoyment"), noticed: text("noticed"), notThisTime: choice,
    };
  }
  return null;
}

export async function saveActivityAction(formData: FormData) {
  const user = await requireMember();
  const programId = safeId(formData.get("programId"));
  const unitId = safeId(formData.get("unitId"));
  const here = `/app/programs/${programId}/${unitId}`;
  const payload = parse(formData);
  if (!payload) redirect(`${here}/activity?error=1`);
  let result: Awaited<ReturnType<typeof saveActivityEntry>>;
  try {
    result = await saveActivityEntry(user.id, programId, unitId, payload);
  } catch (e) {
    if (e instanceof ActivityRefused) redirect(`${here}/activity?error=${e.code}`);
    if (e instanceof ProgramRefused) redirect(here);
    throw e;
  }
  // The crisis pre-filter matched: nothing was saved (§3.4).
  if (!result.ok) redirect("/crisis?from=program");
  revalidatePath(`/app/programs/${programId}`);
  // "Make it smaller" goes straight back to the menu to pick a smaller step.
  if (payload.kind === "activity-reflect" && payload.notThisTime === "smaller") {
    redirect(`/app/programs/${programId}/a-short-menu/activity`);
  }
  redirect(`${here}?saved=1`);
}

export async function deleteActivityAction(formData: FormData) {
  const user = await requireMember();
  const programId = safeId(formData.get("programId"));
  const unitId = safeId(formData.get("unitId"));
  await deleteActivityEntry(user.id, String(formData.get("entryId") ?? "").slice(0, 40));
  revalidatePath(`/app/programs/${programId}/${unitId}`);
  redirect(`/app/programs/${programId}/${unitId}`);
}
