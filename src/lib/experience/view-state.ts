// View state (handoff 09 §9, §1.5, §5; Package 1).
//
// §9's shape: "Allowed filters and return position stored apart from clinical
// drafts; cleared on tenant change." Its reason: "Efficient return should not
// leak data or change evidence."
//
// TWO RULES, AND THE SECOND IS THE ONE WITH A BREACH BEHIND IT.
//
//   APART FROM CLINICAL DRAFTS. §4.4: "Preserve work only through an approved
//   storage boundary. Do not place clinical text in browser local storage by
//   default." A view state and a half-written note both want to survive a
//   reload, and the obvious implementation puts them in the same bag — at
//   which point a clinician's unsent words about a patient are sitting in a
//   browser store on a shared machine. So `ViewState` has no free-text field
//   at all, and the guard asserts it: a filter is a key from a declared set,
//   never a string somebody typed.
//
//   CLEARED ON TENANT CHANGE. §6: "Switching tenant clears prior view state."
//   A return position is a person id and a scroll offset; carried across a
//   tenant switch it points at somebody the new tenant may not see, and the
//   restore renders a row from the wrong organization. `forTenant` refuses to
//   return a state that was stored under a different tenant rather than
//   filtering it — a filter is something a caller can forget to apply.
//
// AND FILTERS MAY NOT HIDE OBLIGATIONS. §5: "Do not let a filter quietly hide
// mandatory obligations. Show an active-filter summary and a clear reset
// control. Preferences may change density and supporting columns, never
// clinical priority." So the allowed set below contains no filter that can
// remove a row, only ones that change what is emphasised — and `summary`
// exists so the surface always has the sentence §5 requires.

/**
 * The filters a clinician may apply.
 *
 * EVERY ONE OF THESE IS A VIEW, NOT A SUBSET. `assignedToMe` narrows what is
 * EMPHASISED and the queue still reports the full count beside it; `density`
 * and `showSupportingColumns` change how much is on screen. There is
 * deliberately no `hideAcknowledged`, no `onlyBand`, and no `minimumDueIn` —
 * §5 forbids a filter that can make a mandatory obligation disappear, and the
 * way to keep that promise is for the vocabulary not to contain one.
 */
export const VIEW_FILTERS = [
  "assignedToMe",
  "density",
  "showSupportingColumns",
  "sortWithinBand",
] as const;
export type ViewFilter = (typeof VIEW_FILTERS)[number];

/** The permitted values per filter. Closed sets, so a filter value is chosen
 *  from a list rather than parsed from a query string. */
export const FILTER_VALUES: Record<ViewFilter, readonly string[]> = {
  assignedToMe: ["all", "mine"],
  density: ["comfortable", "compact"],
  showSupportingColumns: ["on", "off"],
  // Within a band only. §5: "Preferences may change density and supporting
  // columns, never clinical priority" — so the band order is the server's and
  // this reorders inside one band.
  sortWithinBand: ["oldest", "newest", "name"],
};

export const FILTER_DEFAULT: Record<ViewFilter, string> = {
  assignedToMe: "all",
  density: "comfortable",
  showSupportingColumns: "on",
  sortWithinBand: "oldest",
};

/** How each filter reads in the active-filter summary §5 requires. */
export const FILTER_LABEL: Record<ViewFilter, Record<string, string>> = {
  assignedToMe: { all: "Everyone's work", mine: "Assigned to me" },
  density: { comfortable: "Comfortable rows", compact: "Compact rows" },
  showSupportingColumns: { on: "Supporting columns shown", off: "Supporting columns hidden" },
  sortWithinBand: { oldest: "Oldest first", newest: "Newest first", name: "By name" },
};

/**
 * Where the reader was, so returning puts them back.
 *
 * §1.5: "Both contexts are preserved when moving between them: filters, page,
 * scroll position, and selection all survive a round trip."
 */
export interface ReturnPosition {
  /** The list they came from. */
  fromHref: string;
  page: number;
  scrollY: number;
  /** The row that was selected, by id. An ID and not a rendered label: a label
   *  is content, and this store is not for content. */
  selectedId: string | null;
}

/**
 * NO FREE TEXT ANYWHERE IN THIS TYPE, and the guard checks it. Every field is
 * a declared key, a number, or an id. A clinical draft belongs in the approved
 * storage boundary, not here.
 */
export interface ViewState {
  /** The tenant this state was stored under. Compared rather than trusted. */
  tenantId: string;
  filters: Record<ViewFilter, string>;
  returnTo: ReturnPosition | null;
}

export class ViewStateError extends Error {}

export function emptyViewState(tenantId: string): ViewState {
  return { tenantId, filters: { ...FILTER_DEFAULT }, returnTo: null };
}

/**
 * A stored state, or a fresh one if it belongs to a different tenant.
 *
 * REFUSES RATHER THAN FILTERS. A function that stripped the foreign parts would
 * leave a caller holding a state that looks restored and points at a person
 * from another organization. §6: "Switching tenant clears prior view state" —
 * clears, not sanitises.
 */
export function forTenant(stored: ViewState | null, tenantId: string): ViewState {
  if (!stored || stored.tenantId !== tenantId) return emptyViewState(tenantId);
  return stored;
}

/** Apply one filter, refusing a value that is not in its set. A value parsed
 *  from a URL is a value somebody can write. */
export function withFilter(state: ViewState, filter: ViewFilter, value: string): ViewState {
  if (!(FILTER_VALUES[filter] as readonly string[]).includes(value)) {
    throw new ViewStateError(
      `"${value}" is not a permitted value for ${filter}. Filters are chosen from a closed set, never parsed.`
    );
  }
  return { ...state, filters: { ...state.filters, [filter]: value } };
}

/** Read filters out of a URL, dropping anything not declared. The one place a
 *  query string is allowed to influence a view, and it cannot introduce a
 *  filter or a value that is not in the vocabulary above. */
export function fromSearchParams(
  params: Record<string, string | string[] | undefined>, tenantId: string
): ViewState {
  let state = emptyViewState(tenantId);
  for (const f of VIEW_FILTERS) {
    const raw = params[f];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) continue;
    if (!(FILTER_VALUES[f] as readonly string[]).includes(value)) continue;
    state = withFilter(state, f, value);
  }
  return state;
}

/** The active-filter summary §5 requires, and null when nothing is off the
 *  default — a summary that always renders teaches a reader to ignore it. */
export function summary(state: ViewState): string | null {
  const changed = VIEW_FILTERS.filter((f) => state.filters[f] !== FILTER_DEFAULT[f]);
  if (changed.length === 0) return null;
  return changed.map((f) => FILTER_LABEL[f][state.filters[f]]).join(" · ");
}

export function isDefault(state: ViewState): boolean {
  return VIEW_FILTERS.every((f) => state.filters[f] === FILTER_DEFAULT[f]);
}

/** Reset, keeping the tenant. §5: "a clear reset control." */
export function reset(state: ViewState): ViewState {
  return emptyViewState(state.tenantId);
}
