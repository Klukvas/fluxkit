import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "node:http";
import { inArray } from "drizzle-orm";
import { permissionsOf, type AdminRole } from "@fluxkit/core";
import type { AdminAuthenticator, AdminPrincipal } from "../auth/admin-authenticator.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { mediaUpload } from "../database/schema/index.js";
import { createTestAdminUser, deleteTestAdminUsers } from "./admin-user-fixtures.js";
import { startApp, type RunningApp, type StartAppOptions } from "./app.js";

/** TEST ONLY: the public base URL the media specs configure; the files are fetched from the test server's `/media`. */
export const TEST_MEDIA_BASE_URL = "https://shop.example.test/media";

/** The header that picks the signed-in admin of a request in the media specs (`TestAdmins`). */
export const TEST_ADMIN_HEADER = "x-test-admin";

/**
 * TEST ONLY. Real `admin_user` rows (uploads reference their creator by foreign key) and an authenticator that signs a
 * request in as the one named by `x-test-admin` (`owner` when absent, nobody for `anonymous`).
 */
export class TestAdmins implements AdminAuthenticator {
  private readonly principals = new Map<string, AdminPrincipal>();
  private readonly ids: string[] = [];

  async create(db: Database, name: string, role: AdminRole): Promise<AdminPrincipal> {
    const user = await createTestAdminUser(db, { role });
    const principal: AdminPrincipal = {
      userId: user.id,
      email: user.email,
      role,
      permissions: permissionsOf(role),
      sessionId: `00000000-0000-4000-8000-${String(this.ids.length).padStart(12, "0")}`,
    };
    this.principals.set(name, principal);
    this.ids.push(user.id);
    return principal;
  }

  /** A principal whose user does not exist in `admin_user` (makes the upload row's insert fail). */
  addGhost(name: string): void {
    this.principals.set(name, {
      userId: "00000000-0000-4000-8000-00000000dead",
      email: "ghost@example.test",
      role: "owner",
      permissions: permissionsOf("owner"),
      sessionId: "00000000-0000-4000-8000-00000000beef",
    });
  }

  authenticate(incoming: { headers: Record<string, unknown> }): AdminPrincipal | undefined {
    const name = incoming.headers[TEST_ADMIN_HEADER];
    return this.principals.get(typeof name === "string" ? name : "owner");
  }

  /** Deletes the users and every upload they made (the rows; the files go with the temp directory). */
  async deleteAll(db: Database): Promise<void> {
    if (this.ids.length > 0) {
      await db.delete(mediaUpload).where(inArray(mediaUpload.createdBy, this.ids));
    }
    await deleteTestAdminUsers(db, this.ids);
  }
}

export interface MediaApp extends RunningApp {
  mediaDir: string;
  db: Database;
  admins: TestAdmins;
  close: () => Promise<void>;
}

/** TEST ONLY: an app with the local media driver in a fresh temp directory, and an owner, a manager and a viewer. */
export async function startMediaApp(options: StartAppOptions = {}): Promise<MediaApp> {
  const mediaDir = await mkdtemp(join(tmpdir(), "fluxkit-media-spec-"));
  const admins = new TestAdmins();
  const running = await startApp({
    adminAuthenticator: admins,
    mediaStorageDriver: "local",
    mediaDir,
    mediaPublicBaseUrl: TEST_MEDIA_BASE_URL,
    ...options,
  });
  const db = running.app.get<Database>(DRIZZLE);
  await admins.create(db, "owner", "owner");
  await admins.create(db, "manager", "manager");
  await admins.create(db, "viewer", "viewer");
  return {
    ...running,
    mediaDir,
    db,
    admins,
    close: async () => {
      try {
        await admins.deleteAll(db);
      } finally {
        await running.app.close();
        await rm(mediaDir, { recursive: true, force: true });
      }
    },
  };
}

/** Every regular file under the media directory, relative to it (the `.tmp` entries included). */
export async function filesUnder(mediaDir: string): Promise<string[]> {
  const entries = await readdir(mediaDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(mediaDir.length + 1))
    .sort();
}

export interface RawResult {
  status: number;
  headers: request.IncomingHttpHeaders;
  body: Buffer;
}

/**
 * Sends a request with node:http so a spec controls exactly what goes on the wire (no Content-Length, chunked, a path
 * that fetch would normalize). `body` undefined sends no body at all.
 */
export function rawRequest(
  baseUrl: string,
  method: string,
  path: string,
  headers: Record<string, string | number>,
  body?: Buffer | Buffer[],
): Promise<RawResult> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const outgoing = request.request(
      { host: url.hostname, port: url.port, method, path, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    outgoing.on("error", reject);
    if (Array.isArray(body)) {
      for (const chunk of body) outgoing.write(chunk);
      outgoing.end();
    } else {
      outgoing.end(body);
    }
  });
}
