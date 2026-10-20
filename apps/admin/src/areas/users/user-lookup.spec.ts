import {
  NetworkError,
  type AdminResult,
  type AdminUser,
  type AdminUserList,
} from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { LOOKUP_MAX_PAGES, LOOKUP_PAGE_SIZE, findUserByEmail } from "./user-lookup";

function user(index: number): AdminUser {
  return {
    id: `id-${String(index)}`,
    email: `user${String(index).padStart(4, "0")}@example.com`,
    role: "viewer",
    isActive: true,
    lastLoginAt: null,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
  };
}

function lister(total: number) {
  const offsets: number[] = [];
  const list = (offset: number): Promise<AdminResult<AdminUserList>> => {
    offsets.push(offset);
    const items = Array.from(
      { length: Math.max(0, Math.min(LOOKUP_PAGE_SIZE, total - offset)) },
      (_, index) => user(offset + index),
    );
    return Promise.resolve({
      ok: true,
      status: 200,
      data: { items, total, limit: LOOKUP_PAGE_SIZE, offset },
    });
  };
  return { list, offsets };
}

describe("looking up a user by email after a lost create answer (reads only)", () => {
  it("finds a stored user by the email as the API stores it, reading page by page", async () => {
    const { list, offsets } = lister(250);
    const found = await findUserByEmail(" USER0230@example.com ", list);
    expect(found).toEqual({ kind: "found", user: user(230) });
    expect(offsets).toEqual([0, 100, 200]);
  });

  it("says absent after reading every user, and stops at the end", async () => {
    const { list, offsets } = lister(150);
    expect(await findUserByEmail("nobody@example.com", list)).toEqual({ kind: "absent" });
    expect(offsets).toEqual([0, 100]);
  });

  it("is bounded: at most 10 pages of 100, then it says it could not check them all", async () => {
    expect(LOOKUP_MAX_PAGES).toBe(10);
    expect(LOOKUP_PAGE_SIZE).toBe(100);
    const { list, offsets } = lister(5000);
    expect(await findUserByEmail("nobody@example.com", list)).toEqual({ kind: "notChecked" });
    expect(offsets).toHaveLength(10);
  });

  it("is unreadable when a page fails or is refused, and never throws a lost connection", async () => {
    const refused = () =>
      Promise.resolve<AdminResult<AdminUserList>>({
        ok: false,
        status: 403,
        problem: {
          type: "about:blank",
          title: "x",
          status: 403,
          code: "forbidden",
          detail: "x",
        },
        retryAfter: null,
      });
    expect(await findUserByEmail("a@b.c", refused)).toEqual({ kind: "unreadable" });
    const lost = () => Promise.reject(new NetworkError("offline", { cause: null, aborted: false }));
    expect(await findUserByEmail("a@b.c", lost)).toEqual({ kind: "unreadable" });
  });

  it("throws a bug instead of hiding it", async () => {
    const broken = () => Promise.reject(new TypeError("bug"));
    await expect(findUserByEmail("a@b.c", broken)).rejects.toThrow("bug");
  });
});
