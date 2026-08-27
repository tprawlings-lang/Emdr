import type { MetadataRoute } from "next";

// Redesign handoff §4: the current deployment is the REVIEW environment, not a
// permanent public brand domain. It stays out of search indexes until the
// institutional site is built and reviewed.
//
// This is not only a marketing preference. The environment contains a
// clinician console, an audit ledger, and member-shaped records — fabricated,
// but shaped exactly like the real thing. An indexed snapshot of a fabricated
// clinical record is a durable misrepresentation that outlives any correction
// made here.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
