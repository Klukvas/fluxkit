import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { http } from "../test/http.js";
import { startMediaApp, type MediaApp } from "../test/media-app.js";
import * as images from "../test/media-images.js";
import { ensureMigrated } from "../test/migrate.js";
import type { BannerResponse, StoreBannerList } from "./banners.schemas.js";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

interface Uploaded {
  id: string;
  url: string;
  width: number;
  height: number;
}

describe("GET /store/banners (ADR 0046; real Postgres)", () => {
  const clock = new FakeClock(NOW);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let media: MediaApp;
  let main: Uploaded;
  let english: Uploaded;

  async function upload(width: number, height: number): Promise<Uploaded> {
    const response = await fetch(`${media.baseUrl}/admin/media/uploads`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-fluxkit-csrf": "1" },
      body: await images.jpeg(width, height),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as Uploaded;
  }

  async function create(body: Record<string, unknown>): Promise<BannerResponse> {
    const created = await http<BannerResponse>(media.baseUrl, "POST", "/admin/banners", {
      body: {
        title: { uk: "Розпродаж" },
        imageUploadId: main.id,
        link: "/catalog",
        isActive: true,
        ...body,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body;
  }

  async function storeIds(locale?: string): Promise<string[]> {
    const result = await http<StoreBannerList>(
      media.baseUrl,
      "GET",
      `/store/banners${locale === undefined ? "" : `?locale=${locale}`}`,
    );
    expect(result.status).toBe(200);
    return result.body.items.map((item) => item.id);
  }

  beforeAll(async () => {
    await ensureMigrated();
    await pool.query("delete from banner");
    media = await startMediaApp({ clock, defaultLocale: "uk", locales: ["uk", "en"] });
    main = await upload(1280, 640);
    english = await upload(640, 320);
  });

  beforeEach(async () => {
    clock.set(NOW);
    await pool.query("delete from banner");
  });

  afterAll(async () => {
    try {
      await pool.query("delete from banner");
    } finally {
      await media.close();
      await pool.end();
    }
  });

  it("answers an empty list when there is no banner", async () => {
    const result = await http<StoreBannerList>(media.baseUrl, "GET", "/store/banners");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ items: [] });
  });

  it("returns live banners only: inactive, scheduled and expired ones are hidden", async () => {
    const live = await create({});
    await create({ isActive: false });
    await create({ startsAt: at(60_000) });
    await create({ endsAt: at(-1) });
    expect(await storeIds()).toEqual([live.id]);
  });

  it("uses the half-open window [startsAt, endsAt) at its exact boundaries", async () => {
    const window = await create({ startsAt: at(0), endsAt: at(1000) });
    clock.set(at(-1));
    expect(await storeIds()).toEqual([]);
    clock.set(at(0));
    expect(await storeIds()).toEqual([window.id]);
    clock.set(at(999));
    expect(await storeIds()).toEqual([window.id]);
    clock.set(at(1000));
    expect(await storeIds()).toEqual([]);
  });

  it("orders by position and shows at most 3; the 4th live banner is hidden until one above it goes", async () => {
    const [a, b, c, d] = [await create({}), await create({}), await create({}), await create({})];
    await http(media.baseUrl, "PUT", "/admin/banners/order", {
      body: { ids: [d.id, c.id, b.id, a.id] },
    });
    expect(await storeIds()).toEqual([d.id, c.id, b.id]);
    await http(media.baseUrl, "PATCH", `/admin/banners/${c.id}`, { body: { isActive: false } });
    expect(await storeIds()).toEqual([d.id, b.id, a.id]);
  });

  it("returns public fields only, with the texts and picture of the requested locale", async () => {
    const created = await create({
      title: { uk: "Розпродаж", en: "Sale" },
      text: { uk: "Знижки до 30 %" },
      imageAlt: { uk: "Взуття", en: "Shoes" },
      tone: "accent",
      link: "https://example.com/sale",
      images: [{ locale: "en", imageUploadId: english.id }],
      startsAt: at(-1000),
      endsAt: at(1000),
    });
    const uk = await http<StoreBannerList>(media.baseUrl, "GET", "/store/banners?locale=uk");
    expect(uk.body).toEqual({
      items: [
        {
          id: created.id,
          layout: "card",
          title: "Розпродаж",
          text: "Знижки до 30 %",
          href: "https://example.com/sale",
          tone: "accent",
          image: { url: main.url, width: 1280, height: 640, alt: "Взуття" },
        },
      ],
    });
    const en = await http<StoreBannerList>(media.baseUrl, "GET", "/store/banners?locale=en");
    expect(en.body.items[0]).toEqual({
      id: created.id,
      layout: "card",
      title: "Sale",
      // No English text: the default locale's, per field.
      text: "Знижки до 30 %",
      href: "https://example.com/sale",
      tone: "accent",
      image: { url: english.url, width: 640, height: 320, alt: "Shoes" },
    });
    const raw = JSON.stringify(en.body);
    for (const internal of [
      "isActive",
      "startsAt",
      "endsAt",
      "position",
      "createdAt",
      "uploadId",
      main.id,
    ]) {
      expect(raw).not.toContain(internal);
    }
  });

  it("falls back to the default picture for a locale without its own, never to the default locale's own picture", async () => {
    await create({ images: [{ locale: "uk", imageUploadId: english.id }] });
    const uk = await http<StoreBannerList>(media.baseUrl, "GET", "/store/banners?locale=uk");
    expect(uk.body.items[0]?.image.url).toBe(english.url);
    const en = await http<StoreBannerList>(media.baseUrl, "GET", "/store/banners?locale=en");
    expect(en.body.items[0]?.image.url).toBe(main.url);
    // Missing locale = the default locale.
    const plain = await http<StoreBannerList>(media.baseUrl, "GET", "/store/banners");
    expect(plain.body.items[0]?.image.url).toBe(english.url);
  });

  it("returns the image layout without title and text, its description as alt; a card without alt has alt null", async () => {
    const image = await create({
      layout: "image",
      title: null,
      imageAlt: { uk: "Осінній розпродаж" },
    });
    const plainCard = await create({});
    const result = await http<StoreBannerList>(media.baseUrl, "GET", "/store/banners?locale=en");
    expect(result.body.items).toEqual([
      expect.objectContaining({
        id: image.id,
        layout: "image",
        title: null,
        text: null,
        image: expect.objectContaining({ alt: "Осінній розпродаж" }),
      }),
      expect.objectContaining({
        id: plainCard.id,
        title: "Розпродаж",
        text: null,
        image: expect.objectContaining({ alt: null }),
      }),
    ]);
  });

  it("refuses an unknown locale (400) and unknown query parameters", async () => {
    for (const query of ["?locale=pl", "?locale=", "?page=2"]) {
      const result = await http<ProblemBody>(media.baseUrl, "GET", `/store/banners${query}`);
      expect(result.status, query).toBe(400);
      expect(result.body.code).toBe("validation_failed");
    }
  });

  it("needs no sign-in and sends neither a cookie nor Cache-Control (like GET /store/categories)", async () => {
    await create({});
    const banners = await fetch(`${media.baseUrl}/store/banners`);
    const categories = await fetch(`${media.baseUrl}/store/categories`);
    expect(banners.status).toBe(200);
    expect(banners.headers.get("set-cookie")).toBeNull();
    expect(banners.headers.get("cache-control")).toBe(categories.headers.get("cache-control"));
    expect(banners.headers.get("cache-control")).toBeNull();
    const anonymous = await fetch(`${media.baseUrl}/store/banners`, {
      headers: { "x-test-admin": "anonymous" },
    });
    expect(anonymous.status).toBe(200);
  });

  it("is read only: no other method is routed", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const result = await http(media.baseUrl, method, "/store/banners", { body: {} });
      expect(result.status, method).toBe(404);
    }
  });
});
