import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { memberThoughtRecords, saveThoughtRecord, thoughtRecordStanding, ThoughtRecordRefused } from "@/lib/thought-records";
import { THOUGHT_RECORD } from "@/lib/content/h10-thought-record";

export const runtime = "nodejs";

// Handoff 10 2B: the member's own thought records. The same functions the web
// uses; the member's words come back only to the member.

// GET /api/mobile/v1/thought-records → { state, copy, records }
//   state: "open" | "not_today"; 404 while the content is not signed.
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const standing = await thoughtRecordStanding(auth.id);
  if (standing.state === "absent") return error("Not found.", 404);
  const t = THOUGHT_RECORD;
  return json({
    state: standing.state,
    pendingClinicalReview: standing.visibility === "draft",
    copy: {
      title: t.title, intro: t.intro, steps: t.steps, strengthQuestion: t.strengthQuestion, save: t.save, stop: t.stop,
      privacy: t.privacy, strongAt: t.strongAt, strong: t.strong, strongGround: t.strongGround,
      strongContinue: t.strongContinue, groundSkillId: t.groundSkillId,
    },
    records: await memberThoughtRecords(auth.id),
  });
}

// POST /api/mobile/v1/thought-records { situation, feeling?, strengthBefore?, thought?, supports?, against?, balanced?, strengthAfter? }
//   201 { id }
//   409 { crisis: true }        the crisis pre-filter matched; NOTHING was saved
//   422 { error: code }         "not_today" | "write_something"
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  if (!b || typeof b !== "object") return error("Invalid JSON body.", 400);
  try {
    const r = await saveThoughtRecord(auth.id, b);
    if (!r.ok) return json({ crisis: true }, 409);
    return json({ id: r.id }, 201);
  } catch (e) {
    if (e instanceof ThoughtRecordRefused) return e.code === "absent" ? error("Not found.", 404) : json({ error: e.code }, 422);
    throw e;
  }
}
