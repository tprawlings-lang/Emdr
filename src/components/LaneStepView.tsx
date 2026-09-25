import type { LaneStep } from "@/lib/content/h10-assigned-lane";

// One step of a clinician-assigned practice. The member's run and the
// clinician's preview render THIS component, so the preview is what the
// member sees (Handoff 03 §4: "The clinician must preview exactly what the
// patient will see"). In the preview the boxes are drawn but disabled.

const box = "mt-2 w-full rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-ground";

export function LaneStepView({ step, preview = false }: { step: LaneStep; preview?: boolean }) {
  if (step.kind === "read") return <p className="measure whitespace-pre-line text-ground/90">{step.body}</p>;
  if (step.kind === "write") {
    return (
      <label className="block">
        <span className="measure block text-ground">{step.prompt}</span>
        <textarea name="text" rows={10} maxLength={20000} disabled={preview} className={box} />
      </label>
    );
  }
  return (
    <fieldset>
      <legend className="measure text-ground">{step.prompt}</legend>
      <div className="mt-3 space-y-3">
        {step.fields.map((f) => (
          <label key={f.id} className="block">
            <span className="text-sm text-olive">{f.label}</span>
            <textarea name={`f:${f.id}`} rows={3} maxLength={2000} disabled={preview} className={box} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
