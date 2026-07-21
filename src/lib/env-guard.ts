// Production configuration guard. Two of Steady's secrets fail *silently* and
// catastrophically when unset:
//   - EMDR_SESSION_SECRET missing/default  → session tokens are forgeable
//     (anyone can mint a valid cookie for any user id).
//   - EMDR_DATA_KEY missing                → member free text is written as
//     plaintext instead of AES-256-GCM (crypto.ts passes through).
// Both "work" in dev, so a misconfigured production deploy would look healthy
// while being wide open. This guard turns those into a hard boot failure in
// production, and a loud warning everywhere else.

const DEV_SESSION_SECRET = "dev-only-secret-change-me";

export interface EnvIssue {
  level: "fatal" | "warn";
  key: string;
  message: string;
}

export function collectEnvIssues(env: NodeJS.ProcessEnv = process.env): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const isProd = env.NODE_ENV === "production";

  const sessionSecret = env.EMDR_SESSION_SECRET;
  if (!sessionSecret || sessionSecret === DEV_SESSION_SECRET) {
    issues.push({
      level: isProd ? "fatal" : "warn",
      key: "EMDR_SESSION_SECRET",
      message:
        "EMDR_SESSION_SECRET is missing or set to the dev default — session cookies would be forgeable. Set a 32+ byte random secret (openssl rand -hex 32).",
    });
  } else if (sessionSecret.length < 32) {
    issues.push({
      level: isProd ? "fatal" : "warn",
      key: "EMDR_SESSION_SECRET",
      message: "EMDR_SESSION_SECRET is shorter than 32 characters — use openssl rand -hex 32.",
    });
  }

  if (!env.EMDR_DATA_KEY) {
    issues.push({
      level: isProd ? "fatal" : "warn",
      key: "EMDR_DATA_KEY",
      message:
        "EMDR_DATA_KEY is not set — member free text (chat, notes, safety plan, screener answers) would be stored as plaintext. Set a random secret to enable AES-256-GCM at rest.",
    });
  }

  // Non-fatal in every environment: the app runs, but nightly backups are off
  // until these are configured (see docs/backups.md).
  const backupVars = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "BACKUP_AGE_RECIPIENT"];
  if (isProd && backupVars.some((v) => !env[v])) {
    issues.push({
      level: "warn",
      key: "BACKUP",
      message: "Nightly encrypted backups are OFF — set R2_* and BACKUP_AGE_RECIPIENT (docs/backups.md).",
    });
  }

  return issues;
}

/**
 * Enforce production configuration. Throws on any fatal issue so a
 * misconfigured production process refuses to boot instead of running open.
 * Called from the instrumentation register() hook.
 */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const issues = collectEnvIssues(env);
  const fatal = issues.filter((i) => i.level === "fatal");
  for (const i of issues) {
    const line = `[env-guard] ${i.level.toUpperCase()} ${i.key}: ${i.message}`;
    if (i.level === "fatal") console.error(line);
    else console.warn(line);
  }
  if (fatal.length > 0) {
    throw new Error(
      `Refusing to start: ${fatal.length} fatal configuration issue(s). Fix the EMDR_* secrets above before deploying.`
    );
  }
}
