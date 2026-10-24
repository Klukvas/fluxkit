import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ADMIN_OPERATIONS,
  CSRF_HEADER,
  InvalidRequestError,
  InvalidResponseError,
  NetworkError,
  createAdminClient,
  type AdminClient,
  type AdminOperationName,
  type AdminResult,
} from "./index.js";
import type {
  AdminConfig,
  AdminMediaUpload,
  AdminProduct,
  AdminProductList,
} from "./admin-types.js";

interface Recorded {
  url: string;
  init: RequestInit & { headers: Headers };
}

/** A fake fetch that records the calls and answers with `respond`. */
function fakeFetch(respond: (call: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const call = { url, init: init as Recorded["init"] };
    calls.push(call);
    return respond(call);
  };
  return { fetch: fetchImpl, calls };
}

const jsonOk = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const problemResponse = (status: number, extra: Record<string, unknown> = {}, headers = {}) =>
  new Response(
    JSON.stringify({
      type: "about:blank",
      title: "T",
      status,
      code: "conflict",
      detail: "D",
      ...extra,
    }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );

const BASE = "https://api.test";

/** Every operation as `[name, spec]`; the tests below run once per operation. */
const operations = Object.entries(ADMIN_OPERATIONS) as [
  AdminOperationName,
  (typeof ADMIN_OPERATIONS)[AdminOperationName],
][];

const UPLOAD_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

type LooseClient = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** Calls the client function of `name` with one path value per `{placeholder}` and, when needed, an empty body. */
function callOperation(client: AdminClient, name: AdminOperationName, body: unknown = {}) {
  const spec = ADMIN_OPERATIONS[name];
  const placeholders = [...spec.path.matchAll(/\{(\w+)\}/g)].length;
  const args: unknown[] = Array.from({ length: placeholders }, (_unused, index) => `p${index + 1}`);
  if (spec.bodyKind === "binary") args.push(UPLOAD_BYTES);
  else if (spec.hasBody) args.push(body);
  const fn = (client as unknown as LooseClient)[name];
  if (fn === undefined) throw new Error(`The client has no function ${name}`);
  return fn(...args);
}

function expectedUrl(path: string): string {
  let index = 0;
  return `${BASE}${path.replace(/\{\w+\}/g, () => `p${++index}`)}`;
}

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
const pdfOk = () =>
  new Response(PDF_BYTES, { status: 200, headers: { "Content-Type": "application/pdf" } });

function okFor(name: AdminOperationName): Response {
  const status = ADMIN_OPERATIONS[name].successStatuses[0];
  if (status === undefined) throw new Error(`${name} has no success status`);
  if (ADMIN_OPERATIONS[name].responseKind === "pdf") return pdfOk();
  return status === 204 ? new Response(null, { status }) : jsonOk({ marker: name }, status);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the client has one function per ADMIN_OPERATIONS entry and nothing else", () => {
  it("matches the operation names exactly", () => {
    const client = createAdminClient({ baseUrl: BASE });
    expect(Object.keys(client).sort()).toEqual(Object.keys(ADMIN_OPERATIONS).sort());
  });

  it("lists every operation under /admin and nothing else", () => {
    expect(operations.length).toBeGreaterThan(0);
    for (const [, spec] of operations) expect(spec.path.startsWith("/admin/")).toBe(true);
    const keys = operations.map(([, spec]) => `${spec.method} ${spec.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("getShipmentLabel: the one file answer", () => {
  it("hands out the PDF as a Blob and asks for a PDF", async () => {
    const { fetch, calls } = fakeFetch(() => pdfOk());
    const result = await createAdminClient({ baseUrl: BASE, fetch }).getShipmentLabel("o1", "s1");
    expect(calls[0]?.url).toBe(`${BASE}/admin/orders/o1/shipments/s1/label`);
    expect(calls[0]?.init.headers.get("Accept")).toBe("application/pdf, application/problem+json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeInstanceOf(Blob);
    expect(new Uint8Array(await result.data.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it("never hands out anything but a PDF as the file (a proxy's HTML page or JSON throws)", async () => {
    for (const answer of [
      () =>
        new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }),
      () => jsonOk({ marker: true }),
    ]) {
      const { fetch } = fakeFetch(answer);
      await expect(
        createAdminClient({ baseUrl: BASE, fetch }).getShipmentLabel("o1", "s1"),
      ).rejects.toBeInstanceOf(InvalidResponseError);
    }
  });

  it("a problem answer is a problem, with Retry-After", async () => {
    const { fetch } = fakeFetch(() =>
      problemResponse(503, { code: "shipping_provider_unavailable" }, { "Retry-After": "30" }),
    );
    const result = await createAdminClient({ baseUrl: BASE, fetch }).getShipmentLabel("o1", "s1");
    expect(result).toMatchObject({ ok: false, status: 503, retryAfter: "30" });
  });

  it("every JSON operation still asks for JSON", async () => {
    const { fetch, calls } = fakeFetch(() => okFor("getOrder"));
    await createAdminClient({ baseUrl: BASE, fetch }).getOrder("o1");
    expect(calls[0]?.init.headers.get("Accept")).toBe("application/json, application/problem+json");
  });
});

describe.each(operations)("%s", (name, spec) => {
  it("sends the documented method and path, one request, no retry", async () => {
    const { fetch, calls } = fakeFetch(() => okFor(name));
    const client = createAdminClient({ baseUrl: BASE, fetch });
    const result = (await callOperation(client, name)) as AdminResult<unknown>;

    expect(result.ok).toBe(true);
    expect(result.status).toBe(spec.successStatuses[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe(spec.method);
    expect(calls[0]?.url).toBe(expectedUrl(spec.path));
    expect(calls[0]?.init.credentials).toBe("same-origin");
    expect(calls[0]?.init.headers.get("Accept")).toContain("application/problem+json");
  });

  it(
    spec.method === "GET"
      ? "never sends the CSRF header on a read"
      : "sends X-Fluxkit-CSRF: 1 on every write",
    async () => {
      const { fetch, calls } = fakeFetch(() => okFor(name));
      await callOperation(createAdminClient({ baseUrl: BASE, fetch }), name);
      const header = calls[0]?.init.headers.get(CSRF_HEADER) ?? null;
      expect(header).toBe(spec.method === "GET" ? null : "1");
    },
  );

  it(
    spec.bodyKind === "json"
      ? "sends the JSON body with a JSON content type"
      : spec.bodyKind === "binary"
        ? "sends the bytes untouched with an octet-stream content type"
        : "sends no body and no content type",
    async () => {
      const body = { marker: name };
      const { fetch, calls } = fakeFetch(() => okFor(name));
      await callOperation(createAdminClient({ baseUrl: BASE, fetch }), name, body);
      const call = calls[0];
      if (spec.bodyKind === "binary") {
        expect(call?.init.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(call?.init.body).toBe(UPLOAD_BYTES);
        expect(call?.init.headers.has("Content-Length")).toBe(false);
      } else if (spec.bodyKind === "json") {
        expect(call?.init.headers.get("Content-Type")).toBe("application/json");
        expect(JSON.parse(String(call?.init.body))).toEqual(body);
      } else {
        expect(call?.init.headers.get("Content-Type")).toBeNull();
        expect(call?.init.body).toBeUndefined();
      }
    },
  );

  it("does not retry or replay after a network failure", async () => {
    const { fetch, calls } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(callOperation(createAdminClient({ baseUrl: BASE, fetch }), name)).rejects.toThrow(
      NetworkError,
    );
    expect(calls).toHaveLength(1);
  });

  it("does not retry after a 503 problem", async () => {
    const { fetch, calls } = fakeFetch(() =>
      problemResponse(503, { code: "service_unavailable" }, { "Retry-After": "3" }),
    );
    const result = (await callOperation(
      createAdminClient({ baseUrl: BASE, fetch }),
      name,
    )) as AdminResult<unknown>;
    expect(result).toMatchObject({ ok: false, status: 503, retryAfter: "3" });
    expect(calls).toHaveLength(1);
  });
});

describe("uploadMedia", () => {
  const stored = {
    id: "3f0e9d52-6d60-4d57-9d3e-0e0d6c0a9d11",
    url: "/media/0123456789abcdef0123456789abcdef.jpg",
    contentType: "image/jpeg",
    byteSize: 1234,
    width: 640,
    height: 480,
    createdAt: "2026-10-23T10:00:00.000Z",
  };
  const client = (response: () => Response) => {
    const { fetch, calls } = fakeFetch(response);
    return { calls, admin: createAdminClient({ baseUrl: BASE, fetch }) };
  };

  it("posts the file bytes to /admin/media/uploads and returns the typed upload", async () => {
    const { admin, calls } = client(() => jsonOk(stored, 201));
    const blob = new Blob([UPLOAD_BYTES], { type: "image/jpeg" });
    const result = await admin.uploadMedia(blob);
    expect(result).toMatchObject({ ok: true, status: 201, data: stored });
    if (result.ok) expectTypeOf(result.data).toEqualTypeOf<AdminMediaUpload>();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/admin/media/uploads`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe(blob);
    // the blob's own type (image/jpeg) is not what goes on the wire
    expect(calls[0]?.init.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(calls[0]?.init.headers.get(CSRF_HEADER)).toBe("1");
  });

  it("passes the abort signal so the caller can cancel, and reports an abort as NetworkError.aborted", async () => {
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch(() => {
      throw new DOMException("aborted", "AbortError");
    });
    const admin = createAdminClient({ baseUrl: BASE, fetch });
    controller.abort();
    const error = await admin
      .uploadMedia(UPLOAD_BYTES, { signal: controller.signal })
      .catch((cause: unknown) => cause);
    expect(calls[0]?.init.signal).toBe(controller.signal);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it.each([
    [400, "validation_failed", "unsupported_type"],
    [411, "validation_failed", "length_required"],
    [413, "validation_failed", "file_too_large"],
    [503, "storage_unavailable", undefined],
    [503, "uploads_disabled", undefined],
  ] as const)("%i %s is a value, never retried", async (status, code, reason) => {
    const { admin, calls } = client(() =>
      problemResponse(status, {
        code,
        ...(reason === undefined ? {} : { errors: [{ path: "body", code: reason }] }),
      }),
    );
    const result = await admin.uploadMedia(UPLOAD_BYTES);
    expect(result).toMatchObject({ ok: false, status });
    if (result.ok) throw new Error("expected a problem");
    expect(result.problem.code).toBe(code);
    expect(calls).toHaveLength(1);
  });

  it("rejects anything that is not bytes before a request is made", async () => {
    const { admin, calls } = client(() => jsonOk(stored, 201));
    const loose = admin as unknown as LooseClient;
    for (const notBytes of [{ not: "bytes" }, "text", undefined, null, 42]) {
      await expect(loose.uploadMedia?.(notBytes), String(notBytes)).rejects.toThrow(
        InvalidRequestError,
      );
    }
    expect(calls).toHaveLength(0);
  });
});

describe("problems come back as values", () => {
  const client = (response: () => Response) => {
    const { fetch, calls } = fakeFetch(response);
    return { calls, admin: createAdminClient({ baseUrl: BASE, fetch }) };
  };

  it("400 validation_failed keeps the field errors", async () => {
    const { admin, calls } = client(() =>
      problemResponse(400, {
        code: "validation_failed",
        errors: [
          { path: "title.uk", code: "required" },
          { path: "slug", code: "invalid", message: "Use lowercase letters" },
        ],
      }),
    );
    const result = await admin.createProduct({ productTypeId: "t", title: {} });
    expect(result).toMatchObject({ ok: false, status: 400, retryAfter: null });
    if (result.ok) throw new Error("expected a problem");
    expect(result.problem.code).toBe("validation_failed");
    expect(result.problem.errors).toEqual([
      { path: "title.uk", code: "required" },
      { path: "slug", code: "invalid", message: "Use lowercase letters" },
    ]);
    expect(calls).toHaveLength(1);
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [413, "validation_failed"],
  ] as const)("%i is returned with its code and is not retried", async (status, code) => {
    const { admin, calls } = client(() => problemResponse(status, { code }));
    const result = await admin.updateProduct("p1", { slug: "x" });
    expect(result).toMatchObject({ ok: false, status, retryAfter: null });
    if (result.ok) throw new Error("expected a problem");
    expect(result.problem.code).toBe(code);
    expect(calls).toHaveLength(1);
  });

  it("429 carries Retry-After and is not retried", async () => {
    const { admin, calls } = client(() =>
      problemResponse(429, { code: "too_many_requests" }, { "Retry-After": "42" }),
    );
    const result = await admin.login({ email: "a@b.c", password: "x" });
    expect(result).toMatchObject({ ok: false, status: 429, retryAfter: "42" });
    expect(calls).toHaveLength(1);
  });

  it("a failed write is never replayed, whatever the status", async () => {
    for (const status of [401, 409, 500, 502, 504]) {
      const { admin, calls } = client(() => problemResponse(status));
      await admin.adjustInventory("p1", "v1", { kind: "receipt", delta: 5 });
      expect(calls, `status ${status}`).toHaveLength(1);
    }
  });
});

describe("answers that cannot be trusted are thrown", () => {
  const adminWith = (response: () => Response) => {
    const { fetch, calls } = fakeFetch(response);
    return { calls, admin: createAdminClient({ baseUrl: BASE, fetch }) };
  };

  it("a proxy's HTML error page", async () => {
    const { admin, calls } = adminWith(
      () => new Response("<html>bad gateway</html>", { status: 502 }),
    );
    await expect(admin.getConfig()).rejects.toThrow(InvalidResponseError);
    expect(calls).toHaveLength(1);
  });

  it("a success status without a JSON content type", async () => {
    const { admin } = adminWith(
      () => new Response("{}", { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    await expect(admin.getConfig()).rejects.toThrow(InvalidResponseError);
  });

  it("invalid JSON", async () => {
    const { admin } = adminWith(
      () => new Response("{nope", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(admin.getConfig()).rejects.toThrow(InvalidResponseError);
  });

  it("a status the document does not list for the operation", async () => {
    const { admin } = adminWith(() => jsonOk({}, 202));
    await expect(admin.getConfig()).rejects.toThrow(InvalidResponseError);
  });

  it("a malformed problem body", async () => {
    const { admin } = adminWith(
      () =>
        new Response(JSON.stringify({ title: "no code" }), {
          status: 400,
          headers: { "Content-Type": "application/problem+json" },
        }),
    );
    await expect(admin.getConfig()).rejects.toThrow(InvalidResponseError);
  });

  it("a redirect", async () => {
    const { admin } = adminWith(() => new Response(null, { status: 302 }));
    await expect(admin.getConfig()).rejects.toThrow(InvalidResponseError);
  });

  it("the message names the operation, never the body or the URL values", async () => {
    const { admin } = adminWith(() => new Response("secret-body", { status: 502 }));
    const error = await admin.getProduct("secret-id").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(InvalidResponseError);
    expect(String((error as Error).message)).toContain("GET /admin/products/{id}");
    expect(String((error as Error).message)).not.toContain("secret");
  });

  it("a network failure is a NetworkError that keeps the cause and says whether it was an abort", async () => {
    const cause = new TypeError("fetch failed");
    const failing = createAdminClient({
      baseUrl: BASE,
      fetch: async () => {
        throw cause;
      },
    });
    const error = await failing.listBrands().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).cause).toBe(cause);
    expect((error as NetworkError).aborted).toBe(false);

    const controller = new AbortController();
    controller.abort();
    const aborting = createAdminClient({
      baseUrl: BASE,
      fetch: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    });
    const abortError = await aborting
      .listBrands({ signal: controller.signal })
      .catch((thrown: unknown) => thrown);
    expect((abortError as NetworkError).aborted).toBe(true);
  });
});

describe("query serialization", () => {
  const run = async (call: (admin: AdminClient) => Promise<unknown>) => {
    const { fetch, calls } = fakeFetch(() => jsonOk({ items: [], total: 0, limit: 1, offset: 0 }));
    await call(createAdminClient({ baseUrl: BASE, fetch }));
    return calls[0]?.url ?? "";
  };

  it("encodes every product filter and skips the undefined ones", async () => {
    const url = await run((admin) =>
      admin.listProducts({
        q: "a b&c=d",
        brandId: "b1",
        categoryId: undefined,
        status: "draft",
        limit: 20,
        offset: 40,
      }),
    );
    expect(url).toBe(
      `${BASE}/admin/products?q=a%20b%26c%3Dd&brandId=b1&status=draft&limit=20&offset=40`,
    );
  });

  it("keeps zero and encodes an offset timestamp", async () => {
    const url = await run((admin) =>
      admin.listOrders({
        customerId: "c1",
        placedFrom: "2026-10-19T10:00:00+02:00",
        placedTo: "2026-10-20T10:00:00Z",
        offset: 0,
        status: "paid",
        q: "FK-0001",
      }),
    );
    expect(url).toContain("placedFrom=2026-10-19T10%3A00%3A00%2B02%3A00");
    expect(url).toContain("placedTo=2026-10-20T10%3A00%3A00Z");
    expect(url).toContain("offset=0");
    expect(url).toContain("customerId=c1");
    expect(url).toContain("status=paid");
    expect(url).toContain("q=FK-0001");
  });

  it("sends only the query names of the operation", async () => {
    const url = await run((admin) =>
      admin.listBrands({
        limit: 5,
        // not a query parameter of this operation: must not leak into the URL
        ...({ q: "x", brandId: "y" } as object),
        fetchOptions: { cache: "no-store" },
      }),
    );
    expect(url).toBe(`${BASE}/admin/brands?limit=5`);
  });

  it("serializes parentId and the reservation status filter", async () => {
    expect(await run((admin) => admin.listCategories({ parentId: "p1", limit: 100 }))).toBe(
      `${BASE}/admin/categories?parentId=p1&limit=100`,
    );
    expect(await run((admin) => admin.listReservations("p1", "v1", { status: "active" }))).toBe(
      `${BASE}/admin/products/p1/variants/v1/inventory/reservations?status=active`,
    );
  });

  it("no query string without a filter", async () => {
    expect(await run((admin) => admin.listOrders())).toBe(`${BASE}/admin/orders`);
  });
});

describe("path parameters", () => {
  it("are encoded", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}));
    const admin = createAdminClient({ baseUrl: BASE, fetch });
    await admin.getProduct("a/b?c#d e");
    await admin.putVariantPrice("p/1", "v 2", "UAH", { amount: 100 });
    expect(calls[0]?.url).toBe(`${BASE}/admin/products/a%2Fb%3Fc%23d%20e`);
    expect(calls[1]?.url).toBe(`${BASE}/admin/products/p%2F1/variants/v%202/prices/UAH`);
  });

  it.each([[""], ["."], [".."]])("%j is refused before anything is sent", async (value) => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}));
    const admin = createAdminClient({ baseUrl: BASE, fetch });
    await expect(admin.getProduct(value)).rejects.toThrow(InvalidRequestError);
    await expect(admin.deleteVariant("p1", value)).rejects.toThrow(InvalidRequestError);
    expect(calls).toHaveLength(0);
  });
});

describe("construction and options", () => {
  it("refuses a base URL with a path", () => {
    expect(() => createAdminClient({ baseUrl: "https://api.test/v1" })).toThrow(
      InvalidRequestError,
    );
  });

  it("works with an empty base URL (same origin)", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}));
    await createAdminClient({ baseUrl: "", fetch }).getConfig();
    expect(calls[0]?.url).toBe("/admin/config");
  });

  it("uses the global fetch by default", async () => {
    const globalFetch = vi.fn(async () => jsonOk({}));
    vi.stubGlobal("fetch", globalFetch);
    await createAdminClient({ baseUrl: BASE }).getConfig();
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  it("fetchOptions cannot change method, headers, body or credentials", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}, 201));
    const admin = createAdminClient({ baseUrl: BASE, fetch });
    await admin.createBrand(
      { name: { uk: "A" } },
      {
        fetchOptions: {
          method: "GET",
          credentials: "include",
          body: "x",
          headers: { [CSRF_HEADER]: "0" },
          cache: "no-store",
        },
      },
    );
    const init = calls[0]?.init;
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers.get(CSRF_HEADER)).toBe("1");
    expect(JSON.parse(String(init?.body))).toEqual({ name: { uk: "A" } });
    expect((init as { cache?: string } | undefined)?.cache).toBe("no-store");
  });

  it("passes the abort signal on", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}));
    const controller = new AbortController();
    await createAdminClient({ baseUrl: BASE, fetch }).getConfig({ signal: controller.signal });
    expect(calls[0]?.init.signal).toBe(controller.signal);
  });

  it("the admin client does not send an idempotency header", async () => {
    const { fetch, calls } = fakeFetch(() => jsonOk({}, 201));
    await createAdminClient({ baseUrl: BASE, fetch }).createBrand({ name: { uk: "A" } });
    expect(calls[0]?.init.headers.get("Idempotency-Key")).toBeNull();
  });
});

describe("types the admin screens rely on", () => {
  it("results are the shared success or problem union", () => {
    expectTypeOf<Awaited<ReturnType<AdminClient["getConfig"]>>>().toEqualTypeOf<
      AdminResult<AdminConfig>
    >();
    expectTypeOf<Awaited<ReturnType<AdminClient["listProducts"]>>>().toEqualTypeOf<
      AdminResult<AdminProductList>
    >();
    expectTypeOf<Awaited<ReturnType<AdminClient["publishProduct"]>>>().toEqualTypeOf<
      AdminResult<AdminProduct>
    >();
    expectTypeOf<Awaited<ReturnType<AdminClient["logout"]>>>().toEqualTypeOf<
      AdminResult<undefined>
    >();
  });

  it("the shop currency list carries the exponent", () => {
    expectTypeOf<AdminConfig["supportedCurrencies"]>().toEqualTypeOf<
      { code: string; exponent: number }[]
    >();
    expectTypeOf<AdminConfig["lowStockThreshold"]>().toEqualTypeOf<number>();
  });
});
