import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { NovaPostLogger } from "../http.js";

/*
 * TEST ONLY. A local stand-in for the Nova Post API on 127.0.0.1, shaped after what spike 7a and its rerun observed on
 * production (2026-10-25) and, where nothing was observed, after the documentation. Every id, number, uuid, name, phone and
 * address here is INVENTED; nothing is copied from carrier data. It records every request (method, path, query, headers,
 * body) so specs can assert the exact request shapes, and a spec can replace any route's answer.
 */

export const STUB_API_KEY = "stub-key-0123456789abcdef0123456789";

/** Invented personal data of the fixtures: specs assert it never reaches a log or an error. */
export const STUB_PERSONAL = Object.freeze({
  senderName: "Тестовий Відправник",
  senderPhone: "380000000001",
  recipientFirstName: "Ярина",
  recipientLastName: "Вигаданенко",
  recipientPhone: "+380 50 000 00 02",
  recipientPhoneNormalized: "380500000002",
});

export const STUB_CITY_ID = 900001;
export const STUB_EMPTY_CITY_ID = 900002;
export const STUB_SENDER_DIVISION_ID = 700001;

export interface RecordedRequest {
  readonly method: string;
  /** The path after the version prefix, e.g. `/divisions`. */
  readonly path: string;
  /** The raw query string (without `?`), as sent. */
  readonly rawQuery: string;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: unknown;
}

export interface StubAnswer {
  readonly status: number;
  readonly json?: unknown;
  readonly body?: Buffer | string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Never answers (the client's signal or ceiling must end the call). */
  readonly hang?: boolean;
  readonly delayMs?: number;
  /** Sends the body in two chunks without a content-length (the size cap must count while reading). */
  readonly chunked?: boolean;
}

export type Route =
  | "authorization"
  | "settlements"
  | "divisions"
  | "calculations"
  | "createShipment"
  | "listShipments"
  | "deleteShipment"
  | "tracking"
  | "print";

export type Override = (request: RecordedRequest) => StubAnswer | undefined;

interface StoredShipment {
  id: string;
  number: string;
  clientOrder: string;
  createdAt: string;
  deleted: boolean;
  statusCode: number;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** A JWT-shaped token (HS256 header, `exp`/`iat` claims, an invented signature). */
export function stubJwt(serial: number, expSeconds: number | undefined): string {
  const claims: Record<string, unknown> = { iat: 1_761_400_000, sub: `stub-${String(serial)}` };
  if (expSeconds !== undefined) {
    claims.exp = expSeconds;
  }
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(claims)}.c2lnbmF0dXJlLSR7c2VyaWFsfQ`;
}

function division(
  id: number,
  category: string,
  cityId: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const n = id - 700000;
  return {
    id,
    number: `${String(cityId % 100)}/${String(n)}`,
    name: `${category === "Postomat" ? "Поштомат" : "Відділення"} №${String(n)}`,
    shortName: `№${String(n)}`,
    address: `вул. Вигадана, ${String(n)}`,
    fullAddress: `Тестова область, Тестове Місто, вул. Вигадана, ${String(n)}`,
    divisionCategory: category,
    countryCode: "UA",
    status: "Working",
    source: "NPUA",
    externalId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    prohibitedIssuance: false,
    prohibitedSending: false,
    maxWeightPlaceRecipient: category === "Postomat" ? 20000 : 30000,
    settlement: { id: cityId, name: "Тестове Місто" },
    ...overrides,
  };
}

/** The divisions of the stub city: 3 branches, 1 cargo branch, 4 lockers, 1 partner point, 1 not issuing. */
export function stubDivisions(): Record<string, unknown>[] {
  return [
    division(700001, "PostBranch", STUB_CITY_ID),
    division(700002, "PostBranch", STUB_CITY_ID),
    division(700003, "PostBranch", STUB_CITY_ID),
    division(700004, "CargoBranch", STUB_CITY_ID),
    division(700005, "Postomat", STUB_CITY_ID),
    division(700006, "Postomat", STUB_CITY_ID),
    division(700007, "Postomat", STUB_CITY_ID),
    division(700008, "Postomat", STUB_CITY_ID),
    division(700009, "PUDO", STUB_CITY_ID),
    division(700010, "PostBranch", STUB_CITY_ID, { prohibitedIssuance: true }),
  ];
}

function settlement(id: number, uk: string, en: string, language: string): Record<string, unknown> {
  return {
    id,
    name: language === "uk" ? uk : en,
    region: {
      id: 51,
      name: language === "uk" ? "Тестовий район" : "Testovyi raion",
      parent: { id: 5, name: language === "uk" ? "Тестова область" : "Testova oblast" },
    },
    postCode1: "00001",
    country: { code: "UA", name: "Ukraine" },
    externalId: "00000000-0000-4000-8000-000000000001",
    prohibitedIssuance: false,
    prohibitedSending: false,
  };
}

function paged(items: unknown[], page: number, limit: number): Record<string, unknown> {
  const lastPage = items.length === 0 ? 0 : Math.ceil(items.length / limit);
  return {
    current_page: page,
    last_page: lastPage,
    per_page: limit,
    total: items.length,
    from: null,
    to: null,
    items: items.slice((page - 1) * limit, page * limit),
  };
}

function error(status: number, errors: Record<string, string>): StubAnswer {
  return { status, json: { errors } };
}

function words(value: unknown): number {
  return typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean).length : 0;
}

/**
 * The create body checks of the stub, stricter than accepting anything (review finding 6). Only what production showed
 * is modelled: a contact name of fewer than two words is `422 "Contact Sender contains less than 2 words"` (H18, seen on
 * the calculation with the sender; the recipient text is the same rule by analogy, UNVERIFIED), and a missing field is a
 * field-keyed `422` in the Laravel form the API uses elsewhere (`{"phone": "The phone field is required."}`, H07). The
 * required list is the spike's verified body (`scripts/spikes/nova-post-verify.mjs`), not a documented minimum.
 */
function createBodyProblem(body: unknown): StubAnswer | undefined {
  const root = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const parcel = (Array.isArray(root.parcels) ? root.parcels[0] : undefined) as
    Record<string, unknown> | undefined;
  const sender = (root.sender ?? {}) as Record<string, unknown>;
  const recipient = (root.recipient ?? {}) as Record<string, unknown>;
  const required: [string, unknown][] = [
    ["status", root.status],
    ["clientOrder", root.clientOrder],
    ["payerType", root.payerType],
    ["parcels", parcel],
    ["parcels.0.cargoCategory", parcel?.cargoCategory],
    ["parcels.0.insuranceCost", parcel?.insuranceCost],
    ["parcels.0.actualWeight", parcel?.actualWeight],
    ["parcels.0.width", parcel?.width],
    ["parcels.0.length", parcel?.length],
    ["parcels.0.height", parcel?.height],
    ["sender.name", sender.name],
    ["sender.phone", sender.phone],
    ["sender.countryCode", sender.countryCode],
    ["sender.divisionId", sender.divisionId],
    ["recipient.name", recipient.name],
    ["recipient.phone", recipient.phone],
    ["recipient.countryCode", recipient.countryCode],
    ["recipient.divisionId", recipient.divisionId],
  ];
  const missing = required.find(
    ([, value]) => value === undefined || value === null || value === "",
  );
  if (missing !== undefined) {
    return error(422, { [missing[0]]: `The ${missing[0]} field is required.` });
  }
  if (words(sender.name) < 2) {
    return error(422, { errorMessage: "Contact Sender contains less than 2 words" });
  }
  if (words(recipient.name) < 2) {
    return error(422, { errorMessage: "Contact Recipient contains less than 2 words" });
  }
  return undefined;
}

export interface StubCarrier {
  /** `http://127.0.0.1:<port>/v.1.0` */
  readonly baseUrl: string;
  readonly requests: RecordedRequest[];
  /** Requests of one route, in order. */
  of(route: Route): RecordedRequest[];
  /** Replaces a route's answer while `override` returns one (`undefined`: the default answer). */
  override(route: Route, override: Override | undefined): void;
  /** The shipments the stub holds (created by POST or added by a spec), newest first like the list. */
  readonly shipments: StoredShipment[];
  addShipment(
    shipment: Partial<StoredShipment> & { clientOrder: string; createdAt: string },
  ): StoredShipment;
  /** The `exp` of the next issued JWT (seconds; `undefined`: no `exp` claim). */
  nextJwtExp: number | undefined;
  /** A delay before EVERY answer (the authorization too) that sets no `delayMs` of its own: a slow carrier. */
  latencyMs: number;
  readonly issued: string[];
  close(): Promise<void>;
}

/** A logger that keeps every line, so specs can check what the plugin logs. */
export function captureLogger(): NovaPostLogger & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    log: (message: string) => {
      lines.push(`log ${message}`);
    },
    warn: (message: string) => {
      lines.push(`warn ${message}`);
    },
  };
}

function routeOf(method: string, path: string): Route | undefined {
  if (method === "GET" && path === "/clients/authorization") return "authorization";
  if (method === "GET" && path === "/settlements") return "settlements";
  if (method === "GET" && path === "/divisions") return "divisions";
  if (method === "POST" && path === "/shipments/calculations") return "calculations";
  if (method === "POST" && path === "/shipments") return "createShipment";
  if (method === "GET" && path === "/shipments") return "listShipments";
  if (method === "DELETE" && path.startsWith("/shipments/")) return "deleteShipment";
  if (method === "GET" && path === "/shipments/tracking") return "tracking";
  if (method === "GET" && path === "/shipments/print") return "print";
  return undefined;
}

export async function startStubCarrier(): Promise<StubCarrier> {
  const requests: (RecordedRequest & { route: Route | undefined })[] = [];
  const overrides = new Map<Route, Override>();
  const shipments: StoredShipment[] = [];
  const issued: string[] = [];
  let sequence = 0;
  const carrier = {
    nextJwtExp: (Math.floor(Date.now() / 1000) + 3600) as number | undefined,
    latencyMs: 0,
  };

  const addShipment = (
    shipment: Partial<StoredShipment> & { clientOrder: string; createdAt: string },
  ): StoredShipment => {
    sequence += 1;
    const stored: StoredShipment = {
      id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      number: `2045${String(sequence).padStart(10, "0")}`,
      deleted: false,
      statusCode: 1,
      ...shipment,
    };
    shipments.unshift(stored);
    // Newest first, as production listed them (H23).
    shipments.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return stored;
  };

  const defaultAnswer = (route: Route | undefined, request: RecordedRequest): StubAnswer => {
    if (route === undefined) {
      return error(404, { errorMessage: `The route v.1.0${request.path} could not be found.` });
    }
    if (route === "authorization") {
      const key = request.query.get("apiKey");
      if (key === null || key === "")
        return error(422, { apiKey: "The api key field is required." });
      if (key !== STUB_API_KEY) return error(422, { errorMessage: "API key expired" });
      const jwt = stubJwt(issued.length + 1, carrier.nextJwtExp);
      issued.push(jwt);
      return { status: 200, json: { jwt } };
    }
    // Every other route: the raw JWT, never Bearer (H04).
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !issued.includes(authorization)) {
      return error(401, { errorMessage: "Invalid token" });
    }
    const limit = Number(request.query.get("limit") ?? "15");
    const page = Number(request.query.get("page") ?? "1");
    switch (route) {
      case "settlements": {
        // H09: `countryCodes[]=uk` is `422 validation.country_code` (only the status and the text were recorded; the key
        // here is the stub's own).
        const countries = request.query.getAll("countryCodes[]");
        if (countries.length === 0 || countries.some((code) => !/^[A-Z]{2}$/.test(code)))
          return error(422, { "countryCodes.0": "validation.country_code" });
        if (limit > 100)
          return error(422, { limit: "The limit field must not be greater than 100." });
        const language = request.headers["accept-language"] === "uk" ? "uk" : "en";
        const all = [
          settlement(STUB_CITY_ID, "Тестове Місто", "Testove Misto", language),
          settlement(STUB_EMPTY_CITY_ID, "Тестове Село", "Testove Selo", language),
        ];
        const q = (request.query.get("textSearch") ?? "").toLowerCase();
        const found = all.filter(
          (entry) => String(entry.name).toLowerCase().includes(q) || q === "тест" || q === "test",
        );
        return { status: 200, json: paged(found, page, limit) };
      }
      case "divisions": {
        if (limit > 101)
          return error(422, { limit: "The limit field must not be greater than 101." });
        let all = stubDivisions();
        const ids = request.query.getAll("ids[]");
        if (ids.length > 0) all = all.filter((entry) => ids.includes(String(entry.id)));
        const cities = request.query.getAll("settlementIds[]");
        if (cities.length > 0)
          all = all.filter((entry) =>
            cities.includes(String((entry.settlement as { id: number }).id)),
          );
        const categories = request.query.getAll("divisionCategories[]");
        if (categories.length > 0)
          all = all.filter((entry) => categories.includes(String(entry.divisionCategory)));
        return { status: 200, json: paged(all, page, limit) };
      }
      case "calculations":
        return {
          status: 200,
          json: {
            scheduledDeliveryDate: "2026-10-27T00:00:00.000000Z",
            services: [
              { serviceName: "Delivery", price: 80, discount: 0, cost: 80 },
              { serviceName: "Insurance", price: 0.5, discount: 0, cost: 0.5 },
            ],
          },
        };
      case "createShipment": {
        const problem = createBodyProblem(request.body);
        if (problem !== undefined) return problem;
        const body = request.body as { clientOrder?: string };
        const stored = addShipment({
          clientOrder: String(body.clientOrder),
          createdAt: new Date().toISOString(),
        });
        return {
          status: 201,
          json: {
            id: stored.id,
            number: stored.number,
            cost: 80,
            status: "ReadyToShip",
            parcelsAmount: 1,
            scheduledDeliveryDate: "2026-10-27T00:00:00.000000Z",
            createdAt: stored.createdAt,
            updatedAt: stored.createdAt,
            deletedAt: null,
          },
        };
      }
      case "listShipments": {
        const numbers = request.query.getAll("numbers[]");
        const ids = request.query.getAll("ids[]");
        let rows = shipments.filter((entry) => !entry.deleted);
        if (numbers.length > 0) rows = rows.filter((entry) => numbers.includes(entry.number));
        if (ids.length > 0) rows = rows.filter((entry) => ids.includes(entry.id));
        return {
          status: 200,
          json: paged(
            rows.map((entry) => ({
              id: entry.id,
              number: entry.number,
              clientOrder: entry.clientOrder,
              createdAt: entry.createdAt,
              status: "ReadyToShip",
              totalCost: 80,
              scheduledDeliveryDate: "2026-10-27T00:00:00.000000Z",
              recipient: {
                name: STUB_PERSONAL.recipientFirstName,
                phone: STUB_PERSONAL.recipientPhoneNormalized,
              },
            })),
            page,
            limit,
          ),
        };
      }
      case "deleteShipment": {
        const id = request.path.slice("/shipments/".length);
        const found = shipments.find((entry) => entry.id === id);
        if (found === undefined) return error(404, { errorMessage: "shipment_not_found" });
        if (found.deleted) return error(422, { errorMessage: "shipment_was_deleted" });
        found.deleted = true;
        found.statusCode = 2;
        return { status: 200, json: { success: true } };
      }
      case "tracking": {
        // Production answered `404 "Shipments not found"` for unknown-only batches (rerun). A MIXED batch (known and
        // unknown numbers) was NOT observed: the stub answers the known part, which is an assumption (plugin README).
        const numbers = request.query.getAll("numbers[]");
        const found = shipments.filter((entry) => numbers.includes(entry.number));
        if (found.length === 0) return error(404, { errorMessage: "Shipments not found" });
        return {
          status: 200,
          json: {
            items: found.map((entry) => ({
              currentStatus: {
                number: entry.number,
                statusCode: entry.statusCode,
                status: "Ready to send",
                statusDate: "2026-10-25T21:41:00.000000Z",
                createdDate: entry.createdAt,
              },
              detailsTracking: [{ code: String(entry.statusCode), date: entry.createdAt }],
            })),
          },
        };
      }
      case "print": {
        // `type[]` was refused on production ("The type field must be a string.", spike 7a). A missing or other `type`
        // was not observed: the stub refuses it so the plugin must send `type=marking` (the documented label type).
        if (request.query.getAll("type[]").length > 0)
          return error(422, { type: "The type field must be a string." });
        if (request.query.get("type") === null)
          return error(422, { type: "The type field is required." });
        if (request.query.get("type") !== "marking")
          return error(422, { type: "The selected type is invalid." });
        const number = request.query.getAll("numbers[]")[0];
        if (!shipments.some((entry) => entry.number === number)) {
          return error(404, { errorMessage: "shipments not found" });
        }
        return {
          status: 200,
          body: Buffer.from(`%PDF-1.4\n% stub marking label\n%%EOF\n`),
          headers: { "content-type": "application/pdf" },
        };
      }
    }
  };

  const server = createServer((incoming: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
      const path = url.pathname.replace(/^\/v\.1\.0/, "");
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      try {
        body = text === "" ? undefined : (JSON.parse(text) as unknown);
      } catch {
        body = text;
      }
      const method = incoming.method ?? "GET";
      const route = routeOf(method, path);
      const recorded = {
        route,
        method,
        path,
        rawQuery: url.search.replace(/^\?/, ""),
        query: url.searchParams,
        headers: { ...incoming.headers },
        body,
      };
      requests.push(recorded);
      const answer =
        (route === undefined ? undefined : overrides.get(route)?.(recorded)) ??
        defaultAnswer(route, recorded);
      if (answer.hang === true) {
        return;
      }
      const send = () => {
        if (response.destroyed) return;
        if (answer.body !== undefined) {
          response.writeHead(answer.status, { ...answer.headers });
          if (answer.chunked === true) {
            const bytes = Buffer.from(answer.body);
            const half = Math.floor(bytes.length / 2);
            response.write(bytes.subarray(0, half));
            response.end(bytes.subarray(half));
            return;
          }
          response.end(answer.body);
          return;
        }
        response.writeHead(answer.status, {
          "content-type": "application/json",
          ...answer.headers,
        });
        response.end(answer.json === undefined ? "" : JSON.stringify(answer.json));
      };
      const delay = answer.delayMs ?? carrier.latencyMs;
      if (delay > 0) setTimeout(send, delay);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v.1.0`,
    requests,
    of: (route) => requests.filter((request) => request.route === route),
    override: (route, override) => {
      if (override === undefined) overrides.delete(route);
      else overrides.set(route, override);
    },
    shipments,
    addShipment,
    get nextJwtExp() {
      return carrier.nextJwtExp;
    },
    set nextJwtExp(value: number | undefined) {
      carrier.nextJwtExp = value;
    },
    get latencyMs() {
      return carrier.latencyMs;
    },
    set latencyMs(value: number) {
      carrier.latencyMs = value;
    },
    issued,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
