// GENERATED — do not edit by hand.
//
// Regenerate with: npx tsx scripts/gen-access-inventory.ts
//
// The permission-sequence inventory for every protected route (handoff 06
// §30.6, §31.5), walked out of the source at build time and committed so the
// review screen can render it without reading the filesystem at runtime.
// tests/access-enforcement.test.ts fails if this drifts from a fresh walk.

import type { AccessInventory } from "./access-evidence";

export const ACCESS_INVENTORY: AccessInventory = {
  "routes": [
    {
      "path": "/app/today",
      "audience": "member",
      "file": "app/app/today/page.tsx",
      "owed": [
        1,
        2,
        4,
        5,
        8
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": [],
        "8": [
          "projectionVersion",
          "schemaVersion",
          "ProjectionMeta"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/welcome",
      "audience": "member",
      "file": "app/app/welcome/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/paths",
      "audience": "member",
      "file": "app/app/paths/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/progress",
      "audience": "member",
      "file": "app/app/progress/page.tsx",
      "owed": [
        1,
        2,
        4,
        5,
        8
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": [],
        "8": [
          "projectionVersion",
          "schemaVersion",
          "ProjectionMeta"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/plan",
      "audience": "member",
      "file": "app/app/plan/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/care-team",
      "audience": "member",
      "file": "app/app/care-team/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/messages",
      "audience": "member",
      "file": "app/app/messages/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/check-in",
      "audience": "member",
      "file": "app/app/check-in/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/ground",
      "audience": "member",
      "file": "app/app/ground/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [],
        "2": [],
        "4": [],
        "5": []
      },
      "missing": [],
      "exempt": [
        1,
        2,
        4
      ]
    },
    {
      "path": "/app/activities",
      "audience": "member",
      "file": "app/app/activities/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/activities/breathe",
      "audience": "member",
      "file": "app/app/activities/breathe/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/activities/meditate",
      "audience": "member",
      "file": "app/app/activities/meditate/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/activities/move",
      "audience": "member",
      "file": "app/app/activities/move/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/activities/sleep",
      "audience": "member",
      "file": "app/app/activities/sleep/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/companion",
      "audience": "member",
      "file": "app/app/companion/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/learn",
      "audience": "member",
      "file": "app/app/learn/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/learn/[lessonId]",
      "audience": "member",
      "file": "app/app/learn/[lessonId]/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/session/prepare",
      "audience": "member",
      "file": "app/app/session/prepare/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/session/resourcing",
      "audience": "member",
      "file": "app/app/session/resourcing/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/session/[moduleId]",
      "audience": "member",
      "file": "app/app/session/[moduleId]/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/session/[moduleId]/safety",
      "audience": "member",
      "file": "app/app/session/[moduleId]/safety/page.tsx",
      "owed": [
        1,
        2,
        4,
        5,
        8
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": [],
        "8": [
          "projectionVersion",
          "schemaVersion",
          "ProjectionMeta"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/session/[moduleId]/complete",
      "audience": "member",
      "file": "app/app/session/[moduleId]/complete/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/onboarding",
      "audience": "member",
      "file": "app/app/onboarding/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/onboarding/profile",
      "audience": "member",
      "file": "app/app/onboarding/profile/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/screening/fit",
      "audience": "member",
      "file": "app/app/screening/fit/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/screening",
      "audience": "member",
      "file": "app/app/screening/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/screening/[instrumentId]",
      "audience": "member",
      "file": "app/app/screening/[instrumentId]/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/measures",
      "audience": "member",
      "file": "app/app/measures/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/measures/[instrumentId]",
      "audience": "member",
      "file": "app/app/measures/[instrumentId]/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/consent",
      "audience": "member",
      "file": "app/app/consent/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/settings",
      "audience": "member",
      "file": "app/app/settings/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/settings/referral",
      "audience": "member",
      "file": "app/app/settings/referral/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/settings/account",
      "audience": "member",
      "file": "app/app/settings/account/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": [
        2
      ]
    },
    {
      "path": "/app/settings/billing",
      "audience": "member",
      "file": "app/app/settings/billing/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/settings/sessions",
      "audience": "member",
      "file": "app/app/settings/sessions/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/settings/memory",
      "audience": "member",
      "file": "app/app/settings/memory/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/app/settings/voice",
      "audience": "member",
      "file": "app/app/settings/voice/page.tsx",
      "owed": [
        1,
        2,
        4,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireMember("
        ],
        "2": [
          "requireMember("
        ],
        "4": [
          "hasConsent(",
          "revoked_at IS NULL"
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician",
      "audience": "clinician",
      "file": "app/clinician/page.tsx",
      "owed": [
        1,
        2
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/today",
      "audience": "clinician",
      "file": "app/clinician/today/page.tsx",
      "owed": [
        1,
        2,
        5,
        8
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": [],
        "8": [
          "projectionVersion",
          "schemaVersion",
          "ProjectionMeta"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/activity",
      "audience": "clinician",
      "file": "app/clinician/activity/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/alerts/[id]",
      "audience": "clinician",
      "file": "app/clinician/alerts/[id]/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/caseload",
      "audience": "clinician",
      "file": "app/clinician/caseload/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/patients",
      "audience": "clinician",
      "file": "app/clinician/patients/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/population",
      "audience": "clinician",
      "file": "app/clinician/population/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/reports",
      "audience": "clinician",
      "file": "app/clinician/reports/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/handoffs",
      "audience": "clinician",
      "file": "app/clinician/handoffs/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/referrals",
      "audience": "clinician",
      "file": "app/clinician/referrals/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/messages",
      "audience": "clinician",
      "file": "app/clinician/messages/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/schedule",
      "audience": "clinician",
      "file": "app/clinician/schedule/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7,
        8
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "repo(ctx)",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed"
        ],
        "8": [
          "projectionVersion",
          "schemaVersion",
          "ProjectionMeta"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/course",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/course/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed",
          "_opened"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/measures",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/measures/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed",
          "_opened"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/goals",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/goals/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "repo(ctx)",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed",
          "_opened"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/sessions",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/sessions/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/session/[sid]",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/session/[sid]/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/responses",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/responses/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "repo(ctx)",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed",
          "_opened"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/trajectory",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/trajectory/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "repo(ctx)",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed",
          "_opened"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/load",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/load/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "repo(ctx)",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed",
          "_opened"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/safety",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/safety/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/thoughts",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/thoughts/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "repo(ctx)",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed",
          "_opened"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/note",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/note/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "repo(ctx)",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/plan",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/plan/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/record",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/record/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/clinician/member/[id]/audit",
      "audience": "clinician",
      "file": "app/clinician/member/[id]/audit/page.tsx",
      "owed": [
        1,
        2,
        3,
        4,
        5,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician("
        ],
        "2": [
          "requireClinician("
        ],
        "3": [
          "tenant_id = ?",
          "loadPersonHeader("
        ],
        "4": [
          "revoked_at IS NULL",
          "consentActive"
        ],
        "5": [],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/organization",
      "audience": "organization",
      "file": "app/organization/page.tsx",
      "owed": [
        1,
        2
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/organization/overview",
      "audience": "organization",
      "file": "app/organization/overview/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7,
        8
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ],
        "5": [],
        "6": [
          "SMALL_CELL",
          "suppressed("
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ],
        "8": [
          "projectionVersion",
          "schemaVersion"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/organization/care-delivery",
      "audience": "organization",
      "file": "app/organization/care-delivery/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ],
        "5": [],
        "6": [
          "SMALL_CELL",
          "suppressed("
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/organization/outcomes",
      "audience": "organization",
      "file": "app/organization/outcomes/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ],
        "5": [],
        "6": [
          "SMALL_CELL",
          "suppressed("
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/organization/population",
      "audience": "organization",
      "file": "app/organization/population/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ],
        "5": [],
        "6": [
          "SMALL_CELL"
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/organization/capacity",
      "audience": "organization",
      "file": "app/organization/capacity/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ],
        "5": [],
        "6": [
          "SMALL_CELL"
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/organization/teams",
      "audience": "organization",
      "file": "app/organization/teams/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ],
        "5": [],
        "6": [],
        "7": []
      },
      "missing": [],
      "exempt": [
        6,
        7
      ]
    },
    {
      "path": "/organization/locations",
      "audience": "organization",
      "file": "app/organization/locations/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ],
        "5": [],
        "6": [
          "SMALL_CELL",
          "suppressed("
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/organization/safety",
      "audience": "organization",
      "file": "app/organization/safety/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ],
        "5": [],
        "6": [
          "SMALL_CELL"
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/organization/access",
      "audience": "organization",
      "file": "app/organization/access/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ],
        "5": [],
        "6": [
          "SMALL_CELL",
          "suppressed("
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/organization/reports",
      "audience": "organization",
      "file": "app/organization/reports/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireOrganization("
        ],
        "2": [
          "requireOrganization("
        ],
        "5": [],
        "6": [
          "countColumns:"
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/payer",
      "audience": "payer",
      "file": "app/payer/page.tsx",
      "owed": [
        1,
        2
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/payer/overview",
      "audience": "payer",
      "file": "app/payer/overview/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7,
        8
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [
          "SMALL_CELL",
          "suppressed("
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ],
        "8": [
          "projectionVersion",
          "schemaVersion"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/payer/population",
      "audience": "payer",
      "file": "app/payer/population/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [
          "SMALL_CELL"
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/payer/population-access",
      "audience": "payer",
      "file": "app/payer/population-access/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [],
        "7": []
      },
      "missing": [],
      "exempt": [
        6,
        7
      ]
    },
    {
      "path": "/payer/cohorts",
      "audience": "payer",
      "file": "app/payer/cohorts/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [
          "SMALL_CELL"
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/payer/outcomes",
      "audience": "payer",
      "file": "app/payer/outcomes/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [
          "SMALL_CELL",
          "suppressed("
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/payer/engagement",
      "audience": "payer",
      "file": "app/payer/engagement/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [
          "SMALL_CELL",
          "suppressed("
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/payer/utilization",
      "audience": "payer",
      "file": "app/payer/utilization/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [
          "SMALL_CELL"
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/payer/contract",
      "audience": "payer",
      "file": "app/payer/contract/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [
          "countColumns:"
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/payer/evidence",
      "audience": "payer",
      "file": "app/payer/evidence/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7,
        8
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [],
        "7": [
          "family: \"security\"",
          "_viewed"
        ],
        "8": [
          "projectionVersion",
          "schemaVersion"
        ]
      },
      "missing": [],
      "exempt": [
        6
      ]
    },
    {
      "path": "/payer/evidence/cost",
      "audience": "payer",
      "file": "app/payer/evidence/cost/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": [
        6
      ]
    },
    {
      "path": "/payer/data-quality",
      "audience": "payer",
      "file": "app/payer/data-quality/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [
          "SMALL_CELL",
          "suppressed("
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/payer/access",
      "audience": "payer",
      "file": "app/payer/access/page.tsx",
      "owed": [
        1,
        2,
        5,
        6,
        7
      ],
      "found": {
        "1": [
          "requireUser(",
          "requirePayer("
        ],
        "2": [
          "requirePayer("
        ],
        "5": [],
        "6": [
          "SMALL_CELL",
          "suppressed("
        ],
        "7": [
          "family: \"security\"",
          "_viewed"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review",
      "audience": "reviewer",
      "file": "app/review/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/release",
      "audience": "reviewer",
      "file": "app/review/release/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewer(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewer(",
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/status",
      "audience": "reviewer",
      "file": "app/review/status/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/clinical",
      "audience": "reviewer",
      "file": "app/review/clinical/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewer(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewer(",
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/safety",
      "audience": "reviewer",
      "file": "app/review/safety/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewer(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewer(",
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/bls",
      "audience": "reviewer",
      "file": "app/review/bls/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/autonomous",
      "audience": "reviewer",
      "file": "app/review/autonomous/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician(",
          "requireReviewAccess("
        ],
        "2": [
          "requireClinician(",
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/testing",
      "audience": "reviewer",
      "file": "app/review/testing/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireClinician(",
          "requireReviewAccess("
        ],
        "2": [
          "requireClinician(",
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/research",
      "audience": "reviewer",
      "file": "app/review/research/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewer(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewer(",
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/fairness",
      "audience": "reviewer",
      "file": "app/review/fairness/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/models",
      "audience": "reviewer",
      "file": "app/review/models/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/performance",
      "audience": "reviewer",
      "file": "app/review/performance/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/security",
      "audience": "reviewer",
      "file": "app/review/security/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/telemetry",
      "audience": "reviewer",
      "file": "app/review/telemetry/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/lineage",
      "audience": "reviewer",
      "file": "app/review/lineage/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/planning",
      "audience": "reviewer",
      "file": "app/review/planning/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/planning/[id]",
      "audience": "reviewer",
      "file": "app/review/planning/[id]/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/access",
      "audience": "reviewer",
      "file": "app/review/access/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewer(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewer(",
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/audit",
      "audience": "reviewer",
      "file": "app/review/audit/page.tsx",
      "owed": [
        1,
        2,
        5,
        8
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": [],
        "8": [
          "projectionVersion",
          "schemaVersion",
          "ProjectionMeta"
        ]
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/review/demo-data",
      "audience": "reviewer",
      "file": "app/review/demo-data/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireReviewAccess("
        ],
        "2": [
          "requireReviewAccess("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    },
    {
      "path": "/demo",
      "audience": "demo_admin",
      "file": "app/demo/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [],
        "2": [],
        "5": []
      },
      "missing": [],
      "exempt": [
        1,
        2
      ]
    },
    {
      "path": "/demo/[path]",
      "audience": "demo_admin",
      "file": "app/demo/[path]/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [],
        "2": [],
        "5": []
      },
      "missing": [],
      "exempt": [
        1,
        2
      ]
    },
    {
      "path": "/demo/scenarios",
      "audience": "demo_admin",
      "file": "app/demo/scenarios/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser("
        ],
        "2": [],
        "5": []
      },
      "missing": [],
      "exempt": [
        2
      ]
    },
    {
      "path": "/admin/demo",
      "audience": "demo_admin",
      "file": "app/admin/demo/page.tsx",
      "owed": [
        1,
        2,
        5
      ],
      "found": {
        "1": [
          "requireUser(",
          "requireDemoAdmin("
        ],
        "2": [
          "requireDemoAdmin("
        ],
        "5": []
      },
      "missing": [],
      "exempt": []
    }
  ],
  "protectedCount": 112,
  "complete": 112,
  "gapsByStep": {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
    "6": 0,
    "7": 0,
    "8": 0
  },
  "unresolved": []
};
