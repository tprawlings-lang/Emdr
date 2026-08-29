"use server";

// Server actions for the review gateway (Redesign handoff §12).
//
// The gateway never displays a credential. A reviewer supplies a code they were
// given privately, chooses a fabricated persona within the scope of their review
// path, and is signed in server-side. No password is typed, shown, or stored in
// the browser, so there is nothing on any page for a third party to reuse.

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { data } from "../data";
import { setSessionCookie } from "../auth";
import { audit } from "../audit";
import { verifyAccessCode, reviewPath, personasFor, gatewayConfigured } from "./review-access";

const GRANT_COOKIE = "steady_review_path";

export async function enterReviewAction(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const path = String(formData.get("path") ?? "");

  if (!gatewayConfigured()) {
    // Unset configuration means closed, never open.
    redirect("/demo?error=unavailable");
  }
  const cfg = reviewPath(path);
  if (!cfg) redirect("/demo?error=path");

  if (!verifyAccessCode(code)) {
    // Deliberately not distinguished from an unknown path: a reviewer who
    // mistypes learns only that it did not work.
    await audit({ family: "security", type: "review_access_denied", detail: { path } });
    redirect(`/demo?error=denied&path=${path}`);
  }

  const store = await cookies();
  store.set(GRANT_COOKIE, cfg!.id, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 8,
  });
  await audit({ family: "security", type: "review_access_granted", detail: { path: cfg!.id } });
  redirect(`/demo/${cfg!.id}`);
}

export async function enterPersonaAction(formData: FormData) {
  const path = String(formData.get("path") ?? "");
  const email = String(formData.get("email") ?? "");

  const store = await cookies();
  const granted = store.get(GRANT_COOKIE)?.value;
  const cfg = reviewPath(path);
  // The grant, not the form, decides which path is being entered.
  if (!cfg || granted !== cfg.id) redirect("/demo?error=denied");

  // Scope is enforced server-side: a read-only path cannot reach a
  // write-capable persona by posting a different email.
  const allowed = personasFor(cfg).some((p) => p.email === email);
  if (!allowed) {
    await audit({ family: "security", type: "review_persona_refused", detail: { path, email } });
    redirect(`/demo/${cfg.id}?error=scope`);
  }

  const c = await data();
  const user = (await c.get(
    "SELECT id, role FROM users WHERE email = ? AND status = 'active'", [email]
  )) as { id: string; role: string } | undefined;
  if (!user) redirect(`/demo/${cfg.id}?error=persona`);

  await setSessionCookie(user.id);
  await audit({
    actorId: user.id, actorRole: user.role as "member" | "clinician",
    family: "security", type: "review_persona_entered", detail: { path: cfg.id },
  });
  redirect(user.role === "clinician" ? "/clinician/caseload" : "/app/today");
}
