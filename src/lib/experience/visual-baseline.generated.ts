// GENERATED — do not edit by hand.
//
// Recapture against a running server with:
//   BASE=http://localhost:3000 npx tsx scripts/capture-visual-baseline.ts
//
// The structural visual baseline for Package 7. See ./visual-baseline.ts for
// what it holds, and for why it is not a set of screenshots.

import type { VisualBaseline } from "./visual-baseline";

export const VISUAL_BASELINE: VisualBaseline = {
  "capturedAt": "2026-09-10T17:34:02.426Z",
  "conditions": "1280x900 with motion frozen, signed in per role, against a production build over the hermetic e2e seed (rm -rf .e2e-data && npm run demo -- reset && npm run start) — the same environment tests/e2e/visual-baseline.spec.ts compares against",
  "screens": [
    {
      "role": "member",
      "route": "/app/settings/referral",
      "headings": [
        {
          "level": 1,
          "text": "What a referral would contain"
        },
        {
          "level": 2,
          "text": "What it would contain"
        },
        {
          "level": 2,
          "text": "What it would never contain"
        },
        {
          "level": 2,
          "text": "Every consent Steady can ask for"
        }
      ],
      "landmarks": [
        "header:",
        "nav:Information layers",
        "main:",
        "section:What it would contain",
        "section:What it would never contain",
        "section:Every consent Steady can ask for",
        "footer:"
      ],
      "palette": {
        "background": [
          "rgb(243, 228, 200)",
          "rgb(251, 248, 242)"
        ],
        "text": [
          "rgb(23, 58, 50)",
          "rgb(47, 58, 51)",
          "rgb(84, 94, 83)"
        ]
      },
      "rhythm": [
        "-4px",
        "2px",
        "4px",
        "8px",
        "12px",
        "16px",
        "20px",
        "24px",
        "32px"
      ]
    },
    {
      "role": "member",
      "route": "/app/today",
      "headings": [
        {
          "level": 1,
          "text": "Hello, Alex Rivera (fictional)"
        },
        {
          "level": 2,
          "text": "Calm Place setup"
        },
        {
          "level": 2,
          "text": "Always open"
        },
        {
          "level": 2,
          "text": "Other things you can do"
        },
        {
          "level": 2,
          "text": "Recently"
        }
      ],
      "landmarks": [
        "header:",
        "nav:Member navigation",
        "main:",
        "nav:Support",
        "footer:"
      ],
      "palette": {
        "background": [
          "rgb(168, 184, 161)",
          "rgb(251, 248, 242)",
          "rgb(47, 58, 51)"
        ],
        "text": [
          "oklab(0.96 0.003 0.013 / 0.7)",
          "oklab(0.96 0.003 0.013 / 0.85)",
          "rgb(247, 241, 232)",
          "rgb(47, 58, 51)",
          "rgb(84, 94, 83)"
        ]
      },
      "rhythm": [
        "2px",
        "4px",
        "6px",
        "8px",
        "10px",
        "12px",
        "16px",
        "20px",
        "24px",
        "28px"
      ]
    },
    {
      "role": "clinician",
      "route": "/clinician/patients",
      "headings": [
        {
          "level": 1,
          "text": "Patients"
        },
        {
          "level": 2,
          "text": "A"
        },
        {
          "level": 2,
          "text": "B"
        },
        {
          "level": 2,
          "text": "C"
        },
        {
          "level": 2,
          "text": "D"
        },
        {
          "level": 2,
          "text": "E"
        },
        {
          "level": 2,
          "text": "F"
        },
        {
          "level": 2,
          "text": "G"
        },
        {
          "level": 2,
          "text": "H"
        },
        {
          "level": 2,
          "text": "I"
        },
        {
          "level": 2,
          "text": "J"
        },
        {
          "level": 2,
          "text": "K"
        },
        {
          "level": 2,
          "text": "L"
        },
        {
          "level": 2,
          "text": "M"
        },
        {
          "level": 2,
          "text": "N"
        },
        {
          "level": 2,
          "text": "O"
        },
        {
          "level": 2,
          "text": "P"
        },
        {
          "level": 2,
          "text": "R"
        },
        {
          "level": 2,
          "text": "S"
        },
        {
          "level": 2,
          "text": "T"
        },
        {
          "level": 2,
          "text": "V"
        },
        {
          "level": 2,
          "text": "Y"
        }
      ],
      "landmarks": [
        "header:",
        "nav:Information layers",
        "main:",
        "nav:Screens in this layer",
        "footer:"
      ],
      "palette": {
        "background": [
          "oklab(0.98 0.001 0.009 / 0.4)",
          "rgb(223, 233, 226)",
          "rgb(243, 228, 200)",
          "rgb(247, 241, 232)",
          "rgb(251, 248, 242)",
          "rgb(47, 58, 51)"
        ],
        "text": [
          "rgb(23, 58, 50)",
          "rgb(247, 241, 232)",
          "rgb(47, 58, 51)",
          "rgb(84, 94, 83)"
        ]
      },
      "rhythm": [
        "-8px",
        "-1px",
        "2px",
        "4px",
        "4px 12px",
        "6px",
        "8px",
        "12px",
        "14px",
        "16px",
        "20px",
        "24px",
        "32px"
      ]
    },
    {
      "role": "clinician",
      "route": "/clinician/today",
      "headings": [
        {
          "level": 1,
          "text": "Your attention queue"
        }
      ],
      "landmarks": [
        "header:",
        "nav:Steady Clinical navigation",
        "main:",
        "nav:Queue buckets",
        "footer:"
      ],
      "palette": {
        "background": [
          "oklab(0.47 0.084 0.054 / 0.15)",
          "rgb(226, 237, 241)",
          "rgb(236, 233, 226)",
          "rgb(243, 221, 216)",
          "rgb(251, 248, 242)",
          "rgb(47, 58, 51)"
        ],
        "text": [
          "rgb(138, 67, 53)",
          "rgb(23, 58, 50)",
          "rgb(247, 241, 232)",
          "rgb(47, 58, 51)",
          "rgb(55, 93, 112)",
          "rgb(84, 94, 83)"
        ]
      },
      "rhythm": [
        "2px",
        "4px",
        "4px 12px",
        "6px",
        "8px",
        "10px",
        "12px 16px",
        "12px",
        "14px",
        "16px",
        "24px",
        "32px",
        "normal 8px"
      ]
    },
    {
      "role": "organization",
      "route": "/organization/overview",
      "headings": [
        {
          "level": 1,
          "text": "Operating overview"
        },
        {
          "level": 2,
          "text": "What changed"
        }
      ],
      "landmarks": [
        "header:",
        "nav:Information layers",
        "main:",
        "nav:Screens in this layer",
        "section:Reporting scope",
        "footer:"
      ],
      "palette": {
        "background": [
          "oklab(0.908 -0.014 0.018 / 0.6)",
          "rgb(122, 81, 16)",
          "rgb(147, 165, 139)",
          "rgb(223, 233, 226)",
          "rgb(243, 221, 216)",
          "rgb(255, 253, 248)"
        ],
        "text": [
          "oklab(0.336 -0.018 0.007 / 0.8)",
          "rgb(122, 81, 16)",
          "rgb(138, 67, 53)",
          "rgb(23, 58, 50)",
          "rgb(47, 58, 51)",
          "rgb(84, 94, 83)"
        ]
      },
      "rhythm": [
        "-8px",
        "-1px",
        "2px",
        "4px",
        "6px",
        "8px 32px",
        "8px",
        "12px",
        "14px",
        "16px",
        "20px",
        "24px",
        "25.1875px"
      ]
    },
    {
      "role": "reviewer",
      "route": "/review/performance",
      "headings": [
        {
          "level": 1,
          "text": "Performance budgets"
        },
        {
          "level": 2,
          "text": "The budgets"
        },
        {
          "level": 2,
          "text": "What this does not measure"
        }
      ],
      "landmarks": [
        "header:",
        "nav:Information layers",
        "main:",
        "footer:"
      ],
      "palette": {
        "background": [
          "rgb(226, 237, 241)",
          "rgb(255, 253, 248)"
        ],
        "text": [
          "oklab(0.336 -0.018 0.007 / 0.6)",
          "oklab(0.336 -0.018 0.007 / 0.8)",
          "rgb(23, 58, 50)",
          "rgb(47, 58, 51)",
          "rgb(55, 93, 112)",
          "rgb(84, 94, 83)"
        ]
      },
      "rhythm": [
        "-8px",
        "4px",
        "8px",
        "12px",
        "16px",
        "20px",
        "24px"
      ]
    },
    {
      "role": "reviewer",
      "route": "/review/security",
      "headings": [
        {
          "level": 1,
          "text": "Access enforcement"
        },
        {
          "level": 2,
          "text": "The sequence"
        },
        {
          "level": 2,
          "text": "Open questions"
        },
        {
          "level": 2,
          "text": "Declared exemptions"
        },
        {
          "level": 2,
          "text": "Every protected route"
        }
      ],
      "landmarks": [
        "header:",
        "nav:Information layers",
        "main:",
        "footer:"
      ],
      "palette": {
        "background": [
          "oklab(0.908 -0.014 0.018 / 0.4)",
          "rgb(226, 237, 241)",
          "rgb(243, 228, 200)",
          "rgb(255, 253, 248)"
        ],
        "text": [
          "oklab(0.336 -0.018 0.007 / 0.5)",
          "oklab(0.336 -0.018 0.007 / 0.6)",
          "oklab(0.336 -0.018 0.007 / 0.7)",
          "oklab(0.336 -0.018 0.007 / 0.8)",
          "rgb(122, 81, 16)",
          "rgb(23, 58, 50)",
          "rgb(47, 58, 51)",
          "rgb(55, 93, 112)",
          "rgb(84, 94, 83)"
        ]
      },
      "rhythm": [
        "-8px",
        "-1px",
        "4px",
        "6px",
        "8px",
        "12px",
        "16px",
        "20px",
        "24px"
      ]
    },
    {
      "role": "reviewer",
      "route": "/review/telemetry",
      "headings": [
        {
          "level": 1,
          "text": "Telemetry"
        },
        {
          "level": 2,
          "text": "The catalog"
        },
        {
          "level": 2,
          "text": "Operational review"
        },
        {
          "level": 2,
          "text": "What has actually been recorded"
        },
        {
          "level": 2,
          "text": "What no signal may name"
        }
      ],
      "landmarks": [
        "header:",
        "nav:Information layers",
        "main:",
        "footer:"
      ],
      "palette": {
        "background": [
          "oklab(0.908 -0.014 0.018 / 0.4)",
          "rgb(226, 237, 241)",
          "rgb(255, 253, 248)"
        ],
        "text": [
          "oklab(0.336 -0.018 0.007 / 0.5)",
          "oklab(0.336 -0.018 0.007 / 0.6)",
          "oklab(0.336 -0.018 0.007 / 0.7)",
          "oklab(0.336 -0.018 0.007 / 0.8)",
          "rgb(23, 58, 50)",
          "rgb(47, 58, 51)",
          "rgb(55, 93, 112)",
          "rgb(84, 94, 83)"
        ]
      },
      "rhythm": [
        "-8px",
        "4px",
        "8px",
        "12px",
        "16px",
        "20px",
        "24px"
      ]
    }
  ]
};
