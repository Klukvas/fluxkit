import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { adminUser, customer } from "../../database/schema/index.js";
import { createTestAdminUser, deleteTestAdminUsers } from "../../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { loginCookie } from "../../test/auth-http.js";
import {
  createTestCustomer,
  deleteTestCustomers,
  type TestCustomer,
} from "../../test/customer-fixtures.js";
import { customerCookieOf, customerLogin } from "../../test/customer-http.js";
import { FakeClock } from "../../test/fake-clock.js";
import { http, type HttpResult } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new passphrase";
const WRONG = "definitely not the password";
const UNKNOWN_EMAIL = "secret-unknown-person@example.test";

describe("secrets and personal data stay out of logs, tables and responses", () => {
  const clock = new FakeClock("2030-08-01T08:00:00.000Z");
  let running: RunningApp;
  let db: Database;
  const customers: string[] = [];
  const admins: string[] = [];
  let output: string[] = [];

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default", clock });
    db = running.app.get<Database>(DRIZZLE);
    // Every line the process prints, whichever logger wrote it (Nest's console logger writes to stdout and stderr).
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, "write").mockImplementation(((chunk: string | Uint8Array) => {
        output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }) as typeof stream.write);
    }
  });

  afterEach(async () => {
    await deleteTestCustomers(db, customers.splice(0));
    await deleteTestAdminUsers(db, admins.splice(0));
    clock.advanceMinutes(61);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await running.app.close();
  });

  const post = (path: string, body: unknown, cookie?: string) =>
    http<Record<string, unknown>>(running.baseUrl, "POST", path, {
      body,
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    });

  it("a failed login and a register conflict log no email, password, token or hash", async () => {
    const shopper: TestCustomer = await createTestCustomer(db, { password: PASSWORD });
    customers.push(shopper.id);
    output = [];

    const wrong = await customerLogin(running.baseUrl, shopper.email, WRONG);
    const unknown = await customerLogin(running.baseUrl, UNKNOWN_EMAIL, WRONG);
    const conflict = await post("/store/account/register", {
      email: shopper.email.toUpperCase(),
      password: NEW_PASSWORD,
      firstName: "Secret",
      lastName: "Surname",
      phone: "0501234567",
    });
    const invalid = await post("/store/account/register", {
      email: "not an email",
      password: "short",
      firstName: "Secret",
      lastName: "Surname",
    });
    expect([wrong.status, unknown.status, conflict.status, invalid.status]).toEqual([
      401, 401, 409, 400,
    ]);

    const printed = output.join("");
    // The logger did speak (reason codes), so the absence below is meaningful.
    expect(printed).toContain("Customer login refused: wrong_password");
    expect(printed).toContain("Customer login refused: unknown_account");
    const [hash] = (
      await db
        .select({ hash: customer.passwordHash })
        .from(customer)
        .where(eq(customer.id, shopper.id))
    ).map((row) => row.hash);
    for (const secret of [
      shopper.email,
      shopper.email.toUpperCase(),
      UNKNOWN_EMAIL,
      shopper.email.split("@")[0] ?? "",
      PASSWORD,
      WRONG,
      NEW_PASSWORD,
      "Surname",
      "0501234567",
      "scrypt$",
      hash ?? "unreachable",
    ]) {
      expect(printed, `log output must not contain ${secret.slice(0, 14)}`).not.toContain(secret);
    }
  });

  it("successful sign-ins, logout and change-password log no token, password or email either", async () => {
    const shopper = await createTestCustomer(db, { password: PASSWORD });
    customers.push(shopper.id);
    output = [];
    const login = await customerLogin(running.baseUrl, shopper.email, PASSWORD);
    const cookie = customerCookieOf(login) ?? "";
    const token = cookie.replace("fluxkit_customer_session=", "");
    await post(
      "/store/account/change-password",
      { currentPassword: WRONG, newPassword: NEW_PASSWORD },
      cookie,
    );
    await post(
      "/store/account/change-password",
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      cookie,
    );
    await post("/store/account/logout", undefined, cookie);
    const printed = output.join("");
    for (const secret of [token, shopper.email, PASSWORD, WRONG, NEW_PASSWORD]) {
      expect(printed, secret.slice(0, 14)).not.toContain(secret);
    }
  });

  it("the raw token and the clear-text passwords appear in no column of the customer tables", async () => {
    const registered = await post("/store/account/register", {
      email: "tables-check@example.test",
      password: PASSWORD,
      firstName: "Olena",
      lastName: "Tables",
    });
    customers.push(String((registered.body["customer"] as { id: string }).id));
    const token = (customerCookieOf(registered) ?? "").replace("fluxkit_customer_session=", "");
    expect(token).toHaveLength(43);
    await post(
      "/store/account/change-password",
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      customerCookieOf(registered),
    );
    const login = await customerLogin(running.baseUrl, "tables-check@example.test", NEW_PASSWORD);
    const secondToken = (customerCookieOf(login) ?? "").replace("fluxkit_customer_session=", "");

    // Every row of every table that can hold customer data, as text.
    const dump = await db.execute<{ row: string }>(sql`
      select row_to_json(t)::text as row from customer t
      union all select row_to_json(t)::text from customer_session t
      union all select row_to_json(t)::text from sales_order t
      union all select row_to_json(t)::text from domain_event t
    `);
    const text = dump.rows.map((row) => row.row).join("\n");
    expect(text).toContain("tables-check@example.test");
    for (const secret of [token, secondToken, PASSWORD, NEW_PASSWORD]) {
      expect(text, secret.slice(0, 14)).not.toContain(secret);
    }
  });

  it("customer password hashes have the scrypt format of admin users, with the same parameters", async () => {
    const admin = await createTestAdminUser(db, { role: "owner", password: PASSWORD });
    admins.push(admin.id);
    const registered = await post("/store/account/register", {
      email: "format-check@example.test",
      password: PASSWORD,
      firstName: "Olena",
      lastName: "Format",
    });
    customers.push(String((registered.body["customer"] as { id: string }).id));
    const [customerRow] = await db
      .select({ hash: customer.passwordHash })
      .from(customer)
      .where(eq(customer.email, "format-check@example.test"));
    const [adminRow] = await db
      .select({ hash: adminUser.passwordHash })
      .from(adminUser)
      .where(eq(adminUser.id, admin.id));
    const shape = (hash: string | undefined) => {
      const parts = (hash ?? "").split("$");
      return {
        count: parts.length,
        prefix: parts[0],
        params: parts.slice(1, 4),
        saltLength: parts[4]?.length,
        keyLength: parts[5]?.length,
      };
    };
    expect(shape(customerRow?.hash)).toEqual({
      count: 6,
      prefix: "scrypt",
      params: ["16", "8", "1"],
      saltLength: 24,
      keyLength: 88,
    });
    expect(shape(customerRow?.hash)).toEqual(shape(adminRow?.hash));
    // Same password, different salts: the stored strings differ.
    expect(customerRow?.hash).not.toBe(adminRow?.hash);
  });

  it("no account response (store or admin) contains a hash, a password or another customer's data", async () => {
    const admin = await createTestAdminUser(db, { role: "owner", password: PASSWORD });
    admins.push(admin.id);
    const adminCookie = await loginCookie(running.baseUrl, admin.email, PASSWORD);
    const other = await createTestCustomer(db, { password: PASSWORD });
    customers.push(other.id);

    const seen: { name: string; result: HttpResult }[] = [];
    const run = async (name: string, promise: Promise<HttpResult>): Promise<HttpResult> => {
      const result = await promise;
      seen.push({ name, result });
      return result;
    };
    const registered = await run(
      "register",
      post("/store/account/register", {
        email: "wire-check@example.test",
        password: PASSWORD,
        firstName: "Olena",
        lastName: "Wire",
      }),
    );
    const cookie = customerCookieOf(registered) ?? "";
    const id = String((registered.body as { customer: { id: string } }).customer.id);
    customers.push(id);
    const asCustomer = (method: "GET" | "PATCH" | "POST", path: string, body?: unknown) =>
      http<Record<string, unknown>>(running.baseUrl, method, path, {
        ...(body === undefined ? {} : { body }),
        headers: { cookie },
      });
    await run("me", asCustomer("GET", "/store/account/me"));
    await run("patch", asCustomer("PATCH", "/store/account/me", { lastName: "Wire2" }));
    await run("patch bad", asCustomer("PATCH", "/store/account/me", { passwordHash: "x" }));
    await run(
      "change wrong",
      asCustomer("POST", "/store/account/change-password", {
        currentPassword: WRONG,
        newPassword: NEW_PASSWORD,
      }),
    );
    await run(
      "login",
      Promise.resolve(await customerLogin(running.baseUrl, "wire-check@example.test", PASSWORD)),
    );
    await run(
      "login wrong",
      Promise.resolve(await customerLogin(running.baseUrl, "wire-check@example.test", WRONG)),
    );
    const adminGet = (path: string) =>
      run(path, http(running.baseUrl, "GET", path, { headers: { cookie: adminCookie } }));
    await adminGet("/admin/customers");
    await adminGet(`/admin/customers/${id}`);
    await adminGet(`/admin/customers/${other.id}`);
    await run(
      "admin patch",
      http(running.baseUrl, "PATCH", `/admin/customers/${id}`, {
        body: { isActive: true },
        headers: { cookie: adminCookie },
      }),
    );

    const hashes = (await db.select({ hash: customer.passwordHash }).from(customer)).map(
      (row) => row.hash,
    );
    expect(hashes.length).toBeGreaterThanOrEqual(2);
    expect(seen.length).toBe(11);
    for (const { name, result } of seen) {
      const text = JSON.stringify(result.body ?? null) + JSON.stringify([...result.headers]);
      for (const fragment of [...hashes, "scrypt$", PASSWORD, NEW_PASSWORD, WRONG]) {
        expect(text, `${name} must not contain ${fragment.slice(0, 12)}`).not.toContain(fragment);
      }
      if (name.startsWith("/admin") === false && name !== "admin patch") {
        expect(text, `${name} must not show another customer`).not.toContain(other.email);
      }
    }
  });
});
