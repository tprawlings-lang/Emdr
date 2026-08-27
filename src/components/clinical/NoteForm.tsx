import { fileNoteAction } from "@/lib/clinical/actions";
import { CATEGORIES, SURFACES, PRIORITY_LABEL, type NotePriority } from "@/lib/clinical/review-notes";

// "Change this" — available on every clinician surface.
//
// Collapsed by default so it does not compete with the work, and one click from
// open on every screen so a reviewer never has to leave what they are looking at
// to record what they think about it. The friction between noticing something
// and writing it down is where most review feedback is lost.

const PRIORITIES: NotePriority[] = ["blocker", "change", "question", "idea"];

export function NoteForm({
  surface, returnTo, subjectId, defaultCategory,
}: {
  surface: string;
  returnTo: string;
  subjectId?: string;
  defaultCategory?: string;
}) {
  return (
    <details data-testid="note-form" className="mt-6 rounded-2xl border border-ground/15 bg-linen/40 px-5 py-4">
      <summary className="cursor-pointer text-sm font-medium text-ground">
        Something you would change here?
      </summary>
      <p className="mt-2 text-xs text-olive">
        Goes straight to the build list with the configuration you were looking at
        attached — you do not need to note which policy mode was active.
      </p>

      <form action={fileNoteAction} className="mt-3 space-y-3">
        <input type="hidden" name="surface" value={surface} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {subjectId && <input type="hidden" name="subjectId" value={subjectId} />}

        <div className="flex flex-wrap gap-3">
          <label className="text-xs text-ground">
            <span className="block text-olive">Category</span>
            <select
              name="category" defaultValue={defaultCategory ?? "Workflow fit"}
              className="mt-1 rounded border border-ground/20 bg-ivory px-2 py-1 text-xs"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs text-ground">
            <span className="block text-olive">How urgent — your call</span>
            <select
              name="priority" defaultValue="change"
              className="mt-1 rounded border border-ground/20 bg-ivory px-2 py-1 text-xs"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Two fields, not one. The gap between what someone saw and what they
            want instead is usually where the real disagreement is. */}
        <label className="block text-xs text-ground">
          <span className="block text-olive">What you saw</span>
          <textarea
            name="observed" required rows={2}
            className="mt-1 w-full rounded border border-ground/20 bg-ivory px-2 py-1 text-xs"
            placeholder="The alert deadline was 4 hours for a high-band alert raised on a Friday evening."
          />
        </label>
        <label className="block text-xs text-ground">
          <span className="block text-olive">What you want instead</span>
          <textarea
            name="requested" required rows={2}
            className="mt-1 w-full rounded border border-ground/20 bg-ivory px-2 py-1 text-xs"
            placeholder="Out-of-hours high-band alerts should carry the next-business-day deadline, not a clock deadline."
          />
        </label>

        <button className="rounded-full bg-ground px-4 py-1.5 text-xs font-medium text-ivory">
          File change request
        </button>
      </form>
    </details>
  );
}

/** Surface names, re-exported so a page cannot invent one that the testing
 *  console then fails to group. */
export { SURFACES };
