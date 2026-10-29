import { randomUUID } from "node:crypto";
import { permissionsOf } from "@fluxkit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { testPrincipal } from "../../test/allow-all-admin-authenticator.js";
import {
  createTestAdminUser,
  deleteTestAdminUsers,
  type TestAdminUser,
} from "../../test/admin-user-fixtures.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { createTestCustomer, deleteTestCustomers } from "../../test/customer-fixtures.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { AdminAuditWriter } from "./admin-audit.writer.js";

interface AuditEvent {
  id: string;
  createdAt: string;
  adminUserId: string | null;
  action: string;
  targetKind: string;
  targetId: string;
  detail: Record<string, unknown>;
}
interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

describe("admin audit log (ADR 0033 decision 9, privacy plan step 5)", () => {
  let actor: TestAdminUser;
  /** Signed in as a REAL owner row, so the audit row keeps the actor id. */
  let owner: RunningApp;
  let manager: RunningApp;
  let viewer: RunningApp;
  let anonymous: RunningApp;
  let db: Database;
  const customers: string[] = [];
  const admins: string[] = [];

  beforeAll(async () => {
    await ensureMigrated();
    viewer = await startApp({ adminPrincipal: { role: "viewer" } });
    db = viewer.app.get<Database>(DRIZZLE);
    actor = await createTestAdminUser(db, { role: "owner" });
    admins.push(actor.id);
    owner = await startApp({
      adminAuthenticator: {
        authenticate: () => ({
          ...testPrincipal("owner"),
          userId: actor.id,
          email: actor.email,
          permissions: permissionsOf("owner"),
        }),
      },
    });
    manager = await startApp({ adminPrincipal: { role: "manager" } });
    anonymous = await startApp({ adminAuthenticator: "production-default" });
  });

  afterAll(async () => {
    await deleteTestCustomers(db, customers);
    await deleteTestAdminUsers(db, admins);
    for (const started of [owner, manager, viewer, anonymous]) {
      await started.app.close();
    }
  });

  async function eventsOf(targetId: string): Promise<AuditEvent[]> {
    const result = await http<Page<AuditEvent>>(
      owner.baseUrl,
      "GET",
      `/admin/audit-events?targetId=${targetId}`,
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    // Oldest first for readable assertions (the route answers newest first).
    return [...result.body.items].reverse();
  }

  async function newCustomer(): Promise<string> {
    const made = await createTestCustomer(db, {});
    customers.push(made.id);
    return made.id;
  }

  async function newAdmin(role: "owner" | "manager" | "viewer" = "viewer"): Promise<TestAdminUser> {
    const made = await createTestAdminUser(db, { role });
    admins.push(made.id);
    return made;
  }

  describe("writes of customer management", () => {
    it("records deactivate, activate and unlock with the actor and the customer, nothing else", async () => {
      const id = await newCustomer();
      for (const isActive of [false, true]) {
        const result = await http(owner.baseUrl, "PATCH", `/admin/customers/${id}`, {
          body: { isActive },
        });
        expect(result.status).toBe(200);
      }
      expect((await http(owner.baseUrl, "POST", `/admin/customers/${id}/unlock`)).status).toBe(204);
      const events = await eventsOf(id);
      expect(
        events.map(({ action, targetKind, adminUserId, detail }) => ({
          action,
          targetKind,
          adminUserId,
          detail,
        })),
      ).toEqual([
        {
          action: "customer.deactivated",
          targetKind: "customer",
          adminUserId: actor.id,
          detail: {},
        },
        { action: "customer.activated", targetKind: "customer", adminUserId: actor.id, detail: {} },
        { action: "customer.unlocked", targetKind: "customer", adminUserId: actor.id, detail: {} },
      ]);
    });

    it("records nothing for a refused change (unknown customer, invalid body)", async () => {
      const missing = randomUUID();
      expect(
        (
          await http(owner.baseUrl, "PATCH", `/admin/customers/${missing}`, {
            body: { isActive: false },
          })
        ).status,
      ).toBe(404);
      expect((await http(owner.baseUrl, "POST", `/admin/customers/${missing}/unlock`)).status).toBe(
        404,
      );
      const id = await newCustomer();
      expect(
        (await http(owner.baseUrl, "PATCH", `/admin/customers/${id}`, { body: { isActive: "no" } }))
          .status,
      ).toBe(400);
      expect(await eventsOf(missing)).toEqual([]);
      expect(await eventsOf(id)).toEqual([]);
    });
  });

  describe("writes of admin user management", () => {
    it("records create, role change, deactivation and password reset; the detail holds codes only", async () => {
      const email = `audit-created-${randomUUID()}@example.test`;
      const created = await http<{ id: string }>(owner.baseUrl, "POST", "/admin/users", {
        body: { email, password: "a long enough password 1", role: "viewer" },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.id;
      admins.push(id);
      expect(
        (await http(owner.baseUrl, "PATCH", `/admin/users/${id}`, { body: { role: "manager" } }))
          .status,
      ).toBe(200);
      expect(
        (await http(owner.baseUrl, "PATCH", `/admin/users/${id}`, { body: { isActive: false } }))
          .status,
      ).toBe(200);
      expect(
        (
          await http(owner.baseUrl, "POST", `/admin/users/${id}/reset-password`, {
            body: { newPassword: "another long password 2" },
          })
        ).status,
      ).toBe(204);
      const events = await eventsOf(id);
      expect(
        events.map(({ action, targetKind, adminUserId, detail }) => ({
          action,
          targetKind,
          adminUserId,
          detail,
        })),
      ).toEqual([
        {
          action: "admin_user.created",
          targetKind: "admin_user",
          adminUserId: actor.id,
          detail: { role: "viewer" },
        },
        {
          action: "admin_user.role_changed",
          targetKind: "admin_user",
          adminUserId: actor.id,
          detail: { fromRole: "viewer", toRole: "manager" },
        },
        {
          action: "admin_user.deactivated",
          targetKind: "admin_user",
          adminUserId: actor.id,
          detail: {},
        },
        {
          action: "admin_user.password_reset",
          targetKind: "admin_user",
          adminUserId: actor.id,
          detail: {},
        },
      ]);
      expect(JSON.stringify(events)).not.toContain(email);
    });

    it("records one event per changed field and none for an unchanged value", async () => {
      const target = await newAdmin("viewer");
      expect(
        (
          await http(owner.baseUrl, "PATCH", `/admin/users/${target.id}`, {
            body: { role: "manager", isActive: false },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await http(owner.baseUrl, "PATCH", `/admin/users/${target.id}`, {
            body: { role: "manager" },
          })
        ).status,
      ).toBe(200);
      // Deactivating an already inactive user changes nothing and records nothing (review F6, M10).
      expect(
        (
          await http(owner.baseUrl, "PATCH", `/admin/users/${target.id}`, {
            body: { isActive: false },
          })
        ).status,
      ).toBe(200);
      expect((await eventsOf(target.id)).map((event) => event.action)).toEqual([
        "admin_user.role_changed",
        "admin_user.deactivated",
      ]);
    });

    it("records nothing when the change is refused (validation, unknown user)", async () => {
      const target = await newAdmin("viewer");
      expect(
        (
          await http(owner.baseUrl, "POST", `/admin/users/${target.id}/reset-password`, {
            body: { newPassword: "short" },
          })
        ).status,
      ).toBe(400);
      const missing = randomUUID();
      expect(
        (
          await http(owner.baseUrl, "PATCH", `/admin/users/${missing}`, {
            body: { role: "manager" },
          })
        ).status,
      ).toBe(404);
      expect(await eventsOf(target.id)).toEqual([]);
      expect(await eventsOf(missing)).toEqual([]);
    });
  });

  describe("GET /admin/audit-events", () => {
    it("is for users.manage only (owner); manager, viewer and anonymous are refused", async () => {
      expect((await http(owner.baseUrl, "GET", "/admin/audit-events")).status).toBe(200);
      expect((await http(manager.baseUrl, "GET", "/admin/audit-events")).status).toBe(403);
      expect((await http(viewer.baseUrl, "GET", "/admin/audit-events")).status).toBe(403);
      expect((await http(anonymous.baseUrl, "GET", "/admin/audit-events")).status).toBe(401);
    });

    it("lists newest first, pages and filters by action, actor, target and time", async () => {
      const id = await newCustomer();
      for (const isActive of [false, true, false]) {
        await http(owner.baseUrl, "PATCH", `/admin/customers/${id}`, { body: { isActive } });
      }
      const all = await http<Page<AuditEvent>>(
        owner.baseUrl,
        "GET",
        `/admin/audit-events?targetKind=customer&targetId=${id}&limit=2`,
      );
      expect(all.body.total).toBe(3);
      expect(all.body.items.map((event) => event.action)).toEqual([
        "customer.deactivated",
        "customer.activated",
      ]);
      const [newest, middle] = all.body.items;
      expect(Date.parse(newest?.createdAt ?? "")).toBeGreaterThanOrEqual(
        Date.parse(middle?.createdAt ?? ""),
      );
      const second = await http<Page<AuditEvent>>(
        owner.baseUrl,
        "GET",
        `/admin/audit-events?targetId=${id}&limit=2&offset=2`,
      );
      expect(second.body.items.map((event) => event.action)).toEqual(["customer.deactivated"]);
      const activated = await http<Page<AuditEvent>>(
        owner.baseUrl,
        "GET",
        `/admin/audit-events?targetId=${id}&action=customer.activated&adminUserId=${actor.id}`,
      );
      expect(activated.body.total).toBe(1);
      const otherActor = await http<Page<AuditEvent>>(
        owner.baseUrl,
        "GET",
        `/admin/audit-events?targetId=${id}&adminUserId=${randomUUID()}`,
      );
      expect(otherActor.body.total).toBe(0);
      const from = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
      const future = await http<Page<AuditEvent>>(
        owner.baseUrl,
        "GET",
        `/admin/audit-events?targetId=${id}&from=${from}`,
      );
      expect(future.body.total).toBe(0);
      const to = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
      const until = await http<Page<AuditEvent>>(
        owner.baseUrl,
        "GET",
        `/admin/audit-events?targetId=${id}&to=${to}`,
      );
      expect(until.body.total).toBe(3);
    });

    it("refuses unknown filters, actions, kinds, ids and an inverted range with 400", async () => {
      for (const query of [
        "?q=x",
        "?action=customer.viewed",
        "?targetKind=email",
        "?targetId=not-a-uuid",
        "?adminUserId=1",
        "?from=yesterday",
        "?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z",
        "?limit=0",
      ]) {
        const result = await http(owner.baseUrl, "GET", `/admin/audit-events${query}`);
        expect(result.status, query).toBe(400);
      }
    });

    it("has no write route", async () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        const result = await http(owner.baseUrl, method, "/admin/audit-events", { body: {} });
        expect([403, 404, 405], method).toContain(result.status);
        expect(result.status, method).not.toBe(200);
      }
    });
  });

  describe("the writer", () => {
    it("refuses personal data in the detail (core rule) and writes nothing", async () => {
      const writer = owner.app.get(AdminAuditWriter);
      const target = randomUUID();
      await expect(
        writer.record(db, actor.id, {
          action: "customer.unlocked",
          targetKind: "customer",
          targetId: target,
          detail: { email: "someone@example.test" },
        }),
      ).rejects.toThrow(RangeError);
      expect(await eventsOf(target)).toEqual([]);
    });

    it("stores no actor for an admin id without a row (the foreign key's SET NULL)", async () => {
      const writer = owner.app.get(AdminAuditWriter);
      const target = randomUUID();
      await writer.record(db, randomUUID(), {
        action: "customer.unlocked",
        targetKind: "customer",
        targetId: target,
      });
      expect((await eventsOf(target)).map((event) => event.adminUserId)).toEqual([null]);
    });

    it("keeps the event when its actor is deleted, with the actor set to NULL", async () => {
      const gone = await newAdmin("owner");
      const writer = owner.app.get(AdminAuditWriter);
      const target = randomUUID();
      await writer.record(db, gone.id, {
        action: "customer.unlocked",
        targetKind: "customer",
        targetId: target,
      });
      await deleteTestAdminUsers(db, [gone.id]);
      expect((await eventsOf(target)).map((event) => event.adminUserId)).toEqual([null]);
    });
  });
});
