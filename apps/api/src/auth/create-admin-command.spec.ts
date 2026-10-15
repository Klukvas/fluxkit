import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ProblemException } from "../common/problem.js";
import { TEST_SCRYPT_PARAMS } from "../test/app.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import {
  CreateAdminUsageError,
  describeCreateAdminError,
  formatCreated,
  parseCreateAdminArgs,
  readAdminPassword,
  runCreateAdminCommand,
  type CreateAdminIo,
} from "./create-admin-command.js";
import { PasswordHasher } from "./password-hasher.js";

const STRONG = "correct horse battery staple";

function usageMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CreateAdminUsageError);
    return (error as Error).message;
  }
  throw new Error("Expected a CreateAdminUsageError but nothing was thrown");
}

async function usageMessageAsync(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(CreateAdminUsageError);
    return (error as Error).message;
  }
  throw new Error("Expected a CreateAdminUsageError but nothing was thrown");
}

describe("parseCreateAdminArgs", () => {
  it("requires --email", () => {
    expect(usageMessage(() => parseCreateAdminArgs([]))).toMatch(/--email is required/);
  });

  it("defaults the role to owner and normalizes the email", () => {
    expect(parseCreateAdminArgs(["--email", "  Boss@Example.COM "])).toEqual({
      email: "boss@example.com",
      role: "owner",
    });
  });

  it("accepts --flag=value and --flag value", () => {
    expect(parseCreateAdminArgs(["--email=a@b.co", "--role=viewer"])).toEqual({
      email: "a@b.co",
      role: "viewer",
    });
    expect(parseCreateAdminArgs(["--role", "manager", "--email", "a@b.co"])).toEqual({
      email: "a@b.co",
      role: "manager",
    });
  });

  it("rejects an unknown role and lists the valid ones", () => {
    const message = usageMessage(() =>
      parseCreateAdminArgs(["--email", "a@b.co", "--role", "god"]),
    );
    expect(message).toMatch(/owner, manager, viewer/);
  });

  it("rejects an invalid email", () => {
    expect(usageMessage(() => parseCreateAdminArgs(["--email", "not-an-email"]))).toMatch(
      /valid email/,
    );
  });

  it("rejects unknown flags, stray values and repeated flags", () => {
    expect(usageMessage(() => parseCreateAdminArgs(["--email", "a@b.co", "--force"]))).toMatch(
      /Unknown argument "--force"/,
    );
    expect(usageMessage(() => parseCreateAdminArgs(["--email", "a@b.co", "extra"]))).toMatch(
      /Unexpected argument "extra"/,
    );
    expect(
      usageMessage(() => parseCreateAdminArgs(["--email", "a@b.co", "--email", "c@d.co"])),
    ).toMatch(/--email was given more than once/);
    expect(
      usageMessage(() =>
        parseCreateAdminArgs(["--email", "a@b.co", "--role", "owner", "--role=viewer"]),
      ),
    ).toMatch(/--role was given more than once/);
  });

  it("rejects a flag without a value", () => {
    expect(usageMessage(() => parseCreateAdminArgs(["--email"]))).toMatch(/--email needs a value/);
    expect(usageMessage(() => parseCreateAdminArgs(["--email", "--role", "owner"]))).toMatch(
      /--email needs a value/,
    );
  });

  it.each([
    [["--password", "hunter2hunter2"]],
    [["--password=hunter2hunter2"]],
    [["--PASSWORD", "hunter2hunter2"]],
    [["--pass", "hunter2hunter2"]],
    [["-p", "hunter2hunter2"]],
    [["--admin-password=hunter2hunter2"]],
  ])("refuses a password argument %j and explains why without echoing the value", (extra) => {
    const message = usageMessage(() => parseCreateAdminArgs(["--email", "a@b.co", ...extra]));
    expect(message).toMatch(/process list and shell history/);
    expect(message).toMatch(/ADMIN_PASSWORD/);
    expect(message).not.toContain("hunter2");
  });

  it("refuses a password argument even when the email is missing", () => {
    expect(usageMessage(() => parseCreateAdminArgs(["--password", "x"]))).toMatch(
      /process list and shell history/,
    );
  });
});

describe("readAdminPassword", () => {
  const noAsk: CreateAdminIo["ask"] = () => {
    throw new Error("must not prompt");
  };

  it("uses ADMIN_PASSWORD without prompting, even on a terminal", async () => {
    await expect(
      readAdminPassword({ ADMIN_PASSWORD: STRONG }, { stdinIsTty: true, ask: noAsk }),
    ).resolves.toBe(STRONG);
  });

  it("fails when the variable is set but empty", async () => {
    const message = await usageMessageAsync(() =>
      readAdminPassword({ ADMIN_PASSWORD: "" }, { stdinIsTty: true, ask: noAsk }),
    );
    expect(message).toMatch(/ADMIN_PASSWORD is set but empty/);
  });

  it("fails clearly without the variable and without a terminal", async () => {
    const message = await usageMessageAsync(() =>
      readAdminPassword({}, { stdinIsTty: false, ask: noAsk }),
    );
    expect(message).toMatch(/ADMIN_PASSWORD/);
    expect(message).toMatch(/terminal/);
  });

  it("prompts twice on a terminal and returns the confirmed password", async () => {
    const questions: string[] = [];
    const answers = [STRONG, STRONG];
    const password = await readAdminPassword(
      {},
      {
        stdinIsTty: true,
        ask: async (question) => {
          questions.push(question);
          return answers.shift() ?? "";
        },
      },
    );
    expect(password).toBe(STRONG);
    expect(questions).toHaveLength(2);
  });

  it("fails when the confirmation does not match", async () => {
    const answers = [STRONG, `${STRONG}x`];
    const message = await usageMessageAsync(() =>
      readAdminPassword({}, { stdinIsTty: true, ask: async () => answers.shift() ?? "" }),
    );
    expect(message).toMatch(/do not match/);
    expect(message).not.toContain(STRONG);
  });

  it("fails on an empty prompt answer", async () => {
    const message = await usageMessageAsync(() =>
      readAdminPassword({}, { stdinIsTty: true, ask: async () => "" }),
    );
    expect(message).toMatch(/empty/);
  });
});

describe("describeCreateAdminError", () => {
  it("prints only the message of an expected error", () => {
    expect(describeCreateAdminError(new CreateAdminUsageError("Nope."))).toBe("Nope.");
  });

  it("prints a problem exception with its code", () => {
    const text = describeCreateAdminError(
      new ProblemException({ status: 422, code: "validation_failed", detail: "Bad", errors: [] }),
    );
    expect(text).toContain("validation_failed");
  });

  it("redacts secrets from an unexpected error and its causes (Drizzle puts query parameters in its message)", () => {
    const hash = "scrypt$32768$8$1$c2FsdA==$aGFzaA==";
    const driver = new Error("connection terminated");
    const wrapped = new Error(
      `Failed query: insert into admin_user params: a@b.co,${hash},${STRONG}`,
      { cause: driver },
    );
    const text = describeCreateAdminError(wrapped, [STRONG, hash]);
    expect(text).toContain("connection terminated");
    expect(text).not.toContain(STRONG);
    expect(text).not.toContain(hash);
  });
});

describe("runCreateAdminCommand (real app, real Postgres)", () => {
  const databaseUrl = requireTestDatabaseUrl();
  const env = { DATABASE_URL: databaseUrl, ADMIN_PASSWORD: STRONG };
  const io: CreateAdminIo = {
    stdinIsTty: false,
    ask: () => Promise.reject(new Error("no prompt expected")),
  };
  const options = { scrypt: TEST_SCRYPT_PARAMS };
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const prefix = "cli-test-";

  interface Row {
    id: string;
    email: string;
    role: string;
    password_hash: string;
    is_active: boolean;
  }

  async function rows(): Promise<Row[]> {
    const result = await pool.query<Row>(
      "select id, email, role, password_hash, is_active from admin_user where email like $1 order by email",
      [`${prefix}%`],
    );
    return result.rows;
  }

  async function cleanUp(): Promise<void> {
    await pool.query("delete from admin_user where email like $1", [`${prefix}%`]);
  }

  beforeAll(async () => {
    await ensureMigrated();
    await cleanUp();
  });
  afterEach(cleanUp);
  afterAll(async () => {
    await cleanUp();
    await pool.end();
  });

  it("creates an owner whose hash verifies, with the email stored lower-cased", async () => {
    const result = await runCreateAdminCommand(
      ["--email", `  ${prefix}Boss@Example.COM`],
      env,
      io,
      options,
    );
    const [row] = await rows();
    expect(row).toMatchObject({
      id: result.id,
      email: `${prefix}boss@example.com`,
      role: "owner",
      is_active: true,
    });
    expect(result).toEqual({ id: row?.id, email: `${prefix}boss@example.com`, role: "owner" });
    expect(row?.password_hash).not.toContain(STRONG);
    // The hash string carries its own parameters, so a default-parameter hasher verifies it.
    const hasher = new PasswordHasher();
    await expect(hasher.verify(STRONG, row?.password_hash ?? "")).resolves.toBe(true);
    await expect(hasher.verify("wrong password here", row?.password_hash ?? "")).resolves.toBe(
      false,
    );
  });

  it("stores the requested role", async () => {
    await runCreateAdminCommand(
      ["--email", `${prefix}v@example.com`, "--role", "viewer"],
      env,
      io,
      options,
    );
    expect((await rows())[0]?.role).toBe("viewer");
  });

  it("formats only the created line", async () => {
    const result = await runCreateAdminCommand(
      ["--email", `${prefix}p@example.com`],
      env,
      io,
      options,
    );
    const line = formatCreated(result);
    expect(line).toBe(`Created owner ${prefix}p@example.com (id ${result.id})`);
    const [row] = await rows();
    expect(line).not.toContain(STRONG);
    expect(line).not.toContain(row?.password_hash ?? "unreachable");
  });

  it("refuses an existing email (any letter case) and leaves the row untouched", async () => {
    await runCreateAdminCommand(["--email", `${prefix}dup@example.com`], env, io, options);
    const before = await rows();
    const message = await usageMessageAsync(() =>
      runCreateAdminCommand(
        ["--email", `${prefix}DUP@example.com`, "--role", "viewer"],
        { ...env, ADMIN_PASSWORD: "another long password" },
        io,
        options,
      ),
    );
    expect(message).toMatch(/already exists/);
    expect(message).not.toContain("another long password");
    expect(await rows()).toEqual(before);
  });

  it("creates nothing for a weak password", async () => {
    const message = await usageMessageAsync(() =>
      runCreateAdminCommand(
        ["--email", `${prefix}w@example.com`],
        { ...env, ADMIN_PASSWORD: "short" },
        io,
        options,
      ),
    );
    expect(message).toMatch(/at least 12 characters/);
    expect(await rows()).toHaveLength(0);
  });

  it("creates nothing when the password equals the email", async () => {
    const email = `${prefix}same@example.com`;
    await usageMessageAsync(() =>
      runCreateAdminCommand(["--email", email], { ...env, ADMIN_PASSWORD: email }, io, options),
    );
    expect(await rows()).toHaveLength(0);
  });

  it("creates nothing for a bad email, a bad role or a --password argument", async () => {
    await usageMessageAsync(() =>
      runCreateAdminCommand(["--email", `${prefix}nope`], env, io, options),
    );
    await usageMessageAsync(() =>
      runCreateAdminCommand(
        ["--email", `${prefix}r@example.com`, "--role", "root"],
        env,
        io,
        options,
      ),
    );
    await usageMessageAsync(() =>
      runCreateAdminCommand(
        ["--email", `${prefix}a@example.com`, "--password", STRONG],
        env,
        io,
        options,
      ),
    );
    expect(await rows()).toHaveLength(0);
  });

  it("uses the prompt when ADMIN_PASSWORD is absent on a terminal", async () => {
    const answers = [STRONG, STRONG];
    await runCreateAdminCommand(
      ["--email", `${prefix}t@example.com`],
      { DATABASE_URL: databaseUrl },
      { stdinIsTty: true, ask: async () => answers.shift() ?? "" },
      options,
    );
    expect(await rows()).toHaveLength(1);
  });

  it("fails without DATABASE_URL and invents no default", async () => {
    await expect(
      runCreateAdminCommand(
        ["--email", `${prefix}n@example.com`],
        { ADMIN_PASSWORD: STRONG },
        io,
        options,
      ),
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it("does not log the password or the hash through console or the standard streams", async () => {
    const captured: string[] = [];
    // Vitest replaces console, so console output does not reach process.stdout.write: spy on both.
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      }),
    );
    const stdoutWrite = process.stdout.write.bind(process.stdout);
    const stderrWrite = process.stderr.write.bind(process.stderr);
    const capture = ((chunk: string | Uint8Array) => {
      captured.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stdout.write = capture;
    process.stderr.write = capture;
    try {
      await runCreateAdminCommand(["--email", `${prefix}log@example.com`], env, io, options);
    } finally {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
      spies.forEach((spy) => spy.mockRestore());
    }
    const [row] = await rows();
    const text = captured.join("");
    expect(text).not.toContain(STRONG);
    expect(text).not.toContain(row?.password_hash ?? "unreachable");
  });
});
