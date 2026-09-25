"use server";

// Member actions for thought records (Handoff 10 2B). Thin: every rule is in
// thought-records.ts, where the tests reach it.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "./auth";
import { deleteThoughtRecord, saveThoughtRecord, ThoughtRecordRefused } from "./thought-records";

const HERE = "/app/activities/thoughts";

export async function saveThoughtRecordAction(formData: FormData) {
  const user = await requireMember();
  const text = (k: string) => String(formData.get(k) ?? "");
  const num = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && /^(10|[0-9])$/.test(v) ? Number(v) : undefined;
  };
  let result: Awaited<ReturnType<typeof saveThoughtRecord>>;
  try {
    result = await saveThoughtRecord(user.id, {
      situation: text("situation"), feeling: text("feeling"), strengthBefore: num("strengthBefore"),
      thought: text("thought"), supports: text("supports"), against: text("against"),
      balanced: text("balanced"), strengthAfter: num("strengthAfter"),
    });
  } catch (e) {
    if (e instanceof ThoughtRecordRefused) redirect(e.code === "write_something" ? `${HERE}/new?error=1` : HERE);
    throw e;
  }
  // The crisis pre-filter matched: nothing was saved.
  if (!result.ok) redirect("/crisis?from=thought-record");
  revalidatePath(HERE);
  redirect(`${HERE}?saved=1`);
}

export async function deleteThoughtRecordAction(formData: FormData) {
  const user = await requireMember();
  await deleteThoughtRecord(user.id, String(formData.get("id") ?? "").slice(0, 40));
  revalidatePath(HERE);
  redirect(HERE);
}
