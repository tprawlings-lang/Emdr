// Steady brand mark: a calm horizon line inside a grounded oval — quiet,
// balanced, no trauma symbolism (per brand kit logo direction).
export function SteadyMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" fill="none">
      <ellipse cx="20" cy="20" rx="17" ry="14" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9 22c3.5-3 7.5-3 11 0s7.5 3 11 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Lowercase wordmark with wide spacing, set in the brand serif.
export function Wordmark({ className = "text-3xl" }: { className?: string }) {
  return (
    <span className={`font-serif font-medium lowercase tracking-[0.08em] text-ground ${className}`}>
      steady
    </span>
  );
}
