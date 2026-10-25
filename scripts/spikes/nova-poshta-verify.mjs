// DEPRECATED 2026-10-25 (ADR 0030): this tool checks the LEGACY Nova Poshta JSON-RPC API (api.novaposhta.ua/v2.0). The
// plugin now targets the new Nova Post REST API; use scripts/spikes/nova-post-verify.mjs. Kept for history; do not extend.
//
// Nova Poshta verification spike (shipping plan step 7a, ADR 0029 decision 11). Plain Node 22 ESM, built-in fetch only,
// no dependencies, not part of any package build. How to run it, what it creates and deletes, and how to read the
// findings: scripts/spikes/README.md.
//
// Stages (--stage):
//   keyless   No key is sent. Public behaviour only: envelope and error shapes, HTTP status and content type, /xml/, plain
//             http, key-less tracking and its batch limit, a small burst. Safe to run anywhere.
//   readonly  (default) Needs NOVA_POSHTA_API_KEY. Read-only calls: directories (cities, settlements, warehouses, types),
//             language variants, price and delivery date estimates, sender counterparty and contact discovery, the
//             sender's document list. Creates nothing.
//   write     Needs NOVA_POSHTA_API_KEY and --confirm. Creates ONE waybill (and, unless --skip-repeat-create, a second one
//             with the same reference to test idempotency) on the key owner's account, finds it back, tracks it, fetches
//             its label, deletes it and checks that it is gone; cleanup is retried in a finally block. Without --confirm it
//             prints the exact call plan and exits 2 without any network call.
//   --self-test  Runs every stage against a local stub server and asserts redaction and stage gating. No network.
//
// Inputs (a flag wins over its environment variable; nothing personal is ever read from a flag):
//   NOVA_POSHTA_API_KEY                 env only. Never printed, never written; scrubbed from every output.
//   --out <path>                        findings JSON (default ./nova-poshta-findings.json, git-ignored).
//   --city-query <text>                 NP_SPIKE_CITY_QUERY; public city name for directory searches (default "Київ").
//   --sender-city-ref <uuid>            NP_SPIKE_SENDER_CITY_REF
//   --sender-warehouse-ref <uuid>       NP_SPIKE_SENDER_WAREHOUSE_REF (the branch the parcel would be handed in at)
//   --sender-counterparty-ref <uuid>    NP_SPIKE_SENDER_COUNTERPARTY_REF
//   --sender-contact-ref <uuid>         NP_SPIKE_SENDER_CONTACT_REF
//   NP_SPIKE_SENDER_PHONE               env only (380XXXXXXXXX)
//   --recipient-city-ref <uuid>         NP_SPIKE_RECIPIENT_CITY_REF
//   --recipient-warehouse-ref <uuid>    NP_SPIKE_RECIPIENT_WAREHOUSE_REF
//   --recipient-counterparty-ref <uuid> NP_SPIKE_RECIPIENT_COUNTERPARTY_REF (optional with --create-recipient)
//   --recipient-contact-ref <uuid>      NP_SPIKE_RECIPIENT_CONTACT_REF (optional with --create-recipient)
//   NP_SPIKE_RECIPIENT_FIRST_NAME, NP_SPIKE_RECIPIENT_LAST_NAME, NP_SPIKE_RECIPIENT_PHONE   env only (test data)
//   --create-recipient                  write: create the recipient with Counterparty.save (leaves an address-book entry)
//   --skip-repeat-create                write: do not send the second save with the same reference
//   --payer-type <Sender|Recipient>     write: default Recipient
//   --payment-method <Cash|NonCash>     write: default Cash
//   --weight-kg <n>                     default 0.5
//   --declared-value <n>                declared value in UAH, default 300
//   --show-sender-refs                  readonly: print the sender counterparty/contact refs to the terminal only (never
//                                       to the findings file), to fill the write stage's flags
//
// Exit codes: 0 done, 1 a stage call failed (findings still written), 2 usage or refusal (nothing sent),
// 3 the write stage could not confirm that every spike waybill is deleted (delete it by hand; the summary names it).
//
// Behind an HTTPS proxy, Node's fetch needs NODE_USE_ENV_PROXY=1 (Node >= 22.21).

import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

const SPIKE_VERSION = 1;
// Constants, never configurable from a flag or the environment (plan section 8, implementation rules: no SSRF). Only the
// self-test points the context at its local stub.
const TARGET = Object.freeze({
  apiUrl: "https://api.novaposhta.ua/v2.0/json/",
  xmlUrl: "https://api.novaposhta.ua/v2.0/xml/",
  plainHttpUrl: "http://api.novaposhta.ua/v2.0/json/",
  printBase: "https://my.novaposhta.ua",
});
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const CALL_TIMEOUT_MS = 30_000;
const REFERENCE_PREFIX = "FLUXKIT-SPIKE-";
const REDACTED = "[REDACTED]";
const DEFAULT_OUT = "nova-poshta-findings.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BOOLEAN_FLAGS = new Set([
  "confirm",
  "self-test",
  "create-recipient",
  "skip-repeat-create",
  "show-sender-refs",
  "help",
]);
const VALUE_FLAGS = new Map([
  ["stage", null],
  ["out", null],
  ["city-query", "NP_SPIKE_CITY_QUERY"],
  ["sender-city-ref", "NP_SPIKE_SENDER_CITY_REF"],
  ["sender-warehouse-ref", "NP_SPIKE_SENDER_WAREHOUSE_REF"],
  ["sender-counterparty-ref", "NP_SPIKE_SENDER_COUNTERPARTY_REF"],
  ["sender-contact-ref", "NP_SPIKE_SENDER_CONTACT_REF"],
  ["recipient-city-ref", "NP_SPIKE_RECIPIENT_CITY_REF"],
  ["recipient-warehouse-ref", "NP_SPIKE_RECIPIENT_WAREHOUSE_REF"],
  ["recipient-counterparty-ref", "NP_SPIKE_RECIPIENT_COUNTERPARTY_REF"],
  ["recipient-contact-ref", "NP_SPIKE_RECIPIENT_CONTACT_REF"],
  ["payer-type", null],
  ["payment-method", null],
  ["weight-kg", null],
  ["declared-value", null],
]);

class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// Arguments and inputs

function parseArgs(argv, env) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new UsageError(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`--${name} needs a value`);
      flags[name] = value;
      index += 1;
    } else {
      throw new UsageError(`Unknown flag: --${name}`);
    }
  }
  for (const [name, envName] of VALUE_FLAGS) {
    if (flags[name] === undefined && envName !== null && nonEmpty(env[envName])) {
      flags[name] = env[envName];
    }
  }
  const stage = flags.stage ?? "readonly";
  if (!["keyless", "readonly", "write"].includes(stage)) {
    throw new UsageError(`--stage must be keyless, readonly or write (got ${stage})`);
  }
  for (const name of [...VALUE_FLAGS.keys()].filter((key) => key.endsWith("-ref"))) {
    if (flags[name] !== undefined && !UUID.test(flags[name])) {
      throw new UsageError(`--${name} must be a uuid`);
    }
  }
  const payerType = flags["payer-type"] ?? "Recipient";
  if (!["Sender", "Recipient"].includes(payerType)) {
    throw new UsageError("--payer-type: Sender or Recipient");
  }
  const paymentMethod = flags["payment-method"] ?? "Cash";
  if (!["Cash", "NonCash"].includes(paymentMethod)) {
    throw new UsageError("--payment-method: Cash or NonCash");
  }
  const weightKg = positiveNumber(flags["weight-kg"] ?? "0.5", "--weight-kg");
  const declaredValue = positiveNumber(flags["declared-value"] ?? "300", "--declared-value");
  return {
    stage,
    out: flags.out ?? DEFAULT_OUT,
    confirm: flags.confirm === true,
    selfTest: flags["self-test"] === true,
    help: flags.help === true,
    cityQuery: flags["city-query"] ?? "Київ",
    senderCityRef: flags["sender-city-ref"],
    senderWarehouseRef: flags["sender-warehouse-ref"],
    senderCounterpartyRef: flags["sender-counterparty-ref"],
    senderContactRef: flags["sender-contact-ref"],
    senderPhone: env.NP_SPIKE_SENDER_PHONE,
    recipientCityRef: flags["recipient-city-ref"],
    recipientWarehouseRef: flags["recipient-warehouse-ref"],
    recipientCounterpartyRef: flags["recipient-counterparty-ref"],
    recipientContactRef: flags["recipient-contact-ref"],
    recipientFirstName: env.NP_SPIKE_RECIPIENT_FIRST_NAME,
    recipientLastName: env.NP_SPIKE_RECIPIENT_LAST_NAME,
    recipientPhone: env.NP_SPIKE_RECIPIENT_PHONE,
    createRecipient: flags["create-recipient"] === true,
    skipRepeatCreate: flags["skip-repeat-create"] === true,
    showSenderRefs: flags["show-sender-refs"] === true,
    payerType,
    paymentMethod,
    weightKg,
    declaredValue,
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function positiveNumber(text, name) {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0)
    throw new UsageError(`${name} must be a positive number`);
  return value;
}

function missingWriteInputs(options) {
  const missing = [];
  const need = (value, label) => {
    if (!nonEmpty(value)) missing.push(label);
  };
  need(options.senderCityRef, "--sender-city-ref");
  need(options.senderWarehouseRef, "--sender-warehouse-ref");
  need(options.senderCounterpartyRef, "--sender-counterparty-ref");
  need(options.senderContactRef, "--sender-contact-ref");
  need(options.senderPhone, "NP_SPIKE_SENDER_PHONE");
  need(options.recipientCityRef, "--recipient-city-ref");
  need(options.recipientWarehouseRef, "--recipient-warehouse-ref");
  need(options.recipientPhone, "NP_SPIKE_RECIPIENT_PHONE");
  if (options.createRecipient) {
    need(options.recipientFirstName, "NP_SPIKE_RECIPIENT_FIRST_NAME");
    need(options.recipientLastName, "NP_SPIKE_RECIPIENT_LAST_NAME");
  } else {
    need(options.recipientCounterpartyRef, "--recipient-counterparty-ref (or --create-recipient)");
    need(options.recipientContactRef, "--recipient-contact-ref (or --create-recipient)");
  }
  return missing;
}

// ---------------------------------------------------------------------------------------------------------------------
// Redaction and shapes

/** Every value that must never reach an output: the key (also URL-encoded) and the personal inputs. */
function collectSecrets(apiKey, options) {
  const secrets = [];
  const add = (value, minLength) => {
    if (typeof value === "string" && value.trim().length >= minLength) {
      secrets.push(value.trim());
      const encoded = encodeURIComponent(value.trim());
      if (encoded !== value.trim()) secrets.push(encoded);
    }
  };
  add(apiKey, 1);
  for (const phone of [options.senderPhone, options.recipientPhone]) {
    add(phone, 5);
    if (typeof phone === "string") add(phone.replace(/\D/g, ""), 5);
  }
  add(options.recipientFirstName, 2);
  add(options.recipientLastName, 2);
  // Longest first, so a secret that contains another is replaced whole.
  return secrets.sort((left, right) => right.length - left.length);
}

function scrub(text, secrets) {
  let result = String(text);
  for (const secret of secrets) result = result.split(secret).join(REDACTED);
  return result;
}

/** Carrier or error text: secrets, and any long digit run (a phone in another spelling); at most 200 characters. */
function scrubMessage(text, secrets) {
  const scrubbed = scrub(text, secrets).replace(/\+?\d{10,}/g, "[digits]");
  return scrubbed.length > 200 ? `${scrubbed.slice(0, 200)}...` : scrubbed;
}

function classifyString(value) {
  if (value === "") return "empty";
  if (UUID.test(value)) return "uuid";
  if (/^\d+$/.test(value)) return `digits(${String(value.length)})`;
  if (/^-?\d+\.\d+$/.test(value)) return "decimal";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return "datetime(YYYY-MM-DD HH:MM:SS)";
  if (/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/.test(value)) return "datetime(DD.MM.YYYY HH:MM:SS)";
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return "datetime(ISO)";
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return "date(DD.MM.YYYY)";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date(YYYY-MM-DD)";
  if (/^https?:\/\//i.test(value)) return "url";
  if (/[А-Яа-яЇїІіЄєҐґЁёЫыЭэЪъ]/.test(value)) return "text(cyrillic)";
  if (/[A-Za-z]/.test(value)) return "text(latin)";
  return "text";
}

/** Field names and types only; strings become a class, never their value. */
function shapeOf(value, depth = 0) {
  if (value === null) return "null";
  if (depth > 6) return "...";
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((item) => shapeOf(item, depth + 1));
    return {
      type: "array",
      length: value.length,
      items: items.reduce(mergeShapes, undefined) ?? null,
    };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const key of Object.keys(value).sort()) fields[key] = shapeOf(value[key], depth + 1);
    return { type: "object", fields };
  }
  if (typeof value === "string") return `string:${classifyString(value)}`;
  if (typeof value === "number") return Number.isInteger(value) ? "number:int" : "number:float";
  return typeof value;
}

function mergeShapes(left, right) {
  if (left === undefined) return right;
  if (JSON.stringify(left) === JSON.stringify(right)) return left;
  if (isObjectShape(left) && isObjectShape(right)) {
    const fields = {};
    for (const key of [
      ...new Set([...Object.keys(left.fields), ...Object.keys(right.fields)]),
    ].sort()) {
      fields[key] = mergeShapes(left.fields[key] ?? "absent", right.fields[key] ?? "absent");
    }
    return { type: "object", fields };
  }
  if (isArrayShape(left) && isArrayShape(right)) {
    return {
      type: "array",
      length: left.length === right.length ? left.length : "varies",
      items: mergeShapes(left.items ?? undefined, right.items ?? undefined) ?? null,
    };
  }
  if (typeof left === "string" && typeof right === "string") {
    return [...new Set([...left.split(" | "), ...right.split(" | ")])].sort().join(" | ");
  }
  return { anyOf: [left, right] };
}

function isObjectShape(shape) {
  return typeof shape === "object" && shape !== null && shape.type === "object";
}

function isArrayShape(shape) {
  return typeof shape === "object" && shape !== null && shape.type === "array";
}

function fieldNames(rows) {
  const names = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row !== null && typeof row === "object") for (const key of Object.keys(row)) names.add(key);
  }
  return [...names].sort();
}

function distinct(rows, field, limit = 30) {
  const values = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row !== null && typeof row === "object" && row[field] !== undefined) {
      values.add(typeof row[field] === "string" ? row[field] : JSON.stringify(row[field]));
    }
  }
  return [...values].sort().slice(0, limit);
}

function typesOf(rows, field) {
  const types = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row !== null && typeof row === "object" && field in row) {
      types.add(
        typeof row[field] === "string" ? `string:${classifyString(row[field])}` : typeof row[field],
      );
    }
  }
  return [...types].sort();
}

// ---------------------------------------------------------------------------------------------------------------------
// HTTP

const RATE_HEADER = /(rate|limit|retry|quota|throttl)/i;

async function readCapped(response) {
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error(`response larger than ${String(MAX_BODY_BYTES)} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** One HTTP exchange; returns structural facts only. The URL and body are never recorded (the key may be in either). */
async function rawRequest(ctx, url, init) {
  const started = performance.now();
  const response = await ctx.fetch(url, {
    ...init,
    signal: globalThis.AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const bytes = await readCapped(response);
  const latencyMs = Math.round(performance.now() - started);
  const headerNames = [...response.headers.keys()].sort();
  const rateHeaders = {};
  for (const name of headerNames) {
    if (RATE_HEADER.test(name))
      rateHeaders[name] = scrub(response.headers.get(name) ?? "", ctx.secrets);
  }
  const location = response.headers.get("location");
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    contentEncoding: response.headers.get("content-encoding"),
    latencyMs,
    bytes,
    headerNames,
    rateHeaders,
    setCookieNames: setCookieNames(response.headers),
    redirectHost: location === null ? null : redirectHost(location, url),
  };
}

function setCookieNames(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  return values.map((value) => value.split("=")[0]).sort();
}

function redirectHost(location, base) {
  try {
    const target = new URL(location, base);
    return `${target.protocol}//${target.host}${target.pathname === "/" ? "/" : "/..."}`;
  } catch {
    return "unparseable";
  }
}

/**
 * One JSON API call. `key`: "real" sends NOVA_POSHTA_API_KEY, "omit" sends no apiKey member, or a literal string (only
 * the keyless stage's empty and invented keys). Records the call in ctx.calls and returns the parsed envelope (or null).
 */
async function callApi(ctx, label, modelName, calledMethod, methodProperties, key = "real") {
  // Self-test seam only (deps.injectFault): simulates a bug thrown in the middle of a stage.
  if (ctx.injectFault?.(label) === true) throw new Error(`injected fault at ${label}`);
  const body = { modelName, calledMethod, methodProperties };
  if (key === "real") body.apiKey = ctx.apiKey;
  else if (key !== "omit") body.apiKey = key;
  const record = {
    label,
    modelName,
    calledMethod,
    keySent: key === "real" ? "real" : key === "omit" ? "none" : "invented",
  };
  ctx.calls.push(record);
  let exchange;
  try {
    exchange = await rawRequest(ctx, ctx.target.apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
    });
  } catch (error) {
    record.transportError = scrubMessage(errorText(error), ctx.secrets);
    return null;
  }
  Object.assign(record, describeExchange(exchange));
  const envelope = parseJson(exchange.bytes);
  if (envelope === undefined) {
    record.parseError = true;
    return null;
  }
  Object.assign(record, describeEnvelope(envelope, ctx.secrets));
  return envelope;
}

function describeExchange(exchange) {
  return {
    httpStatus: exchange.status,
    contentType: exchange.contentType,
    contentEncoding: exchange.contentEncoding,
    latencyMs: exchange.latencyMs,
    responseBytes: exchange.bytes.byteLength,
    headerNames: exchange.headerNames,
    rateHeaders: exchange.rateHeaders,
    setCookieNames: exchange.setCookieNames,
  };
}

function parseJson(bytes) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function describeEnvelope(envelope, secrets) {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { envelopeShape: shapeOf(envelope) };
  }
  const data = envelope.data;
  return {
    envelopeKeys: Object.keys(envelope).sort(),
    success: envelope.success,
    dataCount: Array.isArray(data) ? data.length : null,
    dataShape: shapeOf(data),
    infoShape: shapeOf(envelope.info),
    errors: messages(envelope.errors, secrets),
    warnings: messages(envelope.warnings, secrets),
    translatedErrors:
      envelope.translatedErrors === undefined ? undefined : shapeOf(envelope.translatedErrors),
    errorCodes: codes(envelope.errorCodes),
    warningCodes: codes(envelope.warningCodes),
    infoCodes: codes(envelope.infoCodes),
    messageCodes: codes(envelope.messageCodes),
  };
}

function messages(value, secrets) {
  if (Array.isArray(value))
    return value.slice(0, 10).map((item) => scrubMessage(String(item), secrets));
  if (value !== null && typeof value === "object") {
    return Object.values(value)
      .slice(0, 10)
      .map((item) => scrubMessage(String(item), secrets));
  }
  return value === undefined ? undefined : [scrubMessage(String(value), secrets)];
}

function codes(value) {
  const list = Array.isArray(value)
    ? value
    : value !== null && typeof value === "object"
      ? Object.values(value)
      : [];
  return list.slice(0, 20).map((code) => String(code).slice(0, 32));
}

function errorText(error) {
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error ? ` (cause: ${error.cause.name}: ${error.cause.message})` : "";
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

function rows(envelope) {
  return envelope !== null && typeof envelope === "object" && Array.isArray(envelope.data)
    ? envelope.data
    : [];
}

function totalCount(envelope) {
  const info = envelope?.info;
  if (info !== null && typeof info === "object" && !Array.isArray(info) && "totalCount" in info) {
    return Number(info.totalCount);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Time (Nova Poshta dates are expected in Kyiv local time; review M-2)

function kyivParts(date) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return parts;
}

function kyivDate(date) {
  const parts = kyivParts(date);
  return `${parts.day}.${parts.month}.${parts.year}`;
}

function kyivOffsetMinutes(date) {
  const parts = kyivParts(date);
  const wall = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return Math.round((wall - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Wall-clock text of a carrier date-time as if it were UTC (to compare against a real instant). */
function wallClockAsUtc(text) {
  let match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (match !== null)
    return Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
  match = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (match !== null)
    return Date.UTC(+match[3], +match[2] - 1, +match[1], +match[4], +match[5], +match[6]);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage: keyless

async function stageKeyless(ctx) {
  const facts = (ctx.facts.keyless = {});
  const cityProps = { FindByString: ctx.options.cityQuery, Limit: "2", Page: "1" };

  const noKey = await callApi(
    ctx,
    "getCities without apiKey",
    "Address",
    "getCities",
    cityProps,
    "omit",
  );
  const emptyKey = await callApi(
    ctx,
    "getCities with empty apiKey",
    "Address",
    "getCities",
    cityProps,
    "",
  );
  const inventedKey = randomBytes(16).toString("hex");
  const badKey = await callApi(
    ctx,
    "getCities with an invented 32-hex apiKey",
    "Address",
    "getCities",
    cityProps,
    inventedKey,
  );
  facts.missingKey = summary(ctx, noKey, -3);
  facts.emptyKey = summary(ctx, emptyKey, -2);
  facts.invalidKey = summary(ctx, badKey, -1);

  for (const [model, method, props] of [
    ["Address", "searchSettlements", { CityName: ctx.options.cityQuery, Limit: "2", Page: "1" }],
    ["Address", "getWarehouses", { Limit: "1", Page: "1" }],
    ["Address", "getWarehouseTypes", {}],
    ["InternetDocument", "getDocumentPrice", { Weight: "1" }],
  ]) {
    const envelope = await callApi(
      ctx,
      `${model}.${method} without apiKey`,
      model,
      method,
      props,
      "omit",
    );
    (facts.methodsWithoutKey ??= {})[`${model}.${method}`] = summary(ctx, envelope, -1);
  }

  const unknownModel = await callApi(
    ctx,
    "unknown modelName without apiKey",
    "FluxkitNoSuchModel",
    "noSuchMethod",
    {},
    "omit",
  );
  facts.unknownModel = summary(ctx, unknownModel, -1);

  // Invalid JSON and GET: the raw endpoint behaviour.
  for (const [label, init] of [
    [
      "POST invalid JSON",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" },
    ],
    ["GET endpoint", { method: "GET" }],
  ]) {
    const record = { label, modelName: null, calledMethod: null, keySent: "none" };
    ctx.calls.push(record);
    try {
      const exchange = await rawRequest(ctx, ctx.target.apiUrl, { ...init, redirect: "error" });
      Object.assign(record, describeExchange(exchange));
      const envelope = parseJson(exchange.bytes);
      if (envelope === undefined) record.parseError = true;
      else Object.assign(record, describeEnvelope(envelope, ctx.secrets));
    } catch (error) {
      record.transportError = scrubMessage(errorText(error), ctx.secrets);
    }
    (facts.raw ??= {})[label] = pick(record, [
      "httpStatus",
      "contentType",
      "envelopeKeys",
      "success",
      "errors",
      "errorCodes",
      "transportError",
    ]);
  }

  // The /xml/ variant (no key).
  {
    const record = {
      label: "POST /xml/ getCities without apiKey",
      modelName: "Address",
      calledMethod: "getCities",
      keySent: "none",
    };
    ctx.calls.push(record);
    try {
      const exchange = await rawRequest(ctx, ctx.target.xmlUrl, {
        method: "POST",
        headers: { "content-type": "text/xml" },
        body: '<?xml version="1.0" encoding="UTF-8"?><file><modelName>Address</modelName><calledMethod>getCities</calledMethod><methodProperties/></file>',
        redirect: "error",
      });
      Object.assign(record, describeExchange(exchange));
      const text = new TextDecoder().decode(exchange.bytes);
      record.xmlRootElement =
        /<([a-zA-Z]+)[\s>]/.exec(text.replace(/^<\?xml[^>]*\?>\s*/, ""))?.[1] ?? null;
      record.xmlHasErrorCodes = text.includes("<errorCodes>");
    } catch (error) {
      record.transportError = scrubMessage(errorText(error), ctx.secrets);
    }
    facts.xml = pick(record, [
      "httpStatus",
      "contentType",
      "xmlRootElement",
      "xmlHasErrorCodes",
      "transportError",
    ]);
  }

  // Plain http: redirected to https or served?
  {
    const record = {
      label: "GET plain http endpoint (redirect: manual)",
      modelName: null,
      calledMethod: null,
      keySent: "none",
    };
    ctx.calls.push(record);
    try {
      const exchange = await rawRequest(ctx, ctx.target.plainHttpUrl, {
        method: "GET",
        redirect: "manual",
      });
      Object.assign(record, describeExchange(exchange));
      record.redirectHost = exchange.redirectHost;
    } catch (error) {
      record.transportError = scrubMessage(errorText(error), ctx.secrets);
    }
    facts.plainHttp = pick(record, ["httpStatus", "redirectHost", "transportError"]);
  }

  // Tracking without a key: invented numbers only (14 digits starting 20, as waybill numbers are remembered to look).
  const invented = (count) =>
    Array.from({ length: count }, () => ({
      DocumentNumber: `20${String(randomInt(10 ** 11, 10 ** 12))}`,
      Phone: "",
    }));
  const one = await callApi(
    ctx,
    "getStatusDocuments, 1 invented number, no key",
    "TrackingDocument",
    "getStatusDocuments",
    { Documents: invented(1) },
    "omit",
  );
  const oneRows = rows(one);
  facts.tracking = {
    worksWithoutKey: one?.success === true,
    httpStatus: ctx.calls.at(-1).httpStatus,
    fields: fieldNames(oneRows),
    statusCodeTypes: typesOf(oneRows, "StatusCode"),
    statusCodes: distinct(oneRows, "StatusCode"),
    // Public carrier text for an invented number (not personal data).
    statusTextForInvented:
      oneRows[0]?.Status === undefined
        ? null
        : scrubMessage(String(oneRows[0].Status), ctx.secrets),
  };
  for (const count of [100, 101]) {
    const envelope = await callApi(
      ctx,
      `getStatusDocuments, ${String(count)} invented numbers, no key`,
      "TrackingDocument",
      "getStatusDocuments",
      { Documents: invented(count) },
      "omit",
    );
    facts.tracking[`batch${String(count)}`] = summary(ctx, envelope, -1);
  }

  // A small burst (sequential, key-less tracking): any throttling signal?
  const burst = [];
  for (let index = 0; index < 10; index += 1) {
    await callApi(
      ctx,
      `burst ${String(index + 1)}/10 (tracking, no key)`,
      "TrackingDocument",
      "getStatusDocuments",
      { Documents: invented(1) },
      "omit",
    );
    const record = ctx.calls.at(-1);
    burst.push({
      status: record.httpStatus ?? null,
      latencyMs: record.latencyMs ?? null,
      rateHeaders: record.rateHeaders ?? {},
    });
  }
  facts.burst = {
    statuses: [...new Set(burst.map((item) => item.status))],
    maxLatencyMs: Math.max(...burst.map((item) => item.latencyMs ?? 0)),
    anyRateHeader: burst.some((item) => Object.keys(item.rateHeaders).length > 0),
  };
  facts.headerNames = [...new Set(ctx.calls.flatMap((call) => call.headerNames ?? []))].sort();
  facts.setCookieNames = [
    ...new Set(ctx.calls.flatMap((call) => call.setCookieNames ?? [])),
  ].sort();
}

function summary(ctx, envelope, offset) {
  const record = ctx.calls.at(offset) ?? {};
  return {
    httpStatus: record.httpStatus ?? null,
    contentType: record.contentType ?? null,
    success: envelope?.success ?? null,
    dataCount: record.dataCount ?? null,
    errors: record.errors ?? null,
    warnings: record.warnings ?? null,
    errorCodes: record.errorCodes ?? null,
    warningCodes: record.warningCodes ?? null,
    envelopeKeys: record.envelopeKeys ?? null,
    transportError: record.transportError,
  };
}

function pick(object, keys) {
  const result = {};
  for (const key of keys) if (object[key] !== undefined) result[key] = object[key];
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage: readonly

async function stageReadonly(ctx) {
  const facts = (ctx.facts.readonly = {});
  const options = ctx.options;

  // Key accepted at all?
  const types = await callApi(ctx, "Address.getWarehouseTypes", "Address", "getWarehouseTypes", {});
  facts.keyAccepted = types?.success === true;
  facts.keyCheck = summary(ctx, types, -1);
  if (!facts.keyAccepted)
    throw new Error("the key was not accepted (see keyCheck); nothing else was called");
  facts.warehouseTypes = rows(types).map((row) => ({
    ref: row.Ref,
    description: row.Description,
    descriptionRu: row.DescriptionRu,
  }));

  // Public dictionaries.
  for (const [method, key] of [
    ["getServiceTypes", "serviceTypes"],
    ["getCargoTypes", "cargoTypes"],
    ["getTypesOfPayers", "payerTypes"],
    ["getPaymentForms", "paymentForms"],
    ["getTypesOfCounterparties", "counterpartyTypes"],
  ]) {
    const envelope = await callApi(ctx, `Common.${method}`, "Common", method, {});
    facts[key] =
      envelope?.success === true
        ? rows(envelope).map((row) => row.Ref)
        : summary(ctx, envelope, -1);
  }

  const settlements = await callApi(
    ctx,
    "Address.searchSettlements",
    "Address",
    "searchSettlements",
    { CityName: options.cityQuery, Limit: "5", Page: "1" },
  );
  facts.searchSettlements = { ...summary(ctx, settlements, -1), shape: ctx.calls.at(-1).dataShape };

  const cities = await callApi(ctx, "Address.getCities FindByString", "Address", "getCities", {
    FindByString: options.cityQuery,
    Limit: "5",
    Page: "1",
  });
  const cityRows = rows(cities);
  const city = cityRows[0];
  facts.getCities = {
    ...summary(ctx, cities, -1),
    fields: fieldNames(cityRows),
    descriptionFields: fieldNames(cityRows).filter((name) => /description|name/i.test(name)),
    englishFields: fieldNames(cityRows).filter((name) => /(en|eng|english)$/i.test(name)),
    totalCount: totalCount(cities),
    firstCityDescriptions: city === undefined ? null : pickMatching(city, /^Description/),
  };

  // Language variants: does any methodProperties member switch the language of the names?
  facts.cityLanguages = {};
  for (const language of ["UA", "RU", "EN", "en"]) {
    const envelope = await callApi(
      ctx,
      `Address.getCities Language=${language}`,
      "Address",
      "getCities",
      { FindByString: options.cityQuery, Limit: "1", Page: "1", Language: language },
    );
    const row = rows(envelope)[0];
    facts.cityLanguages[language] = {
      success: envelope?.success ?? null,
      warnings: ctx.calls.at(-1).warnings ?? null,
      descriptions: row === undefined ? null : pickMatching(row, /^Description/),
    };
  }

  const allCities = await callApi(
    ctx,
    "Address.getCities total (Limit 1)",
    "Address",
    "getCities",
    { Limit: "1", Page: "1" },
  );
  facts.citiesTotalCount = totalCount(allCities);

  const cityRef = options.recipientCityRef ?? city?.Ref;
  if (cityRef === undefined)
    throw new Error("no city found for --city-query; nothing to look up warehouses in");
  facts.warehouseCity =
    options.recipientCityRef === undefined
      ? "first getCities result for --city-query"
      : "--recipient-city-ref";

  const page1 = await callApi(
    ctx,
    "Address.getWarehouses CityRef Limit 50 Page 1",
    "Address",
    "getWarehouses",
    { CityRef: cityRef, Limit: "50", Page: "1" },
  );
  const page2 = await callApi(
    ctx,
    "Address.getWarehouses CityRef Limit 50 Page 2",
    "Address",
    "getWarehouses",
    { CityRef: cityRef, Limit: "50", Page: "2" },
  );
  const warehouseRows = rows(page1);
  const warehouseFields = fieldNames(warehouseRows);
  facts.getWarehouses = {
    ...summary(ctx, page1, -2),
    page2Count: rows(page2).length,
    pagesOverlap: rows(page2).some((row) => warehouseRows.some((other) => other.Ref === row.Ref)),
    totalCount: totalCount(page1),
    fields: warehouseFields,
    englishFields: warehouseFields.filter((name) => /(en|eng|english)$/i.test(name)),
    categoryOfWarehouse: distinct(warehouseRows, "CategoryOfWarehouse"),
    typeOfWarehouse: distinct(warehouseRows, "TypeOfWarehouse"),
    warehouseStatus: distinct(warehouseRows, "WarehouseStatus"),
    numberTypes: typesOf(warehouseRows, "Number"),
    placeMaxWeightTypes: typesOf(warehouseRows, "PlaceMaxWeightAllowed"),
    totalMaxWeightTypes: typesOf(warehouseRows, "TotalMaxWeightAllowed"),
    dimensionFields: warehouseFields.filter((name) =>
      /dimension|size|width|height|length/i.test(name),
    ),
    shape: ctx.calls.at(-2).dataShape,
  };

  const full = await callApi(
    ctx,
    "Address.getWarehouses CityRef (no Limit: whole city)",
    "Address",
    "getWarehouses",
    { CityRef: cityRef },
  );
  facts.getWarehousesWholeCity = {
    success: full?.success ?? null,
    count: rows(full).length,
    responseBytes: ctx.calls.at(-1).responseBytes ?? null,
    latencyMs: ctx.calls.at(-1).latencyMs ?? null,
    totalCount: totalCount(full),
  };

  const warehouse = warehouseRows[0];
  if (warehouse !== undefined) {
    const byRef = await callApi(ctx, "Address.getWarehouses by Ref", "Address", "getWarehouses", {
      Ref: warehouse.Ref,
    });
    facts.warehouseByRef = {
      ...summary(ctx, byRef, -1),
      sameRef: rows(byRef)[0]?.Ref === warehouse.Ref,
    };
    if (warehouse.Number !== undefined) {
      const byNumber = await callApi(
        ctx,
        "Address.getWarehouses CityRef + WarehouseId (number)",
        "Address",
        "getWarehouses",
        { CityRef: cityRef, WarehouseId: String(warehouse.Number) },
      );
      facts.warehouseByNumber = {
        ...summary(ctx, byNumber, -1),
        sameRef: rows(byNumber).some((row) => row.Ref === warehouse.Ref),
      };
    }
    const typeRef = warehouse.TypeOfWarehouse;
    if (typeof typeRef === "string") {
      const byType = await callApi(
        ctx,
        "Address.getWarehouses CityRef + TypeOfWarehouseRef",
        "Address",
        "getWarehouses",
        { CityRef: cityRef, TypeOfWarehouseRef: typeRef, Limit: "5", Page: "1" },
      );
      facts.warehouseByType = {
        ...summary(ctx, byType, -1),
        allOfType: rows(byType).every((row) => row.TypeOfWarehouse === typeRef),
      };
    }
    for (const language of ["EN", "en"]) {
      const envelope = await callApi(
        ctx,
        `Address.getWarehouses by Ref Language=${language}`,
        "Address",
        "getWarehouses",
        { Ref: warehouse.Ref, Language: language },
      );
      const row = rows(envelope)[0];
      (facts.warehouseLanguages ??= {})[language] = {
        success: envelope?.success ?? null,
        descriptionChanged: row === undefined ? null : row.Description !== warehouse.Description,
        descriptions: row === undefined ? null : pickMatching(row, /^(Description|ShortAddress)/),
      };
    }
  }

  const unknownCity = await callApi(
    ctx,
    "Address.getWarehouses unknown CityRef",
    "Address",
    "getWarehouses",
    { CityRef: randomUUID(), Limit: "5", Page: "1" },
  );
  facts.unknownCityRef = summary(ctx, unknownCity, -1);
  const unknownPoint = await callApi(
    ctx,
    "Address.getWarehouses unknown Ref",
    "Address",
    "getWarehouses",
    { Ref: randomUUID() },
  );
  facts.unknownWarehouseRef = summary(ctx, unknownPoint, -1);

  // Price and delivery date.
  const senderCity = options.senderCityRef ?? cityRef;
  const recipientCity = options.recipientCityRef ?? cityRef;
  const priceProps = (serviceType) => ({
    CitySender: senderCity,
    CityRecipient: recipientCity,
    Weight: String(options.weightKg),
    ServiceType: serviceType,
    Cost: String(options.declaredValue),
    CargoType: "Parcel",
    SeatsAmount: "1",
  });
  const price = await callApi(
    ctx,
    "InternetDocument.getDocumentPrice WarehouseWarehouse",
    "InternetDocument",
    "getDocumentPrice",
    priceProps("WarehouseWarehouse"),
  );
  const priceRow = rows(price)[0];
  facts.documentPrice = {
    ...summary(ctx, price, -1),
    fields: fieldNames(rows(price)),
    costType: priceRow === undefined ? null : typesOf([priceRow], "Cost"),
    assessedCostType: priceRow === undefined ? null : typesOf([priceRow], "AssessedCost"),
    costHasFraction: priceRow === undefined ? null : !Number.isInteger(Number(priceRow.Cost)),
  };
  facts.priceByServiceType = {};
  const serviceTypes = Array.isArray(facts.serviceTypes)
    ? facts.serviceTypes
    : ["WarehouseWarehouse", "WarehouseDoors", "DoorsWarehouse", "DoorsDoors", "WarehousePostomat"];
  for (const serviceType of serviceTypes) {
    if (serviceType === "WarehouseWarehouse") continue;
    const envelope = await callApi(
      ctx,
      `getDocumentPrice ${String(serviceType)}`,
      "InternetDocument",
      "getDocumentPrice",
      priceProps(serviceType),
    );
    facts.priceByServiceType[serviceType] = {
      success: envelope?.success ?? null,
      errorCodes: ctx.calls.at(-1).errorCodes ?? null,
    };
  }
  const badWeight = await callApi(
    ctx,
    "getDocumentPrice Weight -1 (error sample)",
    "InternetDocument",
    "getDocumentPrice",
    { ...priceProps("WarehouseWarehouse"), Weight: "-1" },
  );
  facts.priceErrorSample = summary(ctx, badWeight, -1);

  const deliveryDate = await callApi(
    ctx,
    "InternetDocument.getDocumentDeliveryDate",
    "InternetDocument",
    "getDocumentDeliveryDate",
    {
      DateTime: kyivDate(ctx.now()),
      ServiceType: "WarehouseWarehouse",
      CitySender: senderCity,
      CityRecipient: recipientCity,
    },
  );
  facts.deliveryDate = { ...summary(ctx, deliveryDate, -1), shape: ctx.calls.at(-1).dataShape };

  // Sender discovery: structure only.
  const senders = await callApi(
    ctx,
    "Counterparty.getCounterparties Sender",
    "Counterparty",
    "getCounterparties",
    { CounterpartyProperty: "Sender", Page: "1" },
  );
  const senderRows = rows(senders);
  facts.senderCounterparties = {
    ...summary(ctx, senders, -1),
    fields: fieldNames(senderRows),
    counterpartyTypes: distinct(senderRows, "CounterpartyType"),
  };
  const senderRef = options.senderCounterpartyRef ?? senderRows[0]?.Ref;
  if (options.showSenderRefs) {
    ctx.terminalOnly("Sender counterparty refs (terminal only, not in the findings file):");
    for (const row of senderRows.slice(0, 10))
      ctx.terminalOnly(
        `  counterparty ${String(row.Ref)} type ${String(row.CounterpartyType ?? "?")}`,
      );
  }
  if (typeof senderRef === "string") {
    const contacts = await callApi(
      ctx,
      "Counterparty.getCounterpartyContactPersons",
      "Counterparty",
      "getCounterpartyContactPersons",
      { Ref: senderRef, Page: "1" },
    );
    facts.senderContacts = { ...summary(ctx, contacts, -1), fields: fieldNames(rows(contacts)) };
    if (options.showSenderRefs) {
      for (const row of rows(contacts).slice(0, 10))
        ctx.terminalOnly(`  contact ${String(row.Ref)}`);
    }
    const addresses = await callApi(
      ctx,
      "Counterparty.getCounterpartyAddresses",
      "Counterparty",
      "getCounterpartyAddresses",
      { Ref: senderRef, CounterpartyProperty: "Sender" },
    );
    facts.senderAddresses = { ...summary(ctx, addresses, -1), fields: fieldNames(rows(addresses)) };
  }

  // The sender's document list (structure only): is our reference field there, and how are dates written?
  const now = ctx.now();
  const list = await callApi(
    ctx,
    "InternetDocument.getDocumentList last 7 days",
    "InternetDocument",
    "getDocumentList",
    {
      DateTimeFrom: kyivDate(new Date(now.getTime() - 7 * 86_400_000)),
      DateTimeTo: kyivDate(now),
      GetFullList: "1",
      Page: "1",
    },
  );
  const listRows = rows(list);
  facts.documentList = {
    ...summary(ctx, list, -1),
    fields: fieldNames(listRows),
    hasInfoRegClientBarcodes: fieldNames(listRows).includes("InfoRegClientBarcodes"),
    dateFieldFormats: Object.fromEntries(
      fieldNames(listRows)
        .filter((name) => /date|time/i.test(name))
        .map((name) => [name, typesOf(listRows, name)]),
    ),
  };
}

function pickMatching(row, pattern) {
  const result = {};
  for (const key of Object.keys(row).sort()) if (pattern.test(key)) result[key] = row[key];
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage: write

function writePlan(options) {
  const steps = [
    "(first) the keyless calls of --stage keyless: no key is sent, nothing is created",
  ];
  if (options.createRecipient) {
    steps.push(
      "Counterparty.save (PrivatePerson, Recipient) - creates the test recipient (stays in the address book)",
    );
  }
  steps.push(
    `InternetDocument.save - creates waybill A with InfoRegClientBarcodes ${REFERENCE_PREFIX}<timestamp>-<random>`,
  );
  if (!options.skipRepeatCreate) {
    steps.push(
      "InternetDocument.save - the SAME request again (idempotency test; may create waybill B)",
    );
  }
  steps.push(
    "InternetDocument.getDocumentList - Kyiv dates yesterday..tomorrow, find A (and B) by reference and by Ref",
    "TrackingDocument.getStatusDocuments - A's number with the sender phone, then without a phone",
    "GET my.novaposhta.ua printDocument (pdf) and printMarking100x100 (pdf) for A, with the key in the path; once without",
    "InternetDocument.delete - DocumentRefs [A, B]",
    "InternetDocument.getDocumentList and TrackingDocument.getStatusDocuments - check A and B are gone",
    "finally: InternetDocument.delete again for any waybill not confirmed gone",
  );
  return steps;
}

async function stageWrite(ctx) {
  const facts = (ctx.facts.write = {});
  const options = ctx.options;
  const created = []; // {label, ref, number, deleted}
  const now = ctx.now();
  const reference = `${REFERENCE_PREFIX}${now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}-${randomBytes(2).toString("hex").toUpperCase()}`;
  facts.reference = reference;
  facts.referenceLength = reference.length;
  try {
    let recipientRef = options.recipientCounterpartyRef;
    let recipientContactRef = options.recipientContactRef;
    if (options.createRecipient) {
      const recipient = await callApi(ctx, "Counterparty.save recipient", "Counterparty", "save", {
        FirstName: options.recipientFirstName,
        LastName: options.recipientLastName,
        Phone: options.recipientPhone,
        CounterpartyType: "PrivatePerson",
        CounterpartyProperty: "Recipient",
      });
      const row = rows(recipient)[0];
      facts.createRecipient = { ...summary(ctx, recipient, -1), shape: ctx.calls.at(-1).dataShape };
      recipientRef = row?.Ref;
      recipientContactRef = row?.ContactPerson?.data?.[0]?.Ref;
      if (typeof recipientRef !== "string" || typeof recipientContactRef !== "string") {
        throw new Error(
          "Counterparty.save gave no recipient and contact refs (see createRecipient)",
        );
      }
    }

    const saveProps = {
      PayerType: options.payerType,
      PaymentMethod: options.paymentMethod,
      DateTime: kyivDate(now),
      CargoType: "Parcel",
      Weight: String(options.weightKg),
      ServiceType: "WarehouseWarehouse",
      SeatsAmount: "1",
      Description: "Fluxkit API check, delete",
      Cost: String(options.declaredValue),
      CitySender: options.senderCityRef,
      Sender: options.senderCounterpartyRef,
      SenderAddress: options.senderWarehouseRef,
      ContactSender: options.senderContactRef,
      SendersPhone: options.senderPhone,
      CityRecipient: options.recipientCityRef,
      Recipient: recipientRef,
      RecipientAddress: options.recipientWarehouseRef,
      ContactRecipient: recipientContactRef,
      RecipientsPhone: options.recipientPhone,
      InfoRegClientBarcodes: reference,
    };
    const save = async (label) => {
      const before = ctx.now();
      const envelope = await callApi(ctx, label, "InternetDocument", "save", saveProps);
      const after = ctx.now();
      const row = rows(envelope)[0];
      if (envelope?.success === true && typeof row?.Ref === "string") {
        created.push({
          label,
          ref: row.Ref,
          number: row.IntDocNumber,
          deleted: false,
          savedBetween: [before, after],
        });
      }
      return { envelope, row };
    };
    const first = await save("InternetDocument.save (A)");
    facts.save = {
      ...summary(ctx, first.envelope, -1),
      fields: fieldNames(rows(first.envelope)),
      shape: ctx.calls.at(-1).dataShape,
      intDocNumberFormat: first.row === undefined ? null : typesOf([first.row], "IntDocNumber"),
      costOnSiteType: first.row === undefined ? null : typesOf([first.row], "CostOnSite"),
      estimatedDeliveryDateFormat:
        first.row === undefined ? null : typesOf([first.row], "EstimatedDeliveryDate"),
    };
    if (created.length === 0)
      throw new Error("InternetDocument.save (A) did not create a waybill (see save)");
    const a = created[0];

    if (!options.skipRepeatCreate) {
      const second = await save("InternetDocument.save (B, same reference)");
      facts.repeatSave = {
        ...summary(ctx, second.envelope, -1),
        createdAnother: created.length === 2,
        sameRef: second.row?.Ref === a.ref,
        sameNumber: second.row?.IntDocNumber === a.number,
      };
    }

    // Find back by reference within the Kyiv-date window around now.
    const findAll = async (label) => {
      const at = ctx.now();
      const envelope = await callApi(ctx, label, "InternetDocument", "getDocumentList", {
        DateTimeFrom: kyivDate(new Date(at.getTime() - 86_400_000)),
        DateTimeTo: kyivDate(new Date(at.getTime() + 86_400_000)),
        GetFullList: "1",
        Page: "1",
      });
      return { envelope, list: rows(envelope) };
    };
    const found = await findAll("InternetDocument.getDocumentList (find A)");
    const byRef = found.list.find((row) => row.Ref === a.ref);
    const byReference = found.list.filter((row) => row.InfoRegClientBarcodes === reference);
    facts.findBack = {
      ...summary(ctx, found.envelope, -1),
      foundByRef: byRef !== undefined,
      foundByReferenceCount: byReference.length,
      referenceFieldPresent: fieldNames(found.list).includes("InfoRegClientBarcodes"),
      fields: fieldNames(found.list),
      dateFieldFormats:
        byRef === undefined
          ? null
          : Object.fromEntries(
              Object.keys(byRef)
                .filter((name) => /date|time/i.test(name))
                .map((name) => [name, typesOf([byRef], name)]),
            ),
    };
    // Which clock are the carrier's creation times in? Compare the wall clock with the instant of our save.
    if (byRef !== undefined) {
      for (const field of ["DateTime", "CreateTime", "DateCreated"]) {
        const wall = typeof byRef[field] === "string" ? wallClockAsUtc(byRef[field]) : null;
        if (wall === null) continue;
        const [before, after] = a.savedBetween;
        const mid = (before.getTime() + after.getTime()) / 2;
        const offsetMinutes = Math.round((wall - mid) / 60000 / 30) * 30;
        facts.creationClock = {
          field,
          offsetMinutesFromUtc: offsetMinutes,
          kyivOffsetMinutesNow: kyivOffsetMinutes(after),
          matchesKyiv: offsetMinutes === kyivOffsetMinutes(after),
          hasSeconds: /:\d{2}:\d{2}$/.test(byRef[field]),
        };
        break;
      }
    }

    // Tracking with and without the sender phone.
    const trackWith = await callApi(
      ctx,
      "getStatusDocuments (A, sender phone)",
      "TrackingDocument",
      "getStatusDocuments",
      { Documents: [{ DocumentNumber: a.number, Phone: options.senderPhone }] },
    );
    const trackWithout = await callApi(
      ctx,
      "getStatusDocuments (A, no phone)",
      "TrackingDocument",
      "getStatusDocuments",
      { Documents: [{ DocumentNumber: a.number, Phone: "" }] },
    );
    const filled = (row) =>
      row === undefined
        ? 0
        : Object.values(row).filter((value) => value !== "" && value !== null && value !== 0)
            .length;
    facts.tracking = {
      withPhone: {
        ...summary(ctx, trackWith, -2),
        statusCode: rows(trackWith)[0]?.StatusCode ?? null,
        filledFields: filled(rows(trackWith)[0]),
      },
      withoutPhone: {
        ...summary(ctx, trackWithout, -1),
        statusCode: rows(trackWithout)[0]?.StatusCode ?? null,
        filledFields: filled(rows(trackWithout)[0]),
      },
      fieldsOnlyWithPhone: fieldNames(rows(trackWith)).filter(
        (name) =>
          !["", null, 0, undefined].includes(rows(trackWith)[0]?.[name]) &&
          ["", null, 0, undefined].includes(rows(trackWithout)[0]?.[name]),
      ),
    };

    // Labels: the key goes into the URL path, which is never recorded.
    facts.labels = {};
    for (const [name, path] of [
      ["printDocument", `/orders/printDocument/orders[]/${a.ref}/type/pdf/apiKey/${ctx.apiKey}`],
      [
        "printMarking100x100",
        `/orders/printMarking100x100/orders[]/${a.ref}/type/pdf/apiKey/${ctx.apiKey}`,
      ],
      ["printDocumentWithoutKey", `/orders/printDocument/orders[]/${a.ref}/type/pdf`],
    ]) {
      const record = {
        label: `GET label ${name}`,
        modelName: null,
        calledMethod: null,
        keySent: name.endsWith("WithoutKey") ? "none" : "real (in URL path)",
      };
      ctx.calls.push(record);
      try {
        const exchange = await rawRequest(ctx, `${ctx.target.printBase}${path}`, {
          method: "GET",
          redirect: "manual",
        });
        Object.assign(record, describeExchange(exchange));
        record.redirectHost = exchange.redirectHost;
        record.startsWithPdf = exchange.bytes.subarray(0, 5).toString("latin1") === "%PDF-";
        facts.labels[name] = pick(record, [
          "httpStatus",
          "contentType",
          "responseBytes",
          "startsWithPdf",
          "redirectHost",
          "latencyMs",
        ]);
      } catch (error) {
        record.transportError = scrubMessage(errorText(error), ctx.secrets);
        facts.labels[name] = { transportError: record.transportError };
      }
    }
    facts.labelUrlTemplate =
      "https://my.novaposhta.ua/orders/<printDocument|printMarking100x100>/orders[]/<Ref>/type/pdf/apiKey/<KEY>";

    // Delete and verify.
    const refs = created.map((item) => item.ref);
    const del = await callApi(ctx, "InternetDocument.delete", "InternetDocument", "delete", {
      DocumentRefs: refs,
    });
    facts.delete = { ...summary(ctx, del, -1), shape: ctx.calls.at(-1).dataShape };
    if (del?.success === true) {
      const deletedRefs = new Set(rows(del).map((row) => row.Ref));
      for (const item of created) if (deletedRefs.has(item.ref)) item.deleted = true;
    }
    const after = await findAll("InternetDocument.getDocumentList (after delete)");
    const trackAfter = await callApi(
      ctx,
      "getStatusDocuments (A after delete)",
      "TrackingDocument",
      "getStatusDocuments",
      { Documents: [{ DocumentNumber: a.number, Phone: options.senderPhone }] },
    );
    facts.afterDelete = {
      stillListed: created.filter((item) => after.list.some((row) => row.Ref === item.ref)).length,
      listCallSucceeded: after.envelope?.success === true,
      trackingStatusCode: rows(trackAfter)[0]?.StatusCode ?? null,
    };
    for (const item of created) {
      item.deleted =
        item.deleted &&
        after.envelope?.success === true &&
        !after.list.some((row) => row.Ref === item.ref);
    }
  } finally {
    await cleanup(ctx, created);
  }
}

async function cleanup(ctx, created) {
  const pending = created.filter((item) => !item.deleted);
  const result = { created: created.length, retried: pending.length, leftovers: [] };
  if (pending.length > 0) {
    try {
      const envelope = await callApi(
        ctx,
        "cleanup InternetDocument.delete",
        "InternetDocument",
        "delete",
        { DocumentRefs: pending.map((item) => item.ref) },
      );
      const deletedRefs = new Set(
        envelope?.success === true ? rows(envelope).map((row) => row.Ref) : [],
      );
      for (const item of pending) if (deletedRefs.has(item.ref)) item.deleted = true;
    } catch (error) {
      result.cleanupError = scrubMessage(errorText(error), ctx.secrets);
    }
  }
  for (const item of created) {
    // Our own spike waybill number: needed to delete it by hand; not personal data.
    if (!item.deleted) result.leftovers.push(String(item.number ?? item.ref));
  }
  ctx.cleanup = result;
}

// ---------------------------------------------------------------------------------------------------------------------
// The plan's "from memory" list (docs/plans/2026-10-24-shipping.md section 8) and what the run says about each item

const NOT_TESTED = (why) => ({ status: "NOT TESTED", fact: why });
const verdict = (ok, fact) => ({ status: ok ? "CONFIRMED" : "DIFFERENT", fact });

const HYPOTHESES = [
  [
    "H01",
    "Endpoint https://api.novaposhta.ua/v2.0/json/, POST JSON {apiKey, modelName, calledMethod, methodProperties}",
    (f) => {
      const k = f.keyless;
      if (k?.missingKey?.envelopeKeys === null || k?.missingKey === undefined)
        return NOT_TESTED("no key-less answer");
      return verdict(
        Array.isArray(k.missingKey.envelopeKeys),
        `the endpoint answers a JSON envelope to a POST of that body (key-less: HTTP ${String(k.missingKey.httpStatus)}, ${String(k.missingKey.contentType)})`,
      );
    },
  ],
  [
    "H02",
    "HTTP 200 even for errors",
    (f) => {
      const k = f.keyless;
      if (k === undefined) return NOT_TESTED("keyless stage not run");
      const statuses = [
        k.missingKey?.httpStatus,
        k.invalidKey?.httpStatus,
        k.unknownModel?.httpStatus,
        k.raw?.["POST invalid JSON"]?.httpStatus,
      ];
      const non200 = statuses.filter((status) => status !== 200);
      return verdict(
        non200.length === 0,
        `missing/invalid key: HTTP ${String(k.missingKey?.httpStatus)}/${String(k.invalidKey?.httpStatus)}; unknown model: ${String(k.unknownModel?.httpStatus)}; invalid JSON: ${String(k.raw?.["POST invalid JSON"]?.httpStatus)}${f.readonly?.priceErrorSample ? `; price error with a key: ${String(f.readonly.priceErrorSample.httpStatus)}` : ""}`,
      );
    },
  ],
  [
    "H03",
    "Envelope {success, data[], errors[], warnings[], info, messageCodes, errorCodes, warningCodes, infoCodes}",
    (f) => {
      const keys = f.keyless?.missingKey?.envelopeKeys;
      if (!Array.isArray(keys)) return NOT_TESTED("no envelope seen");
      const expected = [
        "data",
        "errorCodes",
        "errors",
        "info",
        "infoCodes",
        "messageCodes",
        "success",
        "warningCodes",
        "warnings",
      ];
      const missing = expected.filter((key) => !keys.includes(key));
      const seen = [
        keys,
        ...Object.values(f.keyless.raw ?? {}).map((raw) => raw.envelopeKeys ?? []),
      ].flat();
      const extra = [...new Set(seen)].filter((key) => !expected.includes(key)).sort();
      return verdict(
        missing.length === 0,
        `keys: ${keys.join(", ")}${missing.length ? `; missing ${missing.join(", ")}` : ""}${extra.length ? `; also seen: ${extra.join(", ")}` : ""}`,
      );
    },
  ],
  [
    "H04",
    "Errors come as text plus codes",
    (f) => {
      const k = f.keyless?.missingKey;
      if (k === undefined) return NOT_TESTED("no error seen");
      return verdict(
        (k.errors?.length ?? 0) > 0 && (k.errorCodes?.length ?? 0) > 0,
        `missing key: errors ${JSON.stringify(k.errors)}, errorCodes ${JSON.stringify(k.errorCodes)}; unknown model: success false, warnings ${JSON.stringify(f.keyless.unknownModel?.warnings)} with codes ${JSON.stringify(f.keyless.unknownModel?.warningCodes)}; invalid JSON: errors ${JSON.stringify(f.keyless.raw?.["POST invalid JSON"]?.errors)} with codes ${JSON.stringify(f.keyless.raw?.["POST invalid JSON"]?.errorCodes)}`,
      );
    },
  ],
  [
    "H04b",
    "Error texts are Ukrainian or Russian",
    (f) => {
      const texts = f.calls
        .flatMap((call) => [...(call.errors ?? []), ...(call.warnings ?? [])])
        .filter((text) => text !== "");
      if (texts.length === 0) return NOT_TESTED("no error text seen");
      const classes = [...new Set(texts.map((text) => classifyString(text)))].sort();
      return verdict(
        classes.includes("text(cyrillic)"),
        `${String(texts.length)} error/warning texts seen, script classes: ${classes.join(", ")}`,
      );
    },
  ],
  [
    "H05",
    "The API key travels in the request body",
    (f) => {
      if (f.readonly?.keyAccepted === true)
        return verdict(true, "a key in the body is accepted (readonly stage)");
      if (f.keyless?.missingKey)
        return NOT_TESTED(
          `key-less only: a body without apiKey is refused with ${JSON.stringify(f.keyless.missingKey.errorCodes)}; acceptance of a real key not tested`,
        );
      return NOT_TESTED("not run");
    },
  ],
  [
    "H06",
    "An /xml/ variant exists",
    (f) => {
      const x = f.keyless?.xml;
      if (x === undefined || x.transportError) return NOT_TESTED(x?.transportError ?? "not run");
      return verdict(
        x.xmlHasErrorCodes === true,
        `POST /v2.0/xml/: HTTP ${String(x.httpStatus)}, ${String(x.contentType)}, root <${String(x.xmlRootElement)}> with the same members`,
      );
    },
  ],
  [
    "H07",
    "Address.searchSettlements (city search, Page/Limit)",
    (f) => {
      const s = f.readonly?.searchSettlements;
      if (s === undefined)
        return NOT_TESTED(
          f.keyless
            ? `needs a key (key-less: HTTP ${String(f.keyless.methodsWithoutKey?.["Address.searchSettlements"]?.httpStatus)})`
            : "not run",
        );
      return verdict(
        s.success === true,
        `success ${String(s.success)}, data count ${String(s.dataCount)}`,
      );
    },
  ],
  [
    "H08",
    "Address.getCities (FindByString, Page/Limit)",
    (f) => {
      const c = f.readonly?.getCities;
      if (c === undefined) return NOT_TESTED("needs a key");
      return verdict(
        c.success === true,
        `success ${String(c.success)}, ${String(c.dataCount)} rows, info.totalCount ${String(c.totalCount)}; whole country: ${String(f.readonly.citiesTotalCount)} cities`,
      );
    },
  ],
  [
    "H09",
    "Address.getWarehouses by CityRef, FindByString, TypeOfWarehouseRef, paging",
    (f) => {
      const w = f.readonly?.getWarehouses;
      if (w === undefined) return NOT_TESTED("needs a key");
      return verdict(
        w.success === true,
        `page 1: ${String(w.dataCount)} rows, page 2: ${String(w.page2Count)}, overlap ${String(w.pagesOverlap)}, totalCount ${String(w.totalCount)}; by type: ${String(f.readonly.warehouseByType?.success)} (all of type ${String(f.readonly.warehouseByType?.allOfType)}); by Ref: ${String(f.readonly.warehouseByRef?.sameRef)}; whole city ${String(f.readonly.getWarehousesWholeCity?.count)} points, ${String(f.readonly.getWarehousesWholeCity?.responseBytes)} bytes`,
      );
    },
  ],
  [
    "H10",
    "Warehouse fields Ref, Number, Description, DescriptionRu, ShortAddress, CategoryOfWarehouse (Branch, Postomat), PlaceMaxWeightAllowed, TotalMaxWeightAllowed, dimension limits, WarehouseStatus",
    (f) => {
      const w = f.readonly?.getWarehouses;
      if (w === undefined) return NOT_TESTED("needs a key");
      const expected = [
        "Ref",
        "Number",
        "Description",
        "DescriptionRu",
        "ShortAddress",
        "CategoryOfWarehouse",
        "PlaceMaxWeightAllowed",
        "TotalMaxWeightAllowed",
        "WarehouseStatus",
      ];
      const missing = expected.filter((name) => !w.fields.includes(name));
      return verdict(
        missing.length === 0,
        `${missing.length ? `missing ${missing.join(", ")}; ` : ""}CategoryOfWarehouse ${JSON.stringify(w.categoryOfWarehouse)}, Number ${JSON.stringify(w.numberTypes)}, PlaceMaxWeightAllowed ${JSON.stringify(w.placeMaxWeightTypes)}, dimension fields ${JSON.stringify(w.dimensionFields)}`,
      );
    },
  ],
  [
    "H11",
    "Address.getWarehouseTypes",
    (f) => {
      if (f.readonly?.warehouseTypes === undefined) return NOT_TESTED("needs a key");
      return verdict(
        f.readonly.warehouseTypes.length > 0,
        `${String(f.readonly.warehouseTypes.length)} types`,
      );
    },
  ],
  [
    "H12",
    "No English names (only uk Description and DescriptionRu)",
    (f) => {
      const c = f.readonly?.getCities;
      if (c === undefined) return NOT_TESTED("needs a key");
      const englishSwitch = Object.entries(f.readonly.cityLanguages ?? {}).some(
        ([language, value]) =>
          language.toLowerCase() === "en" &&
          classifyString(String(Object.values(value.descriptions ?? {})[0] ?? "")) ===
            "text(latin)",
      );
      const englishFields = [
        ...c.englishFields,
        ...(f.readonly.getWarehouses?.englishFields ?? []),
      ];
      return verdict(
        englishFields.length === 0 && !englishSwitch,
        `English-looking fields: ${JSON.stringify(englishFields)}; Language=EN gives Latin names: ${String(englishSwitch)}`,
      );
    },
  ],
  [
    "H13",
    "getDocumentPrice returns Cost and AssessedCost (numbers or decimal strings, UAH)",
    (f) => {
      const p = f.readonly?.documentPrice;
      if (p === undefined) return NOT_TESTED("needs a key");
      return verdict(
        p.success === true && p.fields.includes("Cost"),
        `fields ${JSON.stringify(p.fields)}; Cost ${JSON.stringify(p.costType)}, AssessedCost ${JSON.stringify(p.assessedCostType)}, fraction ${String(p.costHasFraction)}`,
      );
    },
  ],
  [
    "H14",
    "ServiceType WarehouseWarehouse/WarehouseDoors/DoorsWarehouse/DoorsDoors and a postomat type",
    (f) => {
      const s = f.readonly?.serviceTypes;
      if (s === undefined) return NOT_TESTED("needs a key");
      if (!Array.isArray(s))
        return verdict(false, `Common.getServiceTypes failed: ${JSON.stringify(s)}`);
      const expected = ["WarehouseWarehouse", "WarehouseDoors", "DoorsWarehouse", "DoorsDoors"];
      return verdict(
        expected.every((item) => s.includes(item)),
        `service types: ${s.join(", ")}; price per type: ${JSON.stringify(f.readonly.priceByServiceType)}`,
      );
    },
  ],
  [
    "H15",
    "CargoType Parcel/Cargo/Documents",
    (f) => {
      const c = f.readonly?.cargoTypes;
      if (c === undefined) return NOT_TESTED("needs a key");
      if (!Array.isArray(c))
        return verdict(false, `Common.getCargoTypes failed: ${JSON.stringify(c)}`);
      return verdict(
        ["Parcel", "Cargo", "Documents"].every((item) => c.includes(item)),
        `cargo types: ${c.join(", ")}`,
      );
    },
  ],
  [
    "H16",
    "InternetDocument.getDocumentDeliveryDate gives an estimated date",
    (f) => {
      const d = f.readonly?.deliveryDate;
      if (d === undefined) return NOT_TESTED("needs a key");
      return verdict(
        d.success === true,
        `success ${String(d.success)}; shape ${JSON.stringify(d.shape)}`,
      );
    },
  ],
  [
    "H17",
    "InternetDocument.save answers Ref, IntDocNumber, CostOnSite, EstimatedDeliveryDate",
    (f) => {
      const s = f.write?.save;
      if (s === undefined) return NOT_TESTED("needs the write stage");
      const missing = ["Ref", "IntDocNumber", "CostOnSite", "EstimatedDeliveryDate"].filter(
        (name) => !s.fields.includes(name),
      );
      return verdict(
        s.success === true && missing.length === 0,
        `fields ${JSON.stringify(s.fields)}; IntDocNumber ${JSON.stringify(s.intDocNumberFormat)}, CostOnSite ${JSON.stringify(s.costOnSiteType)}, EstimatedDeliveryDate ${JSON.stringify(s.estimatedDeliveryDateFormat)}`,
      );
    },
  ],
  [
    "H18",
    "InfoRegClientBarcodes carries our reference and comes back",
    (f) => {
      const b = f.write?.findBack;
      if (b === undefined) return NOT_TESTED("needs the write stage");
      return verdict(
        b.referenceFieldPresent && b.foundByReferenceCount > 0,
        `field in getDocumentList: ${String(b.referenceFieldPresent)}; documents with our reference: ${String(b.foundByReferenceCount)}; reference length ${String(f.write.referenceLength)}`,
      );
    },
  ],
  [
    "H19",
    "getDocumentList lists the sender's documents for a date range (reconcile after a lost answer)",
    (f) => {
      const b = f.write?.findBack;
      if (b === undefined) {
        const l = f.readonly?.documentList;
        return l === undefined
          ? NOT_TESTED("needs a key")
          : NOT_TESTED(
              `readonly only: success ${String(l.success)}, ${String(l.dataCount)} documents in 7 days; finding a fresh one needs the write stage`,
            );
      }
      return verdict(
        b.foundByRef,
        `fresh waybill found by Ref: ${String(b.foundByRef)}; by reference: ${String(b.foundByReferenceCount)}`,
      );
    },
  ],
  [
    "H20",
    "Document dates are Kyiv local dates (review M-2)",
    (f) => {
      const c = f.write?.creationClock;
      if (c === undefined) return NOT_TESTED("needs the write stage");
      return verdict(
        c.matchesKyiv,
        `${c.field} is ${String(c.offsetMinutesFromUtc)} min from UTC (Kyiv now: ${String(c.kyivOffsetMinutesNow)}); seconds present: ${String(c.hasSeconds)}`,
      );
    },
  ],
  [
    "H21",
    "InternetDocument.delete (DocumentRefs) cancels a waybill not handed over",
    (f) => {
      const d = f.write?.delete;
      if (d === undefined) return NOT_TESTED("needs the write stage");
      return verdict(
        d.success === true && f.write.afterDelete?.stillListed === 0,
        `success ${String(d.success)}; still listed after: ${String(f.write.afterDelete?.stillListed)}; tracking status after: ${String(f.write.afterDelete?.trackingStatusCode)}`,
      );
    },
  ],
  [
    "H22",
    "getStatusDocuments takes Documents [{DocumentNumber, Phone}], up to 100 per call",
    (f) => {
      const t = f.keyless?.tracking;
      if (t === undefined) return NOT_TESTED("not run");
      const ok100 = t.batch100?.success === true;
      const refused101 = t.batch101?.success === false;
      return verdict(
        t.worksWithoutKey && ok100 && refused101,
        `works without a key: ${String(t.worksWithoutKey)}; 100 numbers: success ${String(t.batch100?.success)} (${String(t.batch100?.dataCount)} rows); 101: success ${String(t.batch101?.success)}, codes ${JSON.stringify(t.batch101?.errorCodes)} ${JSON.stringify(t.batch101?.errors)}`,
      );
    },
  ],
  [
    "H23",
    "Without a phone the tracking answer is reduced",
    (f) => {
      const t = f.write?.tracking;
      if (t === undefined) return NOT_TESTED("needs a real waybill (write stage)");
      return verdict(
        t.withPhone.filledFields > t.withoutPhone.filledFields,
        `filled fields with phone ${String(t.withPhone.filledFields)}, without ${String(t.withoutPhone.filledFields)}; only with phone: ${JSON.stringify(t.fieldsOnlyWithPhone)}`,
      );
    },
  ],
  [
    "H24",
    "Status codes are numbers (1 created, 2 deleted, 3 not found, ...)",
    (f) => {
      const t = f.keyless?.tracking;
      if (t === undefined) return NOT_TESTED("not run");
      const after = f.write?.afterDelete?.trackingStatusCode;
      const created = f.write?.tracking?.withPhone?.statusCode;
      const notFound = t.statusCodes.includes("3");
      return {
        status: notFound ? "CONFIRMED" : "DIFFERENT",
        fact: `invented number: StatusCode ${JSON.stringify(t.statusCodes)} as ${JSON.stringify(t.statusCodeTypes)} ("${String(t.statusTextForInvented)}")${created === undefined ? "; created/deleted codes need the write stage" : `; fresh waybill ${String(created)}, after delete ${String(after)}`}; the full table is not observable here`,
      };
    },
  ],
  [
    "H25",
    "Label URLs on my.novaposhta.ua embed the key; a PDF",
    (f) => {
      const l = f.write?.labels;
      if (l === undefined) return NOT_TESTED("needs the write stage");
      return verdict(
        l.printDocument?.startsWithPdf === true,
        `with key: ${JSON.stringify(l.printDocument)}; marking: ${JSON.stringify(l.printMarking100x100)}; without key: ${JSON.stringify(l.printDocumentWithoutKey)}`,
      );
    },
  ],
  [
    "H26",
    "A rate limit exists; numbers not public",
    (f) => {
      const b = f.keyless?.burst;
      if (b === undefined) return NOT_TESTED("not run");
      return NOT_TESTED(
        `no limit reached by 10 sequential key-less calls (statuses ${JSON.stringify(b.statuses)}, rate headers: ${String(b.anyRateHeader)}); the limit itself is not measured`,
      );
    },
  ],
  ["H27", "No sandbox", () => NOT_TESTED("not observable by a script; check the official docs")],
  [
    "H28",
    "No idempotency for InternetDocument.save",
    (f) => {
      const r = f.write?.repeatSave;
      if (r === undefined)
        return NOT_TESTED(f.write ? "--skip-repeat-create" : "needs the write stage");
      return verdict(
        r.createdAnother && !r.sameRef,
        `repeat with the same InfoRegClientBarcodes: success ${String(r.success)}, another waybill ${String(r.createdAnother)}, same Ref ${String(r.sameRef)}, codes ${JSON.stringify(r.errorCodes)}`,
      );
    },
  ],
  [
    "H29",
    "Recipients via Counterparty.save/ContactPerson.save (or inline fields)",
    (f) => {
      const c = f.write?.createRecipient;
      if (c === undefined)
        return NOT_TESTED("needs --create-recipient (inline recipient fields are not tried)");
      return verdict(
        c.success === true,
        `Counterparty.save success ${String(c.success)}; shape ${JSON.stringify(c.shape)}`,
      );
    },
  ],
  [
    "H30",
    "Recipient names may have to be Cyrillic",
    () => NOT_TESTED("not tried (would need an extra save with a Latin name)"),
  ],
  [
    "H31",
    "Postomat weight/size limits and a declared-value cap",
    (f) => {
      const w = f.readonly?.getWarehouses;
      if (w === undefined) return NOT_TESTED("needs a key");
      return NOT_TESTED(
        `limits are only visible as fields: ${JSON.stringify(w.dimensionFields)}, PlaceMaxWeightAllowed ${JSON.stringify(w.placeMaxWeightTypes)}; caps not tried`,
      );
    },
  ],
  [
    "H32",
    "No tracking webhooks (polling)",
    () => NOT_TESTED("not observable by a script; check the official docs"),
  ],
  [
    "H33",
    "Keys can expire (set in the business cabinet)",
    () => NOT_TESTED("not observable without the cabinet"),
  ],
  [
    "H34",
    "Directory data may be stored (terms of use)",
    () => NOT_TESTED("legal question, not observable"),
  ],
];

function evaluateHypotheses(facts) {
  return HYPOTHESES.map(([id, claim, evaluate]) => {
    let result;
    try {
      result = evaluate(facts);
    } catch (error) {
      result = { status: "NOT TESTED", fact: `evaluation failed: ${errorText(error)}` };
    }
    return { id, claim, ...result };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Main

function usage(io) {
  io.out(
    "Usage: node scripts/spikes/nova-poshta-verify.mjs [--stage keyless|readonly|write] [--confirm] [--out <path>] [...]",
  );
  io.out("       node scripts/spikes/nova-poshta-verify.mjs --self-test");
  io.out(
    "Flags and environment variables: see the header of this file and scripts/spikes/README.md.",
  );
}

export async function main(argv, env, deps = {}) {
  const io = deps.io ?? { out: (line) => console.log(line), err: (line) => console.error(line) };
  let options;
  try {
    options = parseArgs(argv, env);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`error: ${error.message}`);
      usage(io);
      return 2;
    }
    throw error;
  }
  if (options.help) {
    usage(io);
    return 0;
  }
  if (options.selfTest) return selfTest(io);

  const apiKey = env.NOVA_POSHTA_API_KEY;
  const secrets = collectSecrets(apiKey, options);
  const say = (line) => io.out(scrub(line, secrets));
  const warn = (line) => io.err(scrub(line, secrets));

  if (options.stage !== "keyless" && !nonEmpty(apiKey)) {
    warn(
      `refused: --stage ${options.stage} needs NOVA_POSHTA_API_KEY in the environment (never pass it as a flag). Nothing was sent.`,
    );
    return 2;
  }
  if (options.stage === "write") {
    say("Write stage plan (on the account of the key's owner; nothing else is called):");
    for (const [index, step] of writePlan(options).entries())
      say(`  ${String(index + 1)}. ${step}`);
    const missing = missingWriteInputs(options);
    if (missing.length > 0) {
      warn(`refused: missing inputs: ${missing.join(", ")}. Nothing was sent.`);
      return 2;
    }
    if (!options.confirm) {
      warn(
        "refused: the write stage creates and deletes real waybills; re-run with --confirm after reading the plan. Nothing was sent.",
      );
      return 2;
    }
  }

  const ctx = {
    target: deps.target ?? TARGET,
    fetch: deps.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    now: deps.now ?? (() => new Date()),
    apiKey: nonEmpty(apiKey) ? apiKey.trim() : undefined,
    secrets,
    options,
    calls: [],
    facts: {},
    cleanup: undefined,
    terminalOnly: say,
    injectFault: deps.injectFault,
  };
  if (options.stage === "keyless") ctx.apiKey = undefined;

  const startedAt = ctx.now().toISOString();
  let failure;
  try {
    // keyless always runs first: it is cheap and the other stages' summaries build on it.
    say(`Stage keyless (${ctx.target.apiUrl})...`);
    await stageKeyless(ctx);
    if (options.stage === "readonly") {
      say("Stage readonly...");
      await stageReadonly(ctx);
    }
    if (options.stage === "write") {
      say("Stage write...");
      await stageWrite(ctx);
    }
  } catch (error) {
    failure = scrubMessage(errorText(error), secrets);
    warn(`stage failed: ${failure}`);
  }

  const hypotheses = evaluateHypotheses({ ...ctx.facts, calls: ctx.calls });
  const findings = {
    tool: "scripts/spikes/nova-poshta-verify.mjs",
    spikeVersion: SPIKE_VERSION,
    stage: options.stage,
    startedAt,
    finishedAt: ctx.now().toISOString(),
    node: process.version,
    endpoint: ctx.target.apiUrl,
    failure: failure ?? null,
    cleanup: ctx.cleanup ?? null,
    hypotheses,
    facts: ctx.facts,
    calls: ctx.calls,
  };
  const outPath = resolve(options.out);
  writeFileSync(outPath, `${scrub(JSON.stringify(findings, null, 2), secrets)}\n`, { mode: 0o600 });

  say("");
  say(`Calls: ${String(ctx.calls.length)}; findings written to ${outPath}`);
  say("Plan section 8 'from memory' list:");
  for (const item of hypotheses)
    say(`  ${item.id} ${item.status.padEnd(10)} ${item.claim}\n      -> ${item.fact}`);
  if (ctx.cleanup !== undefined) {
    if (ctx.cleanup.leftovers.length > 0) {
      warn(
        `CLEANUP INCOMPLETE: delete these spike waybills by hand in the business cabinet: ${ctx.cleanup.leftovers.join(", ")}`,
      );
      return 3;
    }
    say(`Cleanup: ${String(ctx.cleanup.created)} waybill(s) created, all confirmed deleted.`);
  }
  return failure === undefined ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------------
// Self-test: a local stub of the carrier, no network

const STUB_PHONE = "380001112233";
const STUB_SENDER_NAME = "Стабенко Тест";

function startStub(behaviour) {
  const state = {
    requests: 0,
    keysSeen: new Set(),
    documents: new Map(),
    deleted: new Set(),
    counter: 0,
  };
  const kyivWall = (date) => {
    const parts = kyivParts(date);
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const envelope = (data, extra = {}) => ({
    success: true,
    data,
    errors: [],
    warnings: [],
    info: [],
    messageCodes: [],
    errorCodes: [],
    warningCodes: [],
    infoCodes: [],
    ...extra,
  });
  const failure = (errors, errorCodes) => ({ ...envelope([]), success: false, errors, errorCodes });
  const cityRef = randomUUID();
  const warehouses = [1, 2, 3].map((number) => ({
    Ref: randomUUID(),
    Number: String(number),
    Description: `Відділення №${String(number)}`,
    DescriptionRu: `Отделение №${String(number)}`,
    ShortAddress: "Тестова вул., 1",
    CategoryOfWarehouse: number === 3 ? "Postomat" : "Branch",
    TypeOfWarehouse: number === 3 ? "t-postomat" : "t-branch",
    PlaceMaxWeightAllowed: "30",
    TotalMaxWeightAllowed: "0",
    WarehouseStatus: "Working",
    CityRef: cityRef,
  }));

  const handle = (body) => {
    const key = body.apiKey;
    if (typeof key === "string") state.keysSeen.add(key);
    const method = `${String(body.modelName)}.${String(body.calledMethod)}`;
    const props = body.methodProperties ?? {};
    if (method === "TrackingDocument.getStatusDocuments") {
      if (behaviour.failTracking && key !== undefined) return [500, { message: "boom" }];
      const documents = props.Documents ?? [];
      if (documents.length > 100) return [200, failure(["Documents limit 100"], ["20000400001"])];
      return [
        200,
        envelope(
          documents.map((doc) => {
            const found = [...state.documents.values()].find(
              (item) => item.IntDocNumber === doc.DocumentNumber,
            );
            const deleted = state.deleted.has(doc.DocumentNumber);
            const withPhone = doc.Phone !== "";
            return {
              Number: doc.DocumentNumber,
              StatusCode: found ? "1" : deleted ? "2" : "3",
              Status: found ? "Створено" : "Номер не знайдено",
              PhoneRecipient: found && withPhone ? STUB_PHONE : "",
              RecipientFullName: found && withPhone ? STUB_SENDER_NAME : "",
            };
          }),
        ),
      ];
    }
    if (key !== behaviour.validKey) {
      // Echo the key back, as a careless server might: the spike must still never print it.
      return [401, failure(["Token incorrect", `apiKey ${String(key)} rejected`], ["20000103155"])];
    }
    switch (method) {
      case "Address.getWarehouseTypes":
        return [
          200,
          envelope([
            { Ref: "t-branch", Description: "Відділення" },
            { Ref: "t-postomat", Description: "Поштомат" },
          ]),
        ];
      case "Common.getServiceTypes":
        return [
          200,
          envelope(
            [
              "WarehouseWarehouse",
              "WarehouseDoors",
              "DoorsWarehouse",
              "DoorsDoors",
              "WarehousePostomat",
            ].map((Ref) => ({ Ref })),
          ),
        ];
      case "Common.getCargoTypes":
        return [200, envelope(["Cargo", "Documents", "Parcel"].map((Ref) => ({ Ref })))];
      case "Common.getTypesOfPayers":
      case "Common.getPaymentForms":
      case "Common.getTypesOfCounterparties":
        return [200, envelope([{ Ref: "X" }])];
      case "Address.searchSettlements":
        return [
          200,
          envelope([{ TotalCount: 1, Addresses: [{ Present: "м. Тест", DeliveryCity: cityRef }] }]),
        ];
      case "Address.getCities":
        return [
          200,
          envelope(
            [{ Ref: cityRef, Description: "Тест", DescriptionRu: "Тест", Area: randomUUID() }],
            { info: { totalCount: 1, echo: `key=${String(key)}` } },
          ),
        ];
      case "Address.getWarehouses": {
        let list = warehouses;
        if (props.Ref !== undefined) list = list.filter((row) => row.Ref === props.Ref);
        if (props.CityRef !== undefined) list = list.filter((row) => row.CityRef === props.CityRef);
        if (props.TypeOfWarehouseRef !== undefined)
          list = list.filter((row) => row.TypeOfWarehouse === props.TypeOfWarehouseRef);
        if (props.WarehouseId !== undefined)
          list = list.filter((row) => row.Number === props.WarehouseId);
        if (props.Page === "2") list = [];
        return [200, envelope(list, { info: { totalCount: list.length } })];
      }
      case "InternetDocument.getDocumentPrice":
        if (Number(props.Weight) <= 0)
          return [200, failure(["Weight is invalid"], ["20000900746"])];
        return [200, envelope([{ AssessedCost: 300, Cost: 70 }])];
      case "InternetDocument.getDocumentDeliveryDate":
        return [
          200,
          envelope([
            {
              DeliveryDate: {
                date: "2026-10-27 00:00:00.000000",
                timezone_type: 3,
                timezone: "Europe/Kiev",
              },
            },
          ]),
        ];
      case "Counterparty.getCounterparties":
        return [
          200,
          envelope([
            {
              Ref: randomUUID(),
              Description: STUB_SENDER_NAME,
              CounterpartyType: "PrivatePerson",
              Phone: STUB_PHONE,
            },
          ]),
        ];
      case "Counterparty.getCounterpartyContactPersons":
        return [
          200,
          envelope([{ Ref: randomUUID(), Description: STUB_SENDER_NAME, Phones: STUB_PHONE }]),
        ];
      case "Counterparty.getCounterpartyAddresses":
        return [200, envelope([{ Ref: randomUUID(), Description: "Відділення №1" }])];
      case "Counterparty.save":
        return [
          200,
          envelope([
            {
              Ref: randomUUID(),
              ContactPerson: {
                success: true,
                data: [
                  {
                    Ref: randomUUID(),
                    Description: `${String(props.LastName)} ${String(props.FirstName)}`,
                  },
                ],
              },
            },
          ]),
        ];
      case "InternetDocument.save": {
        state.counter += 1;
        const document = {
          Ref: randomUUID(),
          IntDocNumber: `2045000000${String(1000 + state.counter)}`,
          CostOnSite: 70,
          EstimatedDeliveryDate: "27.10.2026",
          TypeDocument: "InternetDocument",
          InfoRegClientBarcodes: props.InfoRegClientBarcodes,
          DateTime: kyivWall(new Date()),
          RecipientsPhone: props.RecipientsPhone,
        };
        state.documents.set(document.Ref, document);
        return [
          200,
          envelope([
            {
              Ref: document.Ref,
              CostOnSite: 70,
              EstimatedDeliveryDate: "27.10.2026",
              IntDocNumber: document.IntDocNumber,
              TypeDocument: "InternetDocument",
            },
          ]),
        ];
      }
      case "InternetDocument.getDocumentList":
        return [200, envelope([...state.documents.values()])];
      case "InternetDocument.delete": {
        if (behaviour.failFirstDelete && !state.failedDelete) {
          state.failedDelete = true;
          return [200, failure(["Document can not be deleted"], ["20000200201"])];
        }
        const refs = Array.isArray(props.DocumentRefs) ? props.DocumentRefs : [props.DocumentRefs];
        const done = [];
        for (const ref of refs) {
          const document = state.documents.get(ref);
          if (document !== undefined) {
            state.documents.delete(ref);
            state.deleted.add(document.IntDocNumber);
            done.push({ Ref: ref });
          }
        }
        return [200, envelope(done)];
      }
      default:
        return [200, { ...envelope([]), success: false, warnings: ["Model is invalid"] }];
    }
  };

  const server = createServer((request, response) => {
    state.requests += 1;
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const url = request.url ?? "/";
      if (url.startsWith("/orders/")) {
        if (url.includes(`/apiKey/${String(behaviour.validKey)}`)) {
          response.writeHead(200, { "content-type": "application/pdf" });
          response.end(Buffer.from("%PDF-1.4\n% stub label\n%%EOF\n", "latin1"));
        } else {
          response.writeHead(302, {
            location: `https://my.example.test/login?back=${encodeURIComponent(url)}`,
          });
          response.end();
        }
        return;
      }
      if (url === "/v2.0/xml/") {
        response.writeHead(401, { "content-type": "text/xml;charset=UTF-8" });
        response.end(
          '<?xml version="1.0" encoding="UTF-8"?><root><success>false</success><errorCodes><item>20000103155</item></errorCodes></root>',
        );
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            success: false,
            data: [],
            errors: ["Data is invalid"],
            translatedErrors: [],
            warnings: [],
            info: [],
            messageCodes: [],
            errorCodes: [],
            warningCodes: [],
            infoCodes: [],
          }),
        );
        return;
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ success: false, data: [], errors: ["Data is invalid"], errorCodes: [] }),
        );
        return;
      }
      const [status, payload] = handle(body);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const base = `http://127.0.0.1:${String(address.port)}`;
      resolveServer({
        state,
        target: {
          apiUrl: `${base}/v2.0/json/`,
          xmlUrl: `${base}/v2.0/xml/`,
          plainHttpUrl: `${base}/v2.0/json/`,
          printBase: base,
        },
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function selfTest(io) {
  const dir = mkdtempSync(join(tmpdir(), "np-spike-selftest-"));
  const key = `selftest-${randomBytes(12).toString("hex")}`;
  const personal = {
    NP_SPIKE_SENDER_PHONE: STUB_PHONE,
    NP_SPIKE_RECIPIENT_PHONE: "380009998877",
    NP_SPIKE_RECIPIENT_FIRST_NAME: "Тестоимя",
    NP_SPIKE_RECIPIENT_LAST_NAME: "Тестопрізвище",
  };
  const writeFlags = [
    "--sender-city-ref",
    randomUUID(),
    "--sender-warehouse-ref",
    randomUUID(),
    "--sender-counterparty-ref",
    randomUUID(),
    "--sender-contact-ref",
    randomUUID(),
    "--recipient-city-ref",
    randomUUID(),
    "--recipient-warehouse-ref",
    randomUUID(),
    "--create-recipient",
  ];
  const forbidden = [key, encodeURIComponent(key), ...Object.values(personal), STUB_SENDER_NAME];
  const results = [];
  const run = async (name, argv, env, behaviour, check, injectFault) => {
    const stub = await startStub({ validKey: key, ...behaviour });
    const lines = [];
    const capture = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
    try {
      const out = join(dir, `${name.replace(/\W+/g, "-")}.json`);
      const code = await main([...argv, "--out", out], env, {
        io: capture,
        target: stub.target,
        injectFault,
      });
      let file = "";
      try {
        file = readFileSync(out, "utf8");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const everything = `${lines.join("\n")}\n${file}`;
      for (const secret of forbidden) {
        assert.ok(
          !everything.includes(secret),
          `${name}: a secret or personal value reached the output`,
        );
      }
      const parsed = file === "" ? null : JSON.parse(file);
      for (const item of parsed?.hypotheses ?? []) {
        assert.ok(!item.fact.startsWith("evaluation failed"), `${name}: ${item.id} ${item.fact}`);
      }
      await check({ code, lines, file: parsed, stub });
      results.push(`PASS ${name}`);
    } finally {
      await stub.close();
    }
  };

  try {
    await run(
      "readonly refuses without a key",
      ["--stage", "readonly"],
      {},
      {},
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests, 0, "nothing may be sent without a key");
      },
    );
    await run(
      "write refuses without --confirm",
      ["--stage", "write", ...writeFlags],
      { NOVA_POSHTA_API_KEY: key, ...personal },
      {},
      ({ code, lines, stub }) => {
        assert.equal(code, 2);
        assert.equal(
          stub.state.requests,
          0,
          "the write stage may not call anything without --confirm",
        );
        assert.ok(
          lines.some((line) => line.includes("InternetDocument.save")),
          "the plan is printed",
        );
      },
    );
    await run(
      "write refuses with missing inputs",
      ["--stage", "write", "--confirm"],
      { NOVA_POSHTA_API_KEY: key },
      {},
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests, 0);
      },
    );
    await run(
      "unknown flag is a usage error",
      ["--stage", "readonly", "--api-key", "x"],
      {},
      {},
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests, 0);
      },
    );
    await run(
      "keyless sends no key",
      ["--stage", "keyless"],
      { NOVA_POSHTA_API_KEY: key },
      {},
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.ok(!stub.state.keysSeen.has(key), "the keyless stage never sends the real key");
        assert.equal(file.facts.keyless.missingKey.httpStatus, 401);
        assert.ok(file.hypotheses.some((item) => item.id === "H22" && item.status === "CONFIRMED"));
        assert.ok(file.hypotheses.some((item) => item.id === "H02" && item.status === "DIFFERENT"));
      },
    );
    await run(
      "readonly with a key (stub echoes key, phones, names)",
      ["--stage", "readonly", "--show-sender-refs"],
      { NOVA_POSHTA_API_KEY: key, ...personal },
      {},
      ({ code, file, stub }) => {
        assert.equal(code, 0, "readonly completes");
        assert.ok(stub.state.keysSeen.has(key), "the key was sent to the stub");
        assert.equal(file.facts.readonly.keyAccepted, true);
        assert.ok(
          file.calls.every((call) => !("url" in call) && !("body" in call)),
          "no URL or body recorded",
        );
        assert.equal(file.hypotheses.find((item) => item.id === "H10").status, "CONFIRMED");
      },
    );
    await run(
      "write creates, finds, tracks, labels, deletes",
      ["--stage", "write", "--confirm", ...writeFlags],
      { NOVA_POSHTA_API_KEY: key, ...personal },
      {},
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.equal(stub.state.documents.size, 0, "every spike waybill is deleted");
        assert.equal(file.cleanup.created, 2);
        assert.deepEqual(file.cleanup.leftovers, []);
        assert.equal(file.facts.write.labels.printDocument.startsWithPdf, true);
        assert.equal(file.facts.write.repeatSave.createdAnother, true);
        assert.equal(file.facts.write.creationClock.matchesKyiv, true);
        assert.ok(file.facts.write.reference.startsWith(REFERENCE_PREFIX));
        for (const id of ["H17", "H18", "H20", "H21", "H25", "H28"]) {
          assert.equal(file.hypotheses.find((item) => item.id === id).status, "CONFIRMED", id);
        }
      },
    );
    await run(
      "readonly with a rejected key: the echoed key is scrubbed",
      ["--stage", "readonly"],
      { NOVA_POSHTA_API_KEY: key },
      { validKey: `other-${key}` },
      ({ code, file }) => {
        assert.equal(code, 1, "a rejected key stops the stage");
        assert.equal(file.facts.readonly.keyAccepted, false);
        assert.ok(
          file.facts.readonly.keyCheck.errors.some((text) => text.includes(REDACTED)),
          "the echo was replaced",
        );
      },
    );
    await run(
      "write retries a failed delete in finally",
      ["--stage", "write", "--confirm", ...writeFlags],
      { NOVA_POSHTA_API_KEY: key, ...personal },
      { failFirstDelete: true },
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.equal(stub.state.documents.size, 0);
        assert.equal(file.cleanup.retried, 2);
        assert.deepEqual(file.cleanup.leftovers, []);
        assert.equal(file.hypotheses.find((item) => item.id === "H21").status, "DIFFERENT");
      },
    );
    await run(
      "write cleans up after a thrown error",
      ["--stage", "write", "--confirm", ...writeFlags],
      { NOVA_POSHTA_API_KEY: key, ...personal },
      {},
      ({ code, file, stub }) => {
        assert.equal(code, 1, "the stage failure is reported");
        assert.ok(file.failure.includes("injected fault"));
        assert.equal(stub.state.documents.size, 0, "finally deleted both waybills");
        assert.equal(file.cleanup.retried, 2);
        assert.deepEqual(file.cleanup.leftovers, []);
      },
      (label) => label.startsWith("getStatusDocuments (A"),
    );
    await run(
      "write reports leftovers when cleanup cannot delete",
      ["--stage", "write", "--confirm", "--skip-repeat-create", ...writeFlags],
      { NOVA_POSHTA_API_KEY: key, ...personal },
      {},
      ({ code, file, stub, lines }) => {
        assert.equal(code, 3);
        assert.equal(stub.state.documents.size, 1);
        assert.equal(file.cleanup.leftovers.length, 1);
        assert.ok(lines.some((line) => line.startsWith("CLEANUP INCOMPLETE")));
      },
      (label) => label === "InternetDocument.delete" || label === "cleanup InternetDocument.delete",
    );
    await run(
      "write cleans up when a later step fails",
      ["--stage", "write", "--confirm", ...writeFlags],
      { NOVA_POSHTA_API_KEY: key, ...personal },
      { failTracking: true },
      ({ code, file, stub }) => {
        assert.equal(stub.state.documents.size, 0, "finally deleted the waybills");
        assert.equal(file.cleanup.created, 2);
        assert.deepEqual(file.cleanup.leftovers, []);
        assert.equal(code, 0, "tracking failure is recorded, the run still completes");
        assert.equal(file.facts.write.tracking.withPhone.httpStatus, 500);
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const line of results) io.out(line);
  io.out(`self-test: ${String(results.length)} checks passed`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      // Unexpected bug: print the class and a scrubbed message only (the key may be in a message).
      const secrets = collectSecrets(process.env.NOVA_POSHTA_API_KEY, {});
      console.error(`unexpected error: ${scrubMessage(errorText(error), secrets)}`);
      process.exitCode = 1;
    },
  );
}
