// The support dock (handoff 09 §9, §4.1, §1.6; Package 1).
//
// §9's shape: "Member-only fixed access to Ground, support, and crisis
// resources, independent of gating or tier." Its reason: "Support must never
// depend on payment or module state."
//
// THIS IS THE ONE MODULE IN THE EXPERIENCE LAYER WITH NO CONDITIONAL IN IT.
// §4.1: "Support fixed, high-contrast, keyboard reachable, and independent of
// subscription, tier, gate, or module state." Every route it names renders
// without an account, without a network round-trip and without a working
// database — which is §1's requirement that "grounding and crisis resources
// remain reachable even when a write, subscription, sync, or service fails."
//
// So `supportDock()` takes no arguments. Not a context, not a tier, not a
// capability — nothing that could be false. A function with a parameter is a
// function somebody eventually passes a gate to, and the day that happens is
// the day support becomes something a person can lose by not paying.
//
// §1.6 IS THE OTHER HALF. During an activity, routine navigation is removed and
// the dock stays: "Define an active-session shell carrying Pause, Stop, and Get
// support. Ground remains one direct support action." So the dock has two
// shapes — one for the ordinary day and one for an activity in progress — and
// the support entries are identical in both.
//
// AND RED IS NOT THE SIGNAL. §8.1: "Red is never the dominant signal on a
// member surface, including the crisis screen. High-vibrancy red is processed as
// threat, which is the wrong physiological response to induce in someone who is
// already activated. Member urgency is carried by contrast, placement, direct
// words, and a supportive action." The dock carries no tone field for that
// reason: there is nothing to set it to.
//
// Client-safe: no imports at all.

export interface SupportEntry {
  label: string;
  href: string;
  /** What pressing it does, in the person's words. */
  description: string;
  /** True for the entries that must work with nothing behind them. All of
   *  them, which is the point — the field exists so a reviewer reading this
   *  can see it rather than infer it. */
  survivesEveryFailure: true;
}

/**
 * The three support routes.
 *
 * ORDERED NEAREST-FIRST. Grounding is one press and needs nothing; talking to
 * someone is the human route; the crisis page is the one that names phone and
 * text lines. §4.5's content rule applies to the middle one: "Talk to someone",
 * never "Escalate" — human language on a member surface.
 */
export const SUPPORT_ENTRIES: readonly SupportEntry[] = [
  {
    label: "Ground now",
    href: "/app/ground",
    description: "A short practice that runs in this page. It needs no account and no connection.",
    survivesEveryFailure: true,
  },
  {
    label: "Talk to someone",
    href: "/crisis",
    description: "Phone and text lines, on a page that needs nothing from this system to load.",
    survivesEveryFailure: true,
  },
  {
    label: "See what is working",
    href: "/status/degraded",
    description: "What is available right now, measured rather than asserted.",
    survivesEveryFailure: true,
  },
];

export interface SupportDock {
  entries: readonly SupportEntry[];
  /** Where the dock sits. Fixed in both shapes; the difference is what else is
   *  on screen beside it. */
  placement: "fixed";
  /** §4.1: keyboard reachable. Stated rather than assumed so the component has
   *  something to satisfy. */
  keyboardReachable: true;
  /** Whether routine navigation is on screen alongside. §1.6: removed during
   *  an activity, returns after a safe exit. */
  routineNavigationVisible: boolean;
}

/**
 * The dock for an ordinary day.
 *
 * NO PARAMETERS. See the header — a parameter is a thing somebody eventually
 * passes a gate to.
 */
export function supportDock(): SupportDock {
  return {
    entries: SUPPORT_ENTRIES,
    placement: "fixed",
    keyboardReachable: true,
    routineNavigationVisible: true,
  };
}

/** During an activity. §1.6: the same support, and no routine navigation. */
export function activitySupportDock(): SupportDock {
  return {
    entries: SUPPORT_ENTRIES,
    placement: "fixed",
    keyboardReachable: true,
    routineNavigationVisible: false,
  };
}

/** The three controls an activity shell carries beside the dock (§1.6).
 *
 *  Pause and Stop are distinct and §4 says why: "Pause preserves permitted
 *  progress; Stop follows the existing exit and closure rules." A single
 *  "Cancel" makes a person choose between finishing something they cannot
 *  finish and losing what they have done. */
export const ACTIVITY_CONTROLS = [
  {
    label: "Pause",
    description: "Keeps what you have done so far. You can come back to it.",
    /** §4.5: the claim must be true. A surface may only print the "saved" half
     *  once the server has confirmed it. */
    claimsSaved: false,
  },
  {
    label: "Stop",
    description: "Ends this here, and closes it properly.",
    claimsSaved: false,
  },
  {
    label: "Get support",
    description: "Grounding, someone to talk to, and crisis lines.",
    claimsSaved: false,
  },
] as const;
