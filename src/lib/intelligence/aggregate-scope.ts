// Resolving the scope an aggregate console is showing (handoff 09 §6;
// Package 5).
//
// §6: "Organization, period, and data freshness travel together in a scope
// strip, carried into every drilldown."
//
// ONE RESOLVER, SO THE STRIP AND THE PROJECTIONS AGREE. The failure this
// prevents is subtle and it is the reason the three fields are one object:
// a strip that renders "last 90 days" from a query parameter while the
// projection underneath computed 180 is a screen that is confidently wrong,
// and nothing about it looks broken.
//
// THE DEFAULT IS DEFINED HERE AND NOWHERE ELSE. §6 asks for "an obvious
// reset", and a reset is only obvious if there is exactly one thing to reset
// to. `defaultScope` is what the unparameterised route shows, and the reset
// link goes to that route rather than re-encoding the default — so the two
// cannot drift.
//
// FRESHNESS IS READ, NOT ASSUMED. The dataset version comes from the same
// watermark the projections carry, so "rebuilt on" in the strip is the build
// the numbers came from rather than the time the page rendered.

import { headers } from "next/headers";
import { data } from "../data";
import { PROJECTION_VERSION } from "./organization";
import type { Scope } from "../experience/aggregate";
import { scopeIds } from "./organization";

/** The window an aggregate console opens on. Ninety days because that is the
 *  window the organization projections already compute; changing it here
 *  without changing them would produce the disagreement described above. */
export const DEFAULT_PERIOD_DAYS = 90;

export interface ScopeInput {
  tenantId: string;
  /** Raw search parameters. Unvalidated: this is where they are validated. */
  params?: Record<string, string | string[] | undefined>;
  now?: Date;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function windowLabel(days: number): string {
  if (days === DEFAULT_PERIOD_DAYS) return "Last 90 days";
  if (days % 30 === 0) return `Last ${days / 30} months`;
  return `Last ${days} days`;
}

function one(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** What this console shows when nobody has narrowed it. */
export async function defaultScope(args: ScopeInput): Promise<Scope> {
  const now = args.now ?? new Date();
  const start = new Date(now.getTime() - DEFAULT_PERIOD_DAYS * 86_400_000);
  return {
    organizationId: args.tenantId,
    organizationLabel: await tenantLabel(args.tenantId),
    period: { start: day(start), end: day(now), label: windowLabel(DEFAULT_PERIOD_DAYS) },
    freshness: await freshness(args.tenantId),
  };
}

/**
 * The scope actually in force, from the URL where it is valid.
 *
 * AN INVALID PARAMETER FALLS BACK TO THE DEFAULT RATHER THAN ERRORING, and
 * that is a deliberate asymmetry. A malformed date in a shared link should
 * show the reader the default window with the strip saying so — not a stack
 * trace, and not a silently different window they cannot see. The strip is
 * what makes the fallback visible.
 *
 * THE ORGANIZATION IS NEVER TAKEN FROM THE URL. It comes from the caller's
 * resolved tenant, always. A console that let `?org=` choose the population
 * would be a cross-tenant read with a query parameter for a key.
 */
export async function scopeFrom(args: ScopeInput): Promise<Scope> {
  const base = await defaultScope(args);
  const from = one(args.params?.from);
  const to = one(args.params?.to);
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return base;
  }
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return base;

  const days = Math.round((b - a) / 86_400_000);
  return {
    ...base,
    period: { start: from, end: to, label: windowLabel(days) },
  };
}

async function tenantLabel(tenantId: string): Promise<string> {
  const c = await data();
  const row = (await c.get("SELECT name FROM tenants WHERE id = ?", [tenantId])) as
    | { name: string } | undefined;
  return row?.name ?? "This organization";
}

/**
 * When the data behind these numbers was last rebuilt.
 *
 * ACROSS THE SAME TENANTS THE PROJECTIONS READ, which is a correction rather
 * than a detail. This first queried the organization's own tenant row and
 * found nothing: an organization is a PARENT and its events live in the child
 * tenants its sites are, so the strip rendered "rebuilt not yet built" over a
 * console showing 9,000 events. `scopeIds` is the same expansion the
 * projections use, so the freshness is the freshness of the data the numbers
 * came from — which is the entire claim the field makes.
 */
async function freshness(tenantId: string): Promise<Scope["freshness"]> {
  const ids = await scopeIds(tenantId);
  if (ids.length === 0) return { refreshedAt: null, dataVersion: PROJECTION_VERSION };
  const c = await data();
  const row = (await c.get(
    `SELECT MAX(recorded_at) AS at FROM longitudinal_events
      WHERE tenant_id IN (${ids.map(() => "?").join(",")})`,
    ids
  )) as { at: string | null } | undefined;
  return {
    // Null rather than a sentence. The strip decides how to say "no data yet";
    // a string here produced "rebuilt not yet built" when the component
    // prefixed it, which is the cost of putting copy in a resolver.
    refreshedAt: row?.at ?? null,
    dataVersion: PROJECTION_VERSION,
  };
}

/**
 * The scope for the current request, without a page prop.
 *
 * Reads the query from the header the proxy sets. See the note there: this is
 * how §6's "carried into every drilldown" becomes a property of the frame
 * rather than a habit twenty-three pages have to keep.
 */
export async function scopeForRequest(tenantId: string): Promise<Scope> {
  const h = await headers();
  const search = h.get("x-search") ?? "";
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) params[k] = v;
  return scopeFrom({ tenantId, params });
}

/** How long the scoped window is, in days. The projections take a day count;
 *  the strip carries dates. One conversion, in one place, so the two cannot
 *  drift by a rounding rule. */
export function periodDaysOf(scope: Scope): number {
  const a = Date.parse(`${scope.period.start}T00:00:00Z`);
  const b = Date.parse(`${scope.period.end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return DEFAULT_PERIOD_DAYS;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** The route being rendered, for a strip that needs to link to itself. */
export async function currentPath(): Promise<string> {
  return (await headers()).get("x-pathname") ?? "";
}

/**
 * The windows a reader may choose.
 *
 * NAMED WINDOWS, NOT A DATE PICKER. §6 warns that "a changed cohort
 * definition, period length, or data source produces a stated limit rather
 * than a silent comparison" — and an arbitrary pair of dates produces a
 * different length almost every time, so every comparison on the screen would
 * carry a limit and the limits would stop meaning anything. Three lengths, one
 * of which is the default, keeps a comparison possible.
 */
export const PERIOD_OPTIONS = [
  { days: 30, label: "Last 30 days" },
  { days: DEFAULT_PERIOD_DAYS, label: "Last 90 days" },
  { days: 180, label: "Last 6 months" },
] as const;

/** The href that selects one window on the route being rendered, keeping the
 *  rest of the query. A reader who narrowed a table and then changed the
 *  period should not lose the table. */
export function periodHref(path: string, search: string, days: number, now = new Date()): string {
  const params = new URLSearchParams(search);
  const end = day(now);
  const start = day(new Date(now.getTime() - days * 86_400_000));
  params.set("from", start);
  params.set("to", end);
  return `${path}?${params.toString()}`;
}
