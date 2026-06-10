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
              <h2 className="mb-3 mt-8 font-semibold text-stone-800">{section.heading}</h2>
            )}
            <fieldset className="rounded-lg border border-stone-200 bg-white p-4">
              <legend className="px-1 text-sm font-medium text-stone-800">
                {i + 1}. {item}
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {instrument.options.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 has-checked:border-stone-900 has-checked:bg-stone-900 has-checked:text-white"
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
        className="w-full rounded-lg bg-stone-900 px-6 py-3 font-medium text-white hover:bg-stone-700"
      >
        Submit and continue
      </button>
    </form>
  );
}
