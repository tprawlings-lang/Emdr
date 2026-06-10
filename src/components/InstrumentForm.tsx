import { Instrument } from "@/lib/instruments";
import { submitScreening } from "@/lib/actions";

// Shared questionnaire form used by baseline screening and weekly measures.
export default function InstrumentForm({
  instrument,
  context,
}: {
  instrument: Instrument;
  context: "baseline" | "weekly";
}) {
  return (
    <form action={submitScreening} className="mt-8 space-y-6">
      <input type="hidden" name="instrument" value={instrument.id} />
      <input type="hidden" name="context" value={context} />
      {instrument.items.map((item, i) => {
        const section = instrument.sections?.find((s) => s.startIndex === i);
        return (
          <div key={i}>
            {section && (
              <h2 className="mb-3 mt-8 font-serif text-xl font-medium">{section.heading}</h2>
            )}
            <fieldset className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <legend className="px-1 text-sm font-medium">
                {i + 1}. {item}
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {instrument.options.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 rounded-full border border-ground/15 bg-ivory px-4 py-2 text-sm transition-colors hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold"
                  >
                    <input
                      type="radio"
                      name={`item-${i}`}
                      value={opt.value}
                      required
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        );
      })}
      <button
        type="submit"
        className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
      >
        Save and continue
      </button>
    </form>
  );
}
