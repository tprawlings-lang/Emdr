// Telling two people apart when their names read the same (17 September
// handoff, P6; §5's "where names match, use a permitted secondary identifier
// rather than initials alone").
//
// ONE RULE, ONE IMPLEMENTATION — AND IT WAS TWO. The clinician's queue had
// carried a `disambiguator` since §5 landed, computed by a private function in
// clinician-home.ts with the same reasoning as everything below it: only where
// a name repeats, never initials, a slice of the record id. This module was
// written months later for the caseload table without finding it, which is
// precisely the drift the work register exists to catch.
//
// THE TWO HAD ALREADY DIVERGED, which is the argument rather than the tidiness:
// this one folds case and surrounding space before comparing and that one did
// not, so "Ines Mwangi" and " ines mwangi " collided here and read as two
// different people there. Both surfaces call this now. They still SAY it
// differently — a chip on a table, a phrase in a drawer — because presentation
// is theirs; which rows are ambiguous, and what marks them, is one decision.
//
//   "Two people share a display name → Use an approved secondary identifier
//   with minimum exposure."
//
// IT IS NOT HYPOTHETICAL IN THIS BUILD. The fabricated population contains four
// people called "Ines Mwangi (fabricated)" and three called "Yuki Delacroix
// (fabricated)", because the generator draws names from a list. On a caseload
// those rows are indistinguishable, and the action a clinician takes from a row
// is about whichever person that row happens to be.
//
// MINIMUM EXPOSURE IS THE HARD HALF, and it is why this is a function rather
// than a column. The obvious fix — put a date of birth, or a record number,
// beside every name — solves the collision by printing an identifier for
// everybody, including the overwhelming majority whose names are already
// unique. That is a standing disclosure to anybody who walks past the screen,
// bought to fix a problem those rows do not have.
//
// So the identifier appears ONLY on the rows that collide, and only within the
// list being shown. Two people called Ines Mwangi on one screen get a mark;
// the same person on a screen where nobody shares their name does not.

/** A short, non-identifying mark taken from the record's own identifier.
 *
 *  NOT A NAME, A DATE OR AN INITIAL. A middle initial and a date of birth are
 *  both facts about the person that a reader can carry out of the building; a
 *  slice of an opaque record id is a fact about the row, means nothing away
 *  from this system, and is exactly as good at telling two rows apart. */
export function recordMark(personId: string): string {
  return personId.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase();
}

export interface Named {
  personId: string;
  displayName: string;
}

export interface Disambiguated<T> {
  row: T;
  /** Null when nothing else on this screen shares the name. */
  mark: string | null;
}

/**
 * Mark only the rows a reader could confuse.
 *
 * SCOPED TO THE LIST, deliberately. "Is this name ambiguous" is a question
 * about what is on the screen, not about the database: marking every row whose
 * name appears twice anywhere in the tenant would put a mark on people the
 * reader is in no danger of confusing, which is the standing disclosure this
 * avoids.
 */
export function disambiguate<T extends Named>(rows: readonly T[]): Disambiguated<T>[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.displayName.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.map((row) => {
    const key = row.displayName.trim().toLowerCase();
    return { row, mark: (counts.get(key) ?? 0) > 1 ? recordMark(row.personId) : null };
  });
}

/** The name as it should be read aloud, with the mark only where it is needed. */
export function nameFor<T extends Named>(d: Disambiguated<T>): string {
  return d.mark ? `${d.row.displayName} · ${d.mark}` : d.row.displayName;
}

/** What the mark is, for the screen that shows one. A mark nobody can explain
 *  is a number people start treating as a patient identifier. */
export const RECORD_MARK_NOTE =
  "Two or more people on this screen have the same name. The short code tells the records apart; " +
  "it is part of the record's identifier and means nothing outside Steady.";

/**
 * The queue's phrasing of the same mark.
 *
 * A DRAWER READS AS A SENTENCE AND A TABLE CELL DOES NOT. The queue has room to
 * say what the code is; the caseload's name column does not, and puts the same
 * four characters in a chip with the explanation in its title. Both come from
 * `disambiguate`, so a row that is ambiguous in one place is ambiguous in the
 * other.
 */
export function markPhrase(mark: string): string {
  return `id ending ${mark}`;
}
