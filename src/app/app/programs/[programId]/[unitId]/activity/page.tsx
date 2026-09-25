import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { menuFor, openUnit } from "@/lib/programs";
import { plannedItems, reflectOptions, REFUSAL_WORDS, type RefusalCode } from "@/lib/program-activities";
import { getPractice, practiceGateFor } from "@/lib/practices";
import { saveActivityAction } from "@/lib/program-actions";
import { SubmitButton } from "@/components/experience/SubmitButton";
import ReflectForm from "@/components/ReflectForm";

// A unit's activity (Handoff 10 §3.2). The words are the signed pack's
// (content/h10-programs.ts); the menu is the one today's gate allows. What is
// written here goes through the crisis pre-filter before it is saved.
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function DaySelect({ name }: { name: string }) {
  return (
    <select name={name} aria-label="Day" defaultValue="" className="min-h-11 rounded-xl border border-ground/15 bg-app-surface px-2 text-sm text-ground">
      <option value="">Any day</option>
      {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
    </select>
  );
}

export default async function ActivityPage({
  params, searchParams,
}: {
  params: Promise<{ programId: string; unitId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireMember();
  const { programId, unitId } = await params;
  const { error } = await searchParams;
  const opened = await openUnit(user.id, programId, unitId);
  if (!opened.ok) {
    if (opened.reason === "absent") notFound();
    redirect(`/app/programs/${programId}/${unitId}`);
  }
  const u = opened.unit.unit;
  const copy = u.copy;
  if (!copy || u.activity === "none") notFound();
  const unitHref = `/app/programs/${programId}/${unitId}`;
  const hidden = (
    <>
      <input type="hidden" name="kind" value={u.activity} />
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="unitId" value={unitId} />
    </>
  );
  const box = "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-ground/10 bg-linen px-4 py-2 has-checked:border-clay has-checked:bg-clay/40";

  let body: React.ReactNode;
  if (u.activity === "values-pick") {
    const other = (copy.options ?? []).find((o) => o.endsWith(": ____"));
    body = (
      <form action={saveActivityAction} className="mt-6">
        {hidden}
        <fieldset>
          <legend className="font-medium text-ground">{copy.prompt}</legend>
          <div className="mt-3 space-y-2">
            {(copy.options ?? []).filter((o) => o !== other).map((o) => (
              <label key={o} className={box}><input type="checkbox" name="area" value={o} /><span className="text-ground">{o}</span></label>
            ))}
          </div>
          {other && (
            <label className="mt-3 block">
              <span className="text-ground">{other.replace(": ____", "")}</span>
              <input name="other" maxLength={120} className="mt-2 w-full rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-ground" />
            </label>
          )}
        </fieldset>
        <SubmitButton pendingLabel="Saving…" className="mt-6 rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">Save</SubmitButton>
      </form>
    );
  } else if (u.activity === "activity-plan") {
    const menu = menuFor(copy.categories ?? [], await practiceGateFor(user.id));
    body = (
      <form action={saveActivityAction} className="mt-6">
        {hidden}
        <p className="font-medium text-ground">{copy.prompt}</p>
        {copy.dayPrompt && <p className="mt-1 text-sm text-olive">{copy.dayPrompt}</p>}
        {menu.map((c) => (
          <fieldset key={c.name} className="mt-5">
            <legend className="text-sm font-semibold text-ground">{c.name}</legend>
            <div className="mt-2 space-y-2">
              {c.items.map((item) => (
                <div key={item} className="flex flex-wrap items-center gap-2">
                  <label className={`${box} flex-1`}><input type="checkbox" name="item" value={item} /><span className="text-ground">{item}</span></label>
                  <DaySelect name={`day:${item}`} />
                </div>
              ))}
            </div>
          </fieldset>
        ))}
        <label className="mt-5 block">
          <span className="text-sm font-semibold text-ground">Your own</span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input name="own" maxLength={120} className="min-h-11 flex-1 rounded-2xl border border-ground/15 bg-app-surface px-4 text-ground" />
            <DaySelect name="day:own" />
          </div>
        </label>
        {copy.remember && (
          <label className="mt-6 block">
            <span className="font-medium text-ground">{copy.remember} <span className="text-sm font-normal text-olive">Optional</span></span>
            <textarea name="remember" rows={2} maxLength={500} className="mt-2 w-full rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-ground" />
          </label>
        )}
        <SubmitButton pendingLabel="Saving…" className="mt-6 rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">
          {copy.save ?? "Save"}
        </SubmitButton>
      </form>
    );
  } else if (u.activity === "activity-reflect") {
    const planned = await plannedItems(user.id, programId);
    body = planned.length === 0 ? (
      <p className="measure mt-6 text-ground/90">
        This one looks back at your plan, and there isn&apos;t one yet.{" "}
        <Link href={`/app/programs/${programId}/a-short-menu/activity`} className="underline">Make a plan first</Link>.
      </p>
    ) : (
      <ReflectForm
        programId={programId} unitId={unitId} planned={planned}
        copy={{
          prompt: copy.prompt, outcomes: copy.outcomes ?? [], mastery: copy.mastery ?? "", enjoyment: copy.enjoyment ?? "",
          noticed: copy.noticed ?? "", notThisTime: copy.notThisTime ?? "", notThisTimeChoices: copy.notThisTimeChoices ?? [],
        }}
      />
    );
  } else if (u.activity === "wind-down-plan") {
    const own = (copy.options ?? []).find((o) => o.endsWith(": ____"));
    body = (
      <form action={saveActivityAction} className="mt-6">
        {hidden}
        <fieldset>
          <legend className="font-medium text-ground">{copy.prompt}</legend>
          <div className="mt-3 space-y-2">
            {(copy.options ?? []).filter((o) => o !== own).map((o) => (
              <label key={o} className={box}><input type="checkbox" name="pick" value={o} /><span className="text-ground">{o}</span></label>
            ))}
          </div>
          {own && (
            <label className="mt-3 block">
              <span className="text-ground">{own.replace(": ____", "")}</span>
              <input name="own" maxLength={120} className="mt-2 w-full rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-ground" />
            </label>
          )}
        </fieldset>
        <SubmitButton pendingLabel="Saving…" className="mt-6 rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">Save</SubmitButton>
      </form>
    );
  } else if (u.activity === "sleep-window") {
    // The getting-up time only. No bedtime field, and nothing is worked out
    // from this time (CV10_C03).
    body = (
      <form action={saveActivityAction} className="mt-6">
        {hidden}
        <label className="block">
          <span className="font-medium text-ground">{copy.prompt}</span>
          <input
            type="time" name="wakeTime" required
            className="mt-3 block min-h-11 rounded-2xl border border-ground/15 bg-app-surface px-4 text-lg text-ground"
          />
        </label>
        {copy.note && <p className="measure mt-3 text-sm text-olive">{copy.note}</p>}
        <SubmitButton pendingLabel="Saving…" className="mt-6 rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">Save</SubmitButton>
      </form>
    );
  } else if (u.activity === "sleep-reflect") {
    const options = await reflectOptions(user.id, programId, unitId);
    body = (
      <form action={saveActivityAction} className="mt-6">
        {hidden}
        <fieldset>
          <legend className="font-medium text-ground">{copy.prompt}</legend>
          <div className="mt-3 space-y-2">
            {options.map((o) => (
              <label key={o} className={box}><input type="checkbox" name="helped" value={o} /><span className="text-ground">{o}</span></label>
            ))}
          </div>
        </fieldset>
        {copy.keepDoing && (
          <label className="mt-6 block">
            <span className="font-medium text-ground">{copy.keepDoing} <span className="text-sm font-normal text-olive">Optional</span></span>
            <textarea name="keepDoing" rows={2} maxLength={500} className="mt-2 w-full rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-ground" />
          </label>
        )}
        <SubmitButton pendingLabel="Saving…" className="mt-6 rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">Save</SubmitButton>
      </form>
    );
  } else if (u.activity === "reflect-text") {
    body = (
      <form action={saveActivityAction} className="mt-6">
        {hidden}
        <label className="block">
          <span className="font-medium text-ground">{copy.prompt}</span>
          <textarea name="text" rows={4} maxLength={500} required className="mt-3 w-full rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-ground" />
        </label>
        {/* The pack's own words for what a member writes (thought records,
            CV10_D04), true here too: entries are never shown to the care team
            or the companion. */}
        <p className="mt-2 text-sm text-olive">Only you can see this. You can delete it any time.</p>
        <SubmitButton pendingLabel="Saving…" className="mt-6 rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">Save</SubmitButton>
      </form>
    );
  } else if (u.activity === "feeling-words") {
    // Typed, not picked: the signed pack names a word list but gives none,
    // and one is not written without review (decision product.feelings-word-list).
    body = (
      <form action={saveActivityAction} className="mt-6">
        {hidden}
        <fieldset>
          <legend className="font-medium text-ground">{copy.prompt}</legend>
          <div className="mt-3 flex flex-wrap gap-3">
            {[0, 1].map((i) => (
              <input
                key={i} name="word" maxLength={40} aria-label={i === 0 ? "First word" : "Second word"} required={i === 0}
                className="min-h-11 w-40 rounded-2xl border border-ground/15 bg-app-surface px-4 text-ground"
              />
            ))}
          </div>
        </fieldset>
        <SubmitButton pendingLabel="Saving…" className="mt-6 rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">Save</SubmitButton>
      </form>
    );
  } else if (u.activity === "skill-pick") {
    const skills = u.practiceIds.flatMap((id) => {
      const p = getPractice(id);
      return p ? [p] : [];
    });
    body = (
      <form action={saveActivityAction} className="mt-6">
        {hidden}
        <fieldset>
          <legend className="font-medium text-ground">{copy.prompt}</legend>
          <div className="mt-3 space-y-2">
            {skills.map((p, i) => (
              <label key={p.id} className={box}>
                <input type="radio" name="practiceId" value={p.id} required defaultChecked={i === 0} />
                <span className="text-ground">{p.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <SubmitButton pendingLabel="Saving…" className="mt-6 rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">Save</SubmitButton>
      </form>
    );
  } else {
    notFound();
  }

  return (
    <MemberPage layer="actions" title={u.title} lede={u.purpose}>
      {error && (
        <p role="alert" className="rounded-2xl border border-state-caution/40 bg-state-caution-bg px-4 py-3 text-sm text-ground">
          {REFUSAL_WORDS[error as RefusalCode] ?? "That didn't come through. Please try again."}
        </p>
      )}
      {body}
      <Link href={unitHref} className="mt-8 inline-flex min-h-11 items-center text-sm text-olive underline">← Back</Link>
    </MemberPage>
  );
}
