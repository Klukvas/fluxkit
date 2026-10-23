import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { withTransaction } from "../common/transaction.js";
import { brand, mediaUpload, product, productType } from "../database/schema/index.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { http } from "../test/http.js";
import { startMediaApp, TEST_MEDIA_BASE_URL, type MediaApp } from "../test/media-app.js";
import * as images from "../test/media-images.js";
import { ensureMigrated } from "../test/migrate.js";
import { MediaAttachService } from "./media-attach.service.js";

interface Uploaded {
  id: string;
  url: string;
  key: string;
}

const FOREIGN_URL = "https://cdn.example.test/products/1.jpg";
const MISSING_URL = `${TEST_MEDIA_BASE_URL}/ffffffffffffffffffffffffffffffff.png`;

describe("attach marking in product media and brand saves (ADR 0028 decision 5)", () => {
  let media: MediaApp;
  let productTypeId: string;
  const productIds: string[] = [];
  const brandIds: string[] = [];
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });

  beforeAll(async () => {
    await ensureMigrated();
    media = await startMediaApp();
    const created = await http<{ id: string }>(media.baseUrl, "POST", "/admin/product-types", {
      body: { code: `attach_${randomUUID().slice(0, 8)}`, name: { uk: "Тип" } },
    });
    expect(created.status).toBe(201);
    productTypeId = created.body.id;
  });

  afterAll(async () => {
    try {
      if (productIds.length > 0)
        await media.db.delete(product).where(inArray(product.id, productIds));
      if (brandIds.length > 0) await media.db.delete(brand).where(inArray(brand.id, brandIds));
      await media.db.delete(productType).where(eq(productType.id, productTypeId));
    } finally {
      await media.close();
      await pool.end();
    }
  });

  async function upload(): Promise<Uploaded> {
    const response = await fetch(`${media.baseUrl}/admin/media/uploads`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-fluxkit-csrf": "1" },
      body: await images.jpeg(8, 8),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; url: string };
    return { ...body, key: body.url.slice(TEST_MEDIA_BASE_URL.length + 1) };
  }

  async function newProduct(): Promise<string> {
    const created = await http<{ id: string }>(media.baseUrl, "POST", "/admin/products", {
      body: { productTypeId, title: { uk: `Товар ${randomUUID()}` } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    productIds.push(created.body.id);
    return created.body.id;
  }

  async function attachedAt(id: string): Promise<Date | null | undefined> {
    const [row] = await media.db
      .select({ firstAttachedAt: mediaUpload.firstAttachedAt })
      .from(mediaUpload)
      .where(eq(mediaUpload.id, id));
    return row?.firstAttachedAt;
  }

  function putMedia(productId: string, urls: string[]) {
    return http<ProblemBody & { media: { url: string }[] }>(
      media.baseUrl,
      "PUT",
      `/admin/products/${productId}/media`,
      { body: { media: urls.map((url) => ({ url })) } },
    );
  }

  describe("PUT /admin/products/{id}/media", () => {
    it("marks an uploaded URL attached in the save, and keeps the first time on later saves", async () => {
      const productId = await newProduct();
      const uploaded = await upload();
      expect(await attachedAt(uploaded.id)).toBeNull();
      const saved = await putMedia(productId, [uploaded.url, FOREIGN_URL]);
      expect(saved.status).toBe(200);
      expect(saved.body.media.map((item) => item.url)).toEqual([uploaded.url, FOREIGN_URL]);
      const first = await attachedAt(uploaded.id);
      expect(first).toBeInstanceOf(Date);
      expect((await putMedia(productId, [uploaded.url])).status).toBe(200);
      expect(await attachedAt(uploaded.id)).toEqual(first);
      // Removing it from the list keeps the row and its attachment (attached uploads are never deleted).
      expect((await putMedia(productId, [])).status).toBe(200);
      expect(await attachedAt(uploaded.id)).toEqual(first);
    });

    it("accepts the same upload written with another case of the host and keeps foreign URLs untouched", async () => {
      const productId = await newProduct();
      const uploaded = await upload();
      const shouted = uploaded.url.replace("shop.example.test", "SHOP.EXAMPLE.TEST");
      expect((await putMedia(productId, [shouted, FOREIGN_URL])).status).toBe(200);
      expect(await attachedAt(uploaded.id)).toBeInstanceOf(Date);
    });

    it("refuses a URL under our prefix that names no upload (400 upload_not_found at media.N.url), changing nothing", async () => {
      const productId = await newProduct();
      const kept = await upload();
      expect((await putMedia(productId, [FOREIGN_URL])).status).toBe(200);
      const other = await upload();
      for (const bad of [
        MISSING_URL,
        `${TEST_MEDIA_BASE_URL}/not-a-key.png`,
        `${other.url}?w=100`,
        other.url.toUpperCase().replace("HTTPS://SHOP.EXAMPLE.TEST/MEDIA", TEST_MEDIA_BASE_URL),
        `${TEST_MEDIA_BASE_URL}/`,
      ]) {
        const result = await putMedia(productId, [kept.url, other.url, bad]);
        expect(result.status, bad).toBe(400);
        expect(result.body.code).toBe("validation_failed");
        expect(result.body.errors, bad).toEqual([
          expect.objectContaining({ path: "media.2.url", code: "upload_not_found" }),
        ]);
      }
      // The transaction rolled back: neither the list nor the marks changed.
      const detail = await http<{ media: { url: string }[] }>(
        media.baseUrl,
        "GET",
        `/admin/products/${productId}`,
      );
      expect(detail.body.media.map((item) => item.url)).toEqual([FOREIGN_URL]);
      expect(await attachedAt(kept.id)).toBeNull();
      expect(await attachedAt(other.id)).toBeNull();
    });

    it("reports every unknown upload URL with its own index", async () => {
      const productId = await newProduct();
      const result = await putMedia(productId, [MISSING_URL, FOREIGN_URL, MISSING_URL]);
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "media.0.url", code: "upload_not_found" }),
        expect.objectContaining({ path: "media.2.url", code: "upload_not_found" }),
      ]);
    });

    it("answers 404 for an unknown product before looking at URLs", async () => {
      const result = await putMedia(randomUUID(), [MISSING_URL]);
      expect(result.status).toBe(404);
    });
  });

  describe("brand logoUrl", () => {
    it("POST marks the uploaded logo attached in the same transaction", async () => {
      const uploaded = await upload();
      const created = await http<{ id: string; logoUrl: string }>(
        media.baseUrl,
        "POST",
        "/admin/brands",
        {
          body: { name: { uk: `Бренд ${randomUUID()}` }, logoUrl: uploaded.url },
        },
      );
      expect(created.status).toBe(201);
      brandIds.push(created.body.id);
      expect(created.body.logoUrl).toBe(uploaded.url);
      expect(await attachedAt(uploaded.id)).toBeInstanceOf(Date);
    });

    it("POST with an unknown upload URL is 400 upload_not_found at logoUrl and creates no brand", async () => {
      const name = `Бренд ${randomUUID()}`;
      const result = await http<ProblemBody>(media.baseUrl, "POST", "/admin/brands", {
        body: { name: { uk: name }, logoUrl: MISSING_URL },
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "logoUrl", code: "upload_not_found" }),
      ]);
      const rows = await pool.query(`select count(*)::int as n from brand where name->>'uk' = $1`, [
        name,
      ]);
      expect(rows.rows[0].n).toBe(0);
    });

    it("POST with a given slug and with a generated slug both mark; a foreign logo is untouched", async () => {
      const first = await upload();
      const withSlug = await http<{ id: string }>(media.baseUrl, "POST", "/admin/brands", {
        body: { name: { uk: "Бренд" }, slug: `b-${randomUUID().slice(0, 8)}`, logoUrl: first.url },
      });
      expect(withSlug.status).toBe(201);
      brandIds.push(withSlug.body.id);
      expect(await attachedAt(first.id)).toBeInstanceOf(Date);
      const foreign = await http<{ id: string }>(media.baseUrl, "POST", "/admin/brands", {
        body: { name: { uk: `Бренд ${randomUUID()}` }, logoUrl: FOREIGN_URL },
      });
      expect(foreign.status).toBe(201);
      brandIds.push(foreign.body.id);
    });

    it("PATCH marks a new logo, refuses an unknown one without changing the brand, and allows null", async () => {
      const created = await http<{ id: string }>(media.baseUrl, "POST", "/admin/brands", {
        body: { name: { uk: `Бренд ${randomUUID()}` }, logoUrl: FOREIGN_URL },
      });
      brandIds.push(created.body.id);
      const uploaded = await upload();
      const patched = await http<{ logoUrl: string }>(
        media.baseUrl,
        "PATCH",
        `/admin/brands/${created.body.id}`,
        { body: { logoUrl: uploaded.url } },
      );
      expect(patched.status).toBe(200);
      expect(await attachedAt(uploaded.id)).toBeInstanceOf(Date);

      const refused = await http<ProblemBody>(
        media.baseUrl,
        "PATCH",
        `/admin/brands/${created.body.id}`,
        {
          body: { logoUrl: MISSING_URL, name: { uk: "Змінено" } },
        },
      );
      expect(refused.status).toBe(400);
      expect(refused.body.errors).toEqual([
        expect.objectContaining({ path: "logoUrl", code: "upload_not_found" }),
      ]);
      const after = await http<{ logoUrl: string; name: { uk: string } }>(
        media.baseUrl,
        "GET",
        `/admin/brands/${created.body.id}`,
      );
      expect(after.body.logoUrl).toBe(uploaded.url);
      expect(after.body.name.uk).not.toBe("Змінено");

      const cleared = await http<{ logoUrl: string | null }>(
        media.baseUrl,
        "PATCH",
        `/admin/brands/${created.body.id}`,
        { body: { logoUrl: null } },
      );
      expect(cleared.status).toBe(200);
      expect(cleared.body.logoUrl).toBeNull();
    });

    it("PATCH of an unknown brand stays 404", async () => {
      const result = await http(media.baseUrl, "PATCH", `/admin/brands/${randomUUID()}`, {
        body: { logoUrl: MISSING_URL },
      });
      expect(result.status).toBe(404);
    });
  });

  describe("the race with the cleanup job's delete (two connections)", () => {
    /** The job's statement (plan step 5): delete only never-attached rows, under the row lock. */
    const JOB_DELETE =
      "delete from media_upload where id = $1 and first_attached_at is null returning storage_key";

    it("a delete that committed first wins: the save answers upload_not_found", async () => {
      const productId = await newProduct();
      const uploaded = await upload();
      const deleted = await pool.query(JOB_DELETE, [uploaded.id]);
      expect(deleted.rowCount).toBe(1);
      const result = await putMedia(productId, [uploaded.url]);
      expect(result.status).toBe(400);
      expect(result.body.errors?.[0]?.code).toBe("upload_not_found");
    });

    it("a save waits for an uncommitted delete: rollback lets the save mark it, commit makes it upload_not_found", async () => {
      for (const outcome of ["rollback", "commit"] as const) {
        const productId = await newProduct();
        const uploaded = await upload();
        const job = await pool.connect();
        try {
          await job.query("begin");
          expect((await job.query(JOB_DELETE, [uploaded.id])).rowCount).toBe(1);
          const save = putMedia(productId, [uploaded.url]);
          // The save is blocked on the row lock the delete holds.
          const settled = await Promise.race([
            save.then(() => "settled"),
            new Promise((resolve) => setTimeout(() => resolve("waiting"), 300)),
          ]);
          expect(settled, outcome).toBe("waiting");
          await job.query(outcome);
          const result = await save;
          if (outcome === "rollback") {
            expect(result.status).toBe(200);
            expect(await attachedAt(uploaded.id)).toBeInstanceOf(Date);
          } else {
            expect(result.status).toBe(400);
            expect(result.body.errors?.[0]?.code).toBe("upload_not_found");
          }
        } finally {
          job.release();
        }
      }
    });

    it("an attach that committed first wins: the job's delete then finds nothing to delete", async () => {
      const uploaded = await upload();
      const attach = media.app.get(MediaAttachService);
      let release: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      let marked: () => void = () => undefined;
      const markedPromise = new Promise<void>((resolve) => {
        marked = resolve;
      });
      const transaction = withTransaction(media.db, async (tx) => {
        await attach.markAttached(tx, [{ path: "logoUrl", url: uploaded.url }]);
        marked();
        await hold;
      });
      await markedPromise;
      const job = await pool.connect();
      try {
        await job.query("begin");
        const pendingDelete = job.query(JOB_DELETE, [uploaded.id]);
        const settled = await Promise.race([
          pendingDelete.then(() => "settled"),
          new Promise((resolve) => setTimeout(() => resolve("waiting"), 300)),
        ]);
        expect(settled).toBe("waiting");
        release();
        await transaction;
        expect((await pendingDelete).rowCount).toBe(0);
        await job.query("commit");
      } finally {
        job.release();
      }
      expect(await attachedAt(uploaded.id)).toBeInstanceOf(Date);
    });
  });
});
