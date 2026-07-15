// Brand-built warmth for the marketing page: friendly, human-feeling line
// illustrations and soft organic background shapes, all inline SVG in the
// Steady palette (sage / clay / moss / amber-soft / ground). No photography,
// no external assets — calm by construction, and every decorative element is
// aria-hidden. Motion reuses the breath-paced `animate-breathe` keyframes and
// is disabled under prefers-reduced-motion.

// Soft, out-of-focus organic blobs that sit behind a section to add warmth and
// depth without competing with the copy. Colors are low-opacity brand tones.
export function WarmWash({ className = "" }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`} aria-hidden="true">
      <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-amber-soft/20 blur-3xl" />
      <div className="absolute top-10 right-[-6rem] h-80 w-80 rounded-full bg-sage/25 blur-3xl" />
      <div className="absolute bottom-[-8rem] left-1/3 h-96 w-96 rounded-full bg-clay/15 blur-3xl" />
    </div>
  );
}

// A gentle organic wave to soften the seam between two sections.
export function SoftWave({ className = "", fill = "var(--color-linen)" }: { className?: string; fill?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1440 120"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M0,64 C240,112 480,16 720,40 C960,64 1200,120 1440,72 L1440,120 L0,120 Z"
        fill={fill}
      />
    </svg>
  );
}

// The hero scene: a person sitting calmly in a warm, safe space — a soft
// horizon, a breathing sun, a plant nearby. Warm and human without being
// literal. The sun carries the breath-paced motion.
export function CalmScene({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 400 380"
      role="img"
      aria-label="A person sitting calmly in a warm, quiet space at sunrise"
      focusable="false"
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-moss)" />
          <stop offset="55%" stopColor="var(--color-linen)" />
          <stop offset="100%" stopColor="var(--color-ivory)" />
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-amber-soft)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--color-amber-soft)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="panel">
          <rect x="0" y="0" width="400" height="380" rx="40" />
        </clipPath>
      </defs>

      <g clipPath="url(#panel)">
        {/* Warm sky panel */}
        <rect x="0" y="0" width="400" height="380" fill="url(#sky)" />

        {/* Breathing sun: soft glow + disc, paced like a long exhale */}
        <g
          className="animate-breathe-slow"
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <circle cx="270" cy="130" r="120" fill="url(#glow)" />
        </g>
        <circle cx="270" cy="130" r="46" fill="var(--color-amber-soft)" opacity="0.55" />

        {/* Rolling hills */}
        <path d="M0,300 C120,250 240,300 400,262 L400,380 L0,380 Z" fill="var(--color-sage)" opacity="0.55" />
        <path d="M0,330 C140,296 300,344 400,312 L400,380 L0,380 Z" fill="var(--color-sage-deep)" opacity="0.5" />

        {/* A potted plant, for a lived-in warmth */}
        <g stroke="var(--color-ground)" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.85">
          <path d="M64,300 C58,272 44,262 40,244" />
          <path d="M64,300 C70,276 86,266 92,250" />
          <path d="M64,300 C64,278 64,268 64,250" />
        </g>
        <path d="M48,300 h32 l-5,26 h-22 z" fill="var(--color-clay)" />

        {/* Seated person: simple, calm line-art */}
        <g fill="var(--color-ground)">
          {/* head */}
          <circle cx="210" cy="212" r="24" />
          {/* body / lap as a soft rounded shape */}
          <path
            d="M168,332 C168,286 192,258 210,258 C228,258 252,286 252,332 Z"
            fill="var(--color-mist-deep)"
          />
          {/* resting arms */}
          <path
            d="M176,318 C186,300 200,296 210,300 C220,296 234,300 244,318"
            fill="none"
            stroke="var(--color-ground)"
            strokeWidth="6"
            strokeLinecap="round"
            opacity="0.5"
          />
        </g>
      </g>

      {/* Rounded frame */}
      <rect x="1.5" y="1.5" width="397" height="377" rx="40" fill="none" stroke="var(--color-ground)" strokeOpacity="0.08" strokeWidth="3" />
    </svg>
  );
}

// Small friendly spot illustration: a sprig of leaves, for section accents.
export function LeafSprig({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <g stroke="var(--color-safe-deep)" strokeWidth="2.5" strokeLinecap="round" fill="none">
        <path d="M24,44 C24,30 24,20 24,10" />
        <path d="M24,26 C16,24 12,18 12,10 C20,12 24,18 24,26 Z" fill="var(--color-sage)" fillOpacity="0.5" />
        <path d="M24,34 C32,32 36,26 36,18 C28,20 24,26 24,34 Z" fill="var(--color-moss)" fillOpacity="0.7" />
      </g>
    </svg>
  );
}
