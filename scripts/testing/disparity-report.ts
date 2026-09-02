process.env.EMDR_DATA_DIR = `/tmp/steady-disparity-${process.pid}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "disparity-probe-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = "disparity-probe-key";
import { getDb } from "../../src/lib/db";
import { data } from "../../src/lib/data";
import { populationTenantIds } from "../../src/lib/planning/scope";

interface Row {
  lang: string; interp: number; band: string; region: string; state: string;
  needs: string | null; done: number; undelivered: number; skipped: number;
  checkins: number; days_to_first: number | null;
}

async function main() {
  getDb();
  const c = await data();
  const t = populationTenantIds();
  const marks = t.map(() => "?").join(",");
  const rows = (await c.all(
    `SELECT a.preferred_language AS lang, a.interpreter_needed AS interp, a.age_band AS band,
            a.census_region AS region, a.state AS state, a.access_needs_json AS needs,
            (SELECT COUNT(*) FROM screenings s WHERE s.user_id = u.id) AS done,
            (SELECT COUNT(*) FROM longitudinal_events e WHERE e.person_id = u.id
              AND e.event_type='measure.not_completed' AND json_extract(e.payload,'$.cause')='service') AS undelivered,
            (SELECT COUNT(*) FROM longitudinal_events e WHERE e.person_id = u.id
              AND e.event_type='measure.not_completed' AND json_extract(e.payload,'$.cause')='person') AS skipped,
            (SELECT COUNT(*) FROM checkins k WHERE k.user_id = u.id) AS checkins,
            CAST(julianday((SELECT MIN(k.checkin_date) FROM checkins k WHERE k.user_id = u.id))
                 - julianday(u.created_at) AS INTEGER) AS days_to_first
       FROM users u LEFT JOIN person_attributes a ON a.person_id = u.id
      WHERE u.tenant_id IN (${marks}) AND u.role='member' AND u.email LIKE 'st-%'`, t)) as Row[];
  console.log(`n = ${rows.length}`);
  const rate = (rs: Row[]) => {
    const done = rs.reduce((s, r) => s + r.done, 0);
    const due = rs.reduce((s, r) => s + r.done + r.undelivered + r.skipped, 0);
    const und = rs.reduce((s, r) => s + r.undelivered, 0);
    const skp = rs.reduce((s, r) => s + r.skipped, 0);
    const ck = rs.reduce((s, r) => s + r.checkins, 0) / Math.max(1, rs.length);
    const act = 100 * rs.filter(r => r.days_to_first !== null && r.days_to_first <= 7).length / Math.max(1, rs.length);
    const ttf = rs.reduce((s, r) => s + (r.days_to_first ?? 0), 0) / Math.max(1, rs.length);
    return { n: rs.length, done, due, pct: due ? (100 * done / due) : 0, und, skp, ck, act, ttf };
  };
  const all = rate(rows);
  const show = (label: string, rs: Row[]) => {
    const r = rate(rs);
    const gap = r.pct - all.pct;
    console.log(`  ${label.padEnd(34)} n=${String(r.n).padStart(3)}  ${r.done}/${r.due} = ${r.pct.toFixed(1).padStart(5)}%  gap ${gap >= 0 ? "+" : ""}${gap.toFixed(1).padStart(5)}pp   undelivered=${String(r.und).padStart(3)} skipped=${String(r.skp).padStart(3)}  activation(7d)=${r.act.toFixed(0).padStart(3)}%  days-to-first=${r.ttf.toFixed(1).padStart(4)}`);
  };
  console.log(`\nNETWORK  ${all.done}/${all.due} = ${all.pct.toFixed(1)}%   undelivered=${all.und} skipped=${all.skp}\n`);
  console.log("by language:");
  for (const l of ["English", "Spanish", "Mandarin"]) show(l, rows.filter(r => r.lang === l));
  console.log("\nby interpreter need:");
  show("interpreter needed", rows.filter(r => r.interp === 1));
  show("no interpreter needed", rows.filter(r => r.interp !== 1));
  console.log("\nSpanish, stratified by interpreter need:");
  show("Spanish + interpreter", rows.filter(r => r.lang === "Spanish" && r.interp === 1));
  show("Spanish, no interpreter", rows.filter(r => r.lang === "Spanish" && r.interp !== 1));
  console.log("\nMandarin, stratified by interpreter need:");
  show("Mandarin + interpreter", rows.filter(r => r.lang === "Mandarin" && r.interp === 1));
  show("Mandarin, no interpreter", rows.filter(r => r.lang === "Mandarin" && r.interp !== 1));
  console.log("\nby age band:");
  for (const b of ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]) show(b, rows.filter(r => r.band === b));
  console.log("\nby region:");
  for (const b of ["Northeast", "Midwest", "South", "West"]) show(b, rows.filter(r => r.region === b));
  console.log("\nby access need:");
  show("has a functional access need", rows.filter(r => r.needs && r.needs !== "[]"));
  console.log("\nrural:");
  const RURAL = new Set(["ME","MO","WI","TN","NC","NV","OR"]);
  show("rural states", rows.filter(r => RURAL.has(r.state)));
  show("non-rural states", rows.filter(r => !RURAL.has(r.state)));
  console.log("\nper-person bounds (p14):");
  const mm = (f: (r: Row) => number) => { const v = rows.map(f); return `${Math.min(...v)}–${Math.max(...v)}`; };
  console.log(`  check-ins ${mm(r=>r.checkins)} (need 18–90)   measures ${mm(r=>r.done)} (need 4–8)`);
}
main().then(()=>process.exit(0), e=>{console.error(e);process.exit(1);});
