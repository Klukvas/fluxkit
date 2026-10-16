import { NestFactory } from "@nestjs/core";
import { loadEnv } from "@fluxkit/config";
import { validateEmail } from "@fluxkit/core";
import { AppModule } from "../app.module.js";
import { summarizeError } from "../common/error-summary.js";
import { withTransaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { AdminUserRepository } from "./admin-user.repository.js";
import { looksLikePasswordArgument } from "./create-admin-command.js";

/** The person running the command can fix this (bad input, unknown user): the message is the whole output. */
export class UnlockAdminUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnlockAdminUsageError";
  }
}

/** An unexpected failure already turned into text without SQL or parameters. */
export class UnlockAdminFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnlockAdminFailure";
  }
}

export interface UnlockAdminResult {
  email: string;
  /** `unlocked`: the failure counter or the lock was cleared. `not_locked`: there was nothing to clear. */
  outcome: "unlocked" | "not_locked";
}

const USAGE = "Usage: pnpm admin:unlock --email <address>";

const PASSWORD_ARGUMENT_REFUSAL =
  "This command needs no password, and passwords are never accepted as command-line arguments: " +
  "arguments leak through the process list and shell history. " +
  USAGE;

/** Parses and validates the arguments. Throws `UnlockAdminUsageError`; touches nothing else. */
export function parseUnlockAdminArgs(argv: readonly string[]): { email: string } {
  // Checked first and on every argument, like admin:create: a password never belongs on a command line.
  if (argv.some(looksLikePasswordArgument)) {
    throw new UnlockAdminUsageError(PASSWORD_ARGUMENT_REFUSAL);
  }
  let rawEmail: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    const name = argument.split("=")[0] ?? "";
    if (!argument.startsWith("--")) {
      throw new UnlockAdminUsageError(`Unexpected argument "${argument}". ${USAGE}`);
    }
    if (name !== "--email") {
      throw new UnlockAdminUsageError(`Unknown argument "${name}". ${USAGE}`);
    }
    if (rawEmail !== undefined) {
      throw new UnlockAdminUsageError(`--email was given more than once. ${USAGE}`);
    }
    const equals = argument.indexOf("=");
    if (equals !== -1) {
      rawEmail = argument.slice(equals + 1);
    } else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UnlockAdminUsageError(`--email needs a value. ${USAGE}`);
      }
      rawEmail = value;
      index += 1;
    }
  }
  if (rawEmail === undefined) {
    throw new UnlockAdminUsageError(`--email is required. ${USAGE}`);
  }
  const email = validateEmail(rawEmail);
  if (!email.ok) {
    throw new UnlockAdminUsageError("--email must be a valid email address.");
  }
  // Normalized exactly as login looks the account up (trim, lower case).
  return { email: email.email };
}

export function formatUnlocked(result: UnlockAdminResult): string {
  return result.outcome === "unlocked"
    ? `Unlocked ${result.email}`
    : `${result.email} was not locked`;
}

/** The text printed for a failure: usage errors print their message alone, anything else only class names and a code. */
export function describeUnlockAdminError(error: unknown): string {
  if (error instanceof UnlockAdminUsageError || error instanceof UnlockAdminFailure) {
    return error.message;
  }
  return summarizeError(error);
}

/**
 * Clears the failed-login counter and the lock of one admin account (`failed_login_count = 0`,
 * `locked_until = null`) and nothing else: never the password, the role, the active flag or the sessions. The
 * account is read and written under its row lock, so a login in flight cannot interleave. Bad input is rejected
 * before a database connection is opened.
 */
export async function runUnlockAdminCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<UnlockAdminResult> {
  const { email } = parseUnlockAdminArgs(argv);
  let config: ReturnType<typeof loadEnv>;
  try {
    config = loadEnv(env);
  } catch (error) {
    // The message lists variable names and the rule they broke (no values): it is what the operator needs.
    throw new UnlockAdminUsageError(
      error instanceof Error ? error.message : "Invalid environment.",
    );
  }
  try {
    const app = await NestFactory.createApplicationContext(
      AppModule.register({
        databaseUrl: config.databaseUrl,
        features: [],
        locale: { defaultLocale: config.defaultLocale, locales: config.locales },
        cleanExpiredSessionsOnBootstrap: false,
      }),
      { logger: ["error", "warn"] },
    );
    try {
      const users = app.get(AdminUserRepository, { strict: false });
      const database = app.get<Database>(DRIZZLE, { strict: false });
      return await withTransaction(database, async (transaction) => {
        const found = await users.findByEmail(email, transaction);
        if (found === undefined) {
          throw new UnlockAdminUsageError(`No admin user with the email ${email}.`);
        }
        const row = await users.findByIdForUpdate(found.id, transaction);
        if (row === undefined) {
          throw new UnlockAdminUsageError(`No admin user with the email ${email}.`);
        }
        if (row.failedLoginCount === 0 && row.lockedUntil === null) {
          return { email, outcome: "not_locked" as const };
        }
        await users.update(row.id, { failedLoginCount: 0, lockedUntil: null }, transaction);
        return { email, outcome: "unlocked" as const };
      });
    } finally {
      await app.close();
    }
  } catch (error) {
    if (error instanceof UnlockAdminUsageError) {
      throw error;
    }
    throw new UnlockAdminFailure(summarizeError(error));
  }
}
