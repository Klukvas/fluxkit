import { NestFactory } from "@nestjs/core";
import { loadEnv } from "@fluxkit/config";
import { ROLES, isAdminRole, validateEmail, type AdminRole } from "@fluxkit/core";
import { AppModule } from "../app.module.js";
import { findPostgresError } from "../common/postgres-errors.js";
import { ProblemException } from "../common/problem.js";
import { AdminUserRepository } from "./admin-user.repository.js";
import { PasswordHasher, type ScryptParams } from "./password-hasher.js";
import { passwordPolicyErrors } from "./password-policy-errors.js";

/** The person running the command can fix this (bad input, existing user): the message is the whole output. */
export class CreateAdminUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateAdminUsageError";
  }
}

/** An unexpected failure already turned into redacted text (query parameters and secrets removed). */
export class CreateAdminFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateAdminFailure";
  }
}

export interface CreateAdminArgs {
  email: string;
  role: AdminRole;
}

export interface CreateAdminIo {
  stdinIsTty: boolean;
  /** Asks one question without echo; only called when stdin is a terminal and `ADMIN_PASSWORD` is absent. */
  ask: (question: string) => Promise<string>;
}

export interface CreateAdminResult {
  id: string;
  email: string;
  role: AdminRole;
}

export const PASSWORD_ARGUMENT_REFUSAL =
  "Passwords are not accepted as command-line arguments: arguments leak through the process list and shell history. " +
  "Set the ADMIN_PASSWORD environment variable for this command, or run it in a terminal and type the password at the prompt.";

const USAGE = "Usage: pnpm admin:create --email <address> [--role <owner|manager|viewer>]";

export function looksLikePasswordArgument(argument: string): boolean {
  if (!argument.startsWith("-")) {
    return false;
  }
  const name = argument.replace(/^-+/, "").split("=")[0]?.toLowerCase() ?? "";
  return name === "p" || name.includes("pass") || name.includes("pwd");
}

function takeValue(argv: readonly string[], index: number, name: string): [string, number] {
  const argument = argv[index] ?? "";
  const equals = argument.indexOf("=");
  if (equals !== -1) {
    return [argument.slice(equals + 1), index];
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CreateAdminUsageError(`${name} needs a value. ${USAGE}`);
  }
  return [value, index + 1];
}

/** Parses and validates the arguments. Throws `CreateAdminUsageError`; touches nothing else. */
export function parseCreateAdminArgs(argv: readonly string[]): CreateAdminArgs {
  // Checked first and on every argument, so a password typed on the command line is refused whatever else is wrong.
  if (argv.some(looksLikePasswordArgument)) {
    throw new CreateAdminUsageError(PASSWORD_ARGUMENT_REFUSAL);
  }
  const given = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    const name = argument.split("=")[0] ?? "";
    if (!argument.startsWith("--")) {
      throw new CreateAdminUsageError(`Unexpected argument "${argument}". ${USAGE}`);
    }
    if (name !== "--email" && name !== "--role") {
      throw new CreateAdminUsageError(`Unknown argument "${name}". ${USAGE}`);
    }
    if (given.has(name)) {
      throw new CreateAdminUsageError(`${name} was given more than once. ${USAGE}`);
    }
    const [value, last] = takeValue(argv, index, name);
    given.set(name, value);
    index = last;
  }

  const rawEmail = given.get("--email");
  if (rawEmail === undefined) {
    throw new CreateAdminUsageError(`--email is required. ${USAGE}`);
  }
  const email = validateEmail(rawEmail);
  if (!email.ok) {
    throw new CreateAdminUsageError("--email must be a valid email address.");
  }
  const role = given.get("--role") ?? "owner";
  if (!isAdminRole(role)) {
    throw new CreateAdminUsageError(`--role must be one of: ${ROLES.join(", ")}.`);
  }
  return { email: email.email, role };
}

/**
 * `ADMIN_PASSWORD`, else a no-echo prompt (twice, compared) on a terminal, else a clear failure.
 * The policy is checked by the caller; this function only obtains the text.
 */
export async function readAdminPassword(
  env: Readonly<Record<string, string | undefined>>,
  io: CreateAdminIo,
): Promise<string> {
  const fromEnv = env["ADMIN_PASSWORD"];
  if (fromEnv !== undefined) {
    if (fromEnv === "") {
      throw new CreateAdminUsageError(
        "ADMIN_PASSWORD is set but empty. Set it to the password, or unset it to be asked in a terminal.",
      );
    }
    return fromEnv;
  }
  if (!io.stdinIsTty) {
    throw new CreateAdminUsageError(
      "No password given: set the ADMIN_PASSWORD environment variable, or run the command in a terminal to be asked for it.",
    );
  }
  const first = await io.ask("Password: ");
  const second = await io.ask("Repeat password: ");
  if (first === "") {
    throw new CreateAdminUsageError("The password is empty.");
  }
  if (first !== second) {
    throw new CreateAdminUsageError("The two passwords do not match.");
  }
  return first;
}

export function formatCreated(result: CreateAdminResult): string {
  return `Created ${result.role} ${result.email} (id ${result.id})`;
}

function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (current, secret) => (secret === "" ? current : current.split(secret).join("[redacted]")),
    text,
  );
}

function chainOf(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== undefined; depth += 1) {
    const text = current instanceof Error ? (current.stack ?? current.message) : String(current);
    parts.push(depth === 0 ? text : `Caused by: ${text}`);
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join("\n");
}

/**
 * The text printed for a failure. Expected errors print their message alone; anything else prints the full
 * error chain, with `secrets` removed because Drizzle puts the query parameters (email, hash) into its messages.
 */
export function describeCreateAdminError(error: unknown, secrets: readonly string[] = []): string {
  if (error instanceof CreateAdminUsageError || error instanceof CreateAdminFailure) {
    return error.message;
  }
  if (error instanceof ProblemException) {
    return redact(
      `${error.code}: ${error.detail}\n${JSON.stringify(error.errors ?? [], null, 2)}`,
      secrets,
    );
  }
  return redact(chainOf(error), secrets);
}

export interface RunCreateAdminOptions {
  /** Tests only: cheap scrypt parameters. */
  scrypt?: ScryptParams;
}

/**
 * Creates one admin user. Everything that can be checked without the database is checked first, so bad input
 * never opens a connection. Never updates or deletes: an existing email is refused. The password and the hash
 * are never printed; unexpected errors are redacted before they leave this function.
 */
export async function runCreateAdminCommand(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: CreateAdminIo,
  options: RunCreateAdminOptions = {},
): Promise<CreateAdminResult> {
  const { email, role } = parseCreateAdminArgs(argv);
  const password = await readAdminPassword(env, io);
  const policyErrors = passwordPolicyErrors("password", password, email);
  if (policyErrors.length > 0) {
    throw new CreateAdminUsageError(
      `The password is not acceptable:\n${policyErrors.map((error) => `  - ${error.message}`).join("\n")}`,
    );
  }

  const config = loadEnv(env);
  const secrets = [password];
  try {
    const app = await NestFactory.createApplicationContext(
      AppModule.register({
        databaseUrl: config.databaseUrl,
        features: [],
        locale: { defaultLocale: config.defaultLocale, locales: config.locales },
        scrypt: options.scrypt,
        cleanExpiredSessionsOnBootstrap: false,
      }),
      { logger: ["error", "warn"] },
    );
    try {
      const users = app.get(AdminUserRepository, { strict: false });
      const hasher = app.get(PasswordHasher, { strict: false });
      const alreadyExists = new CreateAdminUsageError(
        `A user with the email ${email} already exists. This command never changes existing users.`,
      );
      if ((await users.findByEmail(email)) !== undefined) {
        throw alreadyExists;
      }
      const passwordHash = await hasher.hash(password);
      secrets.push(passwordHash);
      try {
        const row = await users.insert({ email, passwordHash, role });
        return { id: row.id, email: row.email, role };
      } catch (error) {
        // Another process created the same email between the check and the insert.
        if (findPostgresError(error)?.code === "23505") {
          throw alreadyExists;
        }
        throw error;
      }
    } finally {
      await app.close();
    }
  } catch (error) {
    if (error instanceof CreateAdminUsageError) {
      throw error;
    }
    throw new CreateAdminFailure(describeCreateAdminError(error, secrets));
  }
}
