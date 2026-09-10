import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Standalone Node generators, run as `node scripts/gen-*.js`. They are
    // CommonJS by the absence of `"type": "module"` in package.json, so
    // `require` is the correct call there and not a lapse — the TypeScript rule
    // that forbids it is aimed at application code that has an import graph.
    //
    // SCOPED OFF RATHER THAN THE SCRIPTS REWRITTEN, and the difference matters:
    // rewriting working document generators to satisfy a rule they are not the
    // subject of is churn that can only introduce bugs. Narrow to
    // `scripts/**/*.js` so nothing under src/ inherits the exemption.
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // A deliberately unused binding is written with a leading underscore, and
    // the rule is told so rather than the marker being deleted (handoff 09
    // §10.1: "treat stale trackers, lint debt, and runtime test restrictions
    // as distinct items").
    //
    // WHY NOT JUST REMOVE THE PARAMETER. `supportReachable<T>(_e: Envelope<T>)`
    // exists to say there is no envelope state in which support is withdrawn —
    // it takes the envelope precisely so a caller has to hold one to ask. The
    // underscore is the author saying "unused on purpose"; a warning that
    // cannot distinguish that from an oversight trains a reader to skim past
    // both, which is how the React Compiler error that WAS a real defect sat
    // unnoticed among forty-one unused-variable warnings.
    files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // k6 load scripts. Their entry point IS an anonymous default export — that
    // is the runner's contract, not a style lapse, and naming the function
    // would not change what k6 does with it.
    files: ["docs/load-test/**/*.js"],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
]);

export default eslintConfig;
