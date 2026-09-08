// The evidence panel contract (handoff 09 §1.4, §9, §8.6; Package 1).
//
// §1.4's ruling settles a real disagreement between the two source documents.
// Handoff 08 §10.4 required ALL drawers to trap focus; the Astra review noted
// that desktop non-modal evidence panels should allow continued comparison
// against the list. Handoff 09 rules for Astra:
//
//   "Trap focus in modal dialogs only. Inline and non-modal desktop panels get
//    a labeled region, an optional close control, and a documented focus-return
//    target."
//
// AND THE REASON IS A CLINICAL ONE, not an accessibility technicality. The
// whole job of an evidence panel is to let somebody read the evidence WHILE
// looking at the row it belongs to. A trapped focus makes that impossible: the
// reader must close the panel to look at the list, which means comparing from
// memory. A drawer that traps focus is a drawer that turns a comparison into a
// recollection.
//
// SO THE MODE IS A REQUIRED FIELD AND THE FOCUS BEHAVIOUR IS DERIVED FROM IT.
// There is no `trapFocus` boolean a caller can set: `focusBehaviour` below is a
// function of the mode, so a non-modal panel cannot be made to trap and a modal
// one cannot be made not to. §8.6: "Modal dialogs trap focus, close with
// Escape, announce title and state, and return focus to the exact originating
// control."
//
// Client-safe: no imports beyond types.

export const PANEL_MODES = [
  /** Rendered in the flow, beside or under the list. No overlay, no dismissal
   *  semantics — it is part of the page. */
  "inline",
  /** An overlay that leaves the rest of the page operable. The desktop
   *  evidence panel. */
  "nonmodal",
  /** An overlay that owns the interaction until it closes. For a decision that
   *  must not be made half-attentively, and for small screens where a
   *  non-modal panel would cover the list anyway. */
  "modal",
] as const;
export type PanelMode = (typeof PANEL_MODES)[number];

export interface FocusBehaviour {
  /** §1.4: modal only. */
  trapFocus: boolean;
  /** Escape closes it. True wherever there is something to close. */
  closeOnEscape: boolean;
  /** §8.6: "return focus to the exact originating control." Required
   *  everywhere there is a close, which is why it is documented per mode
   *  rather than left to each call site. */
  returnFocusToOpener: boolean;
  /** §1.4: "a labeled region". Every mode gets one; a panel nobody can
   *  address is a panel a screen reader cannot announce. */
  labelledRegion: boolean;
  /** Whether the panel offers a close control. Inline has nothing to close. */
  closeControl: boolean;
  /** Whether the rest of the page stays operable while it is open — the
   *  property the whole ruling is about. */
  pageRemainsOperable: boolean;
}

/**
 * The focus behaviour for a mode. A function, not a config object, so there is
 * no third state where a caller sets `trapFocus` on a non-modal panel.
 */
export function focusBehaviour(mode: PanelMode): FocusBehaviour {
  switch (mode) {
    case "inline":
      return {
        trapFocus: false,
        closeOnEscape: false,
        returnFocusToOpener: false,
        labelledRegion: true,
        closeControl: false,
        pageRemainsOperable: true,
      };
    case "nonmodal":
      return {
        trapFocus: false,
        closeOnEscape: true,
        returnFocusToOpener: true,
        labelledRegion: true,
        closeControl: true,
        // The whole point of the ruling.
        pageRemainsOperable: true,
      };
    case "modal":
      return {
        trapFocus: true,
        closeOnEscape: true,
        returnFocusToOpener: true,
        labelledRegion: true,
        closeControl: true,
        pageRemainsOperable: false,
      };
  }
}

/**
 * Which mode a panel should use.
 *
 * §5: "Open a nonmodal detail panel on wide screens. On small screens, open a
 * full page with a dependable return path." A modal on a phone covers the list
 * it exists to be compared against, so the small-screen answer is a page rather
 * than a bigger overlay — which this returns as `modal` only when the caller
 * says a decision is being made, and otherwise tells the caller to navigate.
 */
export type PanelPresentation =
  | { kind: "panel"; mode: PanelMode }
  /** Go to a page instead. §5's small-screen answer, with the return control
   *  §1.5 requires. */
  | { kind: "page"; returnTo: string };

export function presentationFor(args: {
  /** Whether the viewport can hold a panel beside the list. */
  wide: boolean;
  /** Whether the panel is for reading evidence or for committing a decision.
   *  A decision earns a modal; reading never does. */
  purpose: "read" | "decide";
  /** Where a page presentation returns to. */
  listHref: string;
}): PanelPresentation {
  if (!args.wide) return { kind: "page", returnTo: args.listHref };
  return { kind: "panel", mode: args.purpose === "decide" ? "modal" : "nonmodal" };
}

/** What a panel must carry, in every mode. §8.6 and §5: identity and the action
 *  target stay visible while evidence is read. */
export interface PanelContract {
  mode: PanelMode;
  /** The accessible name of the region or dialog. Required. */
  label: string;
  /** The id of the control that opened it, for focus return. Required wherever
   *  `returnFocusToOpener` is true. */
  openerId?: string;
  /** §5: "Keep identity and the action target visible while reading evidence
   *  or entering a decision." */
  subjectLabel: string;
}

export class PanelContractError extends Error {}

/** Refuse a panel that cannot behave as its mode requires. Called by the
 *  component rather than trusted, so a missing focus-return target is a build
 *  failure rather than a keyboard user losing their place. */
export function assertPanel(c: PanelContract): PanelContract {
  const behaviour = focusBehaviour(c.mode);
  if (!c.label.trim()) {
    throw new PanelContractError("A panel needs an accessible name; §1.4 requires a labeled region in every mode.");
  }
  if (!c.subjectLabel.trim()) {
    throw new PanelContractError(
      "A panel needs its subject on screen. §5: identity and the action target stay visible while evidence is read."
    );
  }
  if (behaviour.returnFocusToOpener && !c.openerId?.trim()) {
    throw new PanelContractError(
      `A ${c.mode} panel must name the control it returns focus to. §8.6: "return focus to the exact originating control."`
    );
  }
  return c;
}

export const MODE_NOTE: Record<PanelMode, string> = {
  inline: "Part of the page. Nothing to close, nothing trapped, and the list stays readable beside it.",
  nonmodal: "An overlay that leaves the page operable, so evidence can be read against the row it belongs to rather than from memory.",
  modal: "Owns the interaction until it closes. For a decision that should not be made half-attentively, and for narrow screens where an overlay would cover the list anyway.",
};
