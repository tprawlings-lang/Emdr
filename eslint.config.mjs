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
]);

export default eslintConfig;
