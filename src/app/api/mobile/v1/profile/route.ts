import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import {
  profileCatalog, saveSupportMobile, saveTraumaMobile, saveTriggersMobile,
  saveWarningSignsMobile, saveReadinessMobile, saveSafetyPlanMobile,
  saveCompanionMobile, completeProfileMobile, saveCalmPlaceMobile, savedProfileMobile,
} from "@/lib/mobile/onboarding";

export const runtime = "nodejs";

// GET → the option catalog plus the member's saved values (for resume-edit).
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json({ ...profileCatalog(), saved: await savedProfileMobile(auth.id) });
}

// POST { step, ...payload } — one endpoint dispatching the 8 profile steps.
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  const step = String(b.step ?? "");
  const uid = auth.id;

  switch (step) {
    case "support":
      await saveSupportMobile(uid, {
        therapistStatus: b.therapistStatus as string, emdrExperience: b.emdrExperience as string,
        goals: (b.goals as string[]) ?? [],
      });
      return json({ ok: true });
    case "trauma":
      await saveTraumaMobile(uid, { areas: (b.areas as string[]) ?? [], restrictedTopics: (b.restrictedTopics as string[]) ?? [] });
      return json({ ok: true });
    case "triggers":
      await saveTriggersMobile(uid, { triggers: (b.triggers as never[]) ?? [] });
      return json({ ok: true });
    case "warning-signs":
      await saveWarningSignsMobile(uid, (b.signs as string[]) ?? []);
      return json({ ok: true });
    case "readiness": {
      const r = await saveReadinessMobile(uid, b as never);
      return json(r);
    }
    case "safety-plan":
      await saveSafetyPlanMobile(uid, b as never);
      return json({ ok: true });
    case "companion":
      await saveCompanionMobile(uid, b as never);
      return json({ ok: true });
    case "calm-place":
      await saveCalmPlaceMobile(uid, String(b.calmPlace ?? ""));
      return json({ ok: true });
    case "complete":
      await completeProfileMobile(uid);
      return json({ ok: true });
    default:
      return error("Unknown profile step.", 400);
  }
}
