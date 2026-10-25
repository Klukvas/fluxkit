// Nova Post API verification spike (shipping plan step 7a, ADR 0030). Plain Node 22 ESM, built-in fetch only, no
// dependencies, not part of any package build. How to run it, what it creates and deletes, and how to read the findings:
// scripts/spikes/README.md. Replaces scripts/spikes/nova-poshta-verify.mjs (the legacy JSON-RPC API, deprecated).
//
// Targets the NEW Nova Post REST API (https://api-portal.novapost.com/llms.txt): GET /clients/authorization?apiKey=...
// issues a JWT that every other call sends in the Authorization header.
//
// Stages (--stage):
//   keyless   No key is sent. Error shapes of the authorization and JWT routes, the key-less offline divisions
//             dictionary redirect, an unknown route, the /test-api-keys route, a small burst. Safe to run anywhere.
//   readonly  (default) Needs NOVA_POST_API_KEY. The JWT (lifetime, header scheme, a second token), settlements and
//             divisions (search, filters, paging, languages, page limits, sizes), a delivery cost calculation, the
//             shipment list, tracking/print of an invented number, the client profile and webhook subscriptions (shapes
//             only). Creates nothing.
//   write     Needs NOVA_POST_API_KEY, --confirm and the sender/recipient inputs. Creates ONE shipment (and, unless
//             --skip-repeat-create, a second one with the same clientOrder to test idempotency), finds it back, tracks it,
//             prints its label, deletes both and checks that they are gone; cleanup is retried in a finally block.
//             Without --confirm it prints the exact call plan and exits 2 without any network call. It REFUSES
//             --env production unless --allow-production-write is also given.
//   --self-test  Runs every stage against a local stub server and asserts redaction and stage gating. No network.
//
// Environment (--env): sandbox (default) or production. The base URLs are constants (no SSRF); only the self-test points
// the context at its local stub.
//
// Inputs (a flag wins over its environment variable; nothing personal is ever read from a flag):
//   NOVA_POST_API_KEY                   env only. Never printed, never written; scrubbed from every output (also the JWT).
//   --out <path>                        findings JSON (default ./nova-post-findings.json, git-ignored).
//   --city-query <text>                 NP_SPIKE_CITY_QUERY; public settlement name for the searches (default "Київ").
//   --settlement-id <int>               NP_SPIKE_SETTLEMENT_ID; readonly: the settlement whose divisions are examined.
//                                       Without it the readonly stage searches --city-query (Accept-language uk), probes
//                                       up to 5 candidates (exact name matches first, "місто " / "м. " prefixes ignored)
//                                       and takes the first exact match that has divisions, else the one with the most.
//   --sender-division-id <int>          NP_SPIKE_SENDER_DIVISION_ID (the division the parcel would be handed in at)
//   --recipient-division-id <int>       NP_SPIKE_RECIPIENT_DIVISION_ID
//   NP_SPIKE_SENDER_NAME, NP_SPIKE_SENDER_PHONE (380XXXXXXXXX), NP_SPIKE_SENDER_EMAIL (optional)        env only
//   NP_SPIKE_SENDER_COMPANY_TIN, NP_SPIKE_SENDER_COMPANY_NAME (optional, a legal-entity sender)       env only
//   NP_SPIKE_PAYER_CONTRACT_NUMBER (optional, non-cash payment)                                         env only
//   NP_SPIKE_RECIPIENT_NAME, NP_SPIKE_RECIPIENT_PHONE, NP_SPIKE_RECIPIENT_EMAIL (optional)  env only (test data)
//   --payer-type <Sender|Recipient>     write: default Recipient
//   --weight-g <int>                    default 500
//   --length-mm, --width-mm, --height-mm <int>   default 200, 150, 100
//   --declared-value <n>                insuranceCost in UAH, default 300
//   --skip-repeat-create                write: do not send the second create with the same clientOrder
//   --allow-production-write            write: needed in addition to --confirm for --env production
//
// Exit codes: 0 done, 1 a stage call failed (findings still written), 2 usage or refusal (nothing sent),
// 3 the write stage could not confirm that every spike shipment is deleted (delete it by hand; the summary names it).
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
import { URLSearchParams, fileURLToPath } from "node:url";

const SPIKE_VERSION = 1;
// Constants, never configurable from a flag or the environment (no SSRF). Sources: the OpenAPI "servers" of the method
// pages (https://api-portal.novapost.com/methods/methods/authorization.md) and the testing page
// (https://api-portal.novapost.com/novaposhta-docs/integration-guide/testing.md), which names the .pl sandbox host.
const TARGETS = Object.freeze({
  sandbox: Object.freeze({
    base: "https://api-stage.novapost.com/v.1.0",
    altBase: "https://api-stage.novapost.pl/v.1.0",
  }),
  production: Object.freeze({ base: "https://api.novapost.com/v.1.0", altBase: null }),
});
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const CALL_TIMEOUT_MS = 30_000;
const REFERENCE_PREFIX = "FLUXKIT-SPIKE-";
const REDACTED = "[REDACTED]";
const DEFAULT_OUT = "nova-post-findings.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIND_BACK_MAX_PAGES = 5;

const BOOLEAN_FLAGS = new Set([
  "confirm",
  "self-test",
  "skip-repeat-create",
  "allow-production-write",
  "help",
]);
const VALUE_FLAGS = new Map([
  ["stage", null],
  ["env", null],
  ["out", null],
  ["city-query", "NP_SPIKE_CITY_QUERY"],
  ["settlement-id", "NP_SPIKE_SETTLEMENT_ID"],
  ["sender-division-id", "NP_SPIKE_SENDER_DIVISION_ID"],
  ["recipient-division-id", "NP_SPIKE_RECIPIENT_DIVISION_ID"],
  ["payer-type", null],
  ["weight-g", null],
  ["length-mm", null],
  ["width-mm", null],
  ["height-mm", null],
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
  const environment = flags.env ?? "sandbox";
  if (!["sandbox", "production"].includes(environment)) {
    throw new UsageError(`--env must be sandbox or production (got ${environment})`);
  }
  const payerType = flags["payer-type"] ?? "Recipient";
  if (!["Sender", "Recipient"].includes(payerType)) {
    throw new UsageError("--payer-type: Sender or Recipient");
  }
  return {
    stage,
    environment,
    out: flags.out ?? DEFAULT_OUT,
    confirm: flags.confirm === true,
    allowProductionWrite: flags["allow-production-write"] === true,
    selfTest: flags["self-test"] === true,
    help: flags.help === true,
    cityQuery: flags["city-query"] ?? "Київ",
    settlementId: optionalId(flags["settlement-id"], "--settlement-id"),
    senderDivisionId: optionalId(flags["sender-division-id"], "--sender-division-id"),
    recipientDivisionId: optionalId(flags["recipient-division-id"], "--recipient-division-id"),
    senderName: env.NP_SPIKE_SENDER_NAME,
    senderPhone: env.NP_SPIKE_SENDER_PHONE,
    senderEmail: env.NP_SPIKE_SENDER_EMAIL,
    senderCompanyTin: env.NP_SPIKE_SENDER_COMPANY_TIN,
    senderCompanyName: env.NP_SPIKE_SENDER_COMPANY_NAME,
    payerContractNumber: env.NP_SPIKE_PAYER_CONTRACT_NUMBER,
    recipientName: env.NP_SPIKE_RECIPIENT_NAME,
    recipientPhone: env.NP_SPIKE_RECIPIENT_PHONE,
    recipientEmail: env.NP_SPIKE_RECIPIENT_EMAIL,
    skipRepeatCreate: flags["skip-repeat-create"] === true,
    payerType,
    weightG: positiveInt(flags["weight-g"] ?? "500", "--weight-g"),
    lengthMm: positiveInt(flags["length-mm"] ?? "200", "--length-mm"),
    widthMm: positiveInt(flags["width-mm"] ?? "150", "--width-mm"),
    heightMm: positiveInt(flags["height-mm"] ?? "100", "--height-mm"),
    declaredValue: positiveNumber(flags["declared-value"] ?? "300", "--declared-value"),
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function optionalId(text, name) {
  if (text === undefined) return undefined;
  if (!/^[1-9]\d{0,11}$/.test(text)) throw new UsageError(`${name} must be a positive integer`);
  return Number(text);
}

function positiveInt(text, name) {
  if (!/^[1-9]\d{0,9}$/.test(text)) throw new UsageError(`${name} must be a positive integer`);
  return Number(text);
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
    if (typeof value === "number" ? false : !nonEmpty(value)) missing.push(label);
  };
  need(options.senderDivisionId, "--sender-division-id");
  need(options.recipientDivisionId, "--recipient-division-id");
  need(options.senderName, "NP_SPIKE_SENDER_NAME");
  need(options.senderPhone, "NP_SPIKE_SENDER_PHONE");
  need(options.recipientName, "NP_SPIKE_RECIPIENT_NAME");
  need(options.recipientPhone, "NP_SPIKE_RECIPIENT_PHONE");
  return missing;
}

// ---------------------------------------------------------------------------------------------------------------------
// Redaction and shapes

/** Every value that must never reach an output: the key (also URL-encoded), JWTs, the personal and contract inputs. */
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
  for (const value of [
    options.senderName,
    options.recipientName,
    options.senderEmail,
    options.recipientEmail,
    options.senderCompanyTin,
    options.senderCompanyName,
    options.payerContractNumber,
  ]) {
    add(value, 2);
  }
  return sortSecrets(secrets);
}

/** Longest first, so a secret that contains another is replaced whole. */
function sortSecrets(secrets) {
  return secrets.sort((left, right) => right.length - left.length);
}

function addSecret(ctx, value) {
  if (typeof value === "string" && value.length > 0 && !ctx.secrets.includes(value)) {
    ctx.secrets.push(value);
    sortSecrets(ctx.secrets);
  }
}

function scrub(text, secrets) {
  let result = String(text);
  for (const secret of secrets) result = result.split(secret).join(REDACTED);
  return result;
}

/** Carrier or error text: secrets, any long digit run (a phone in another spelling) and JWT-like runs; <= 200 chars. */
function scrubMessage(text, secrets) {
  const scrubbed = scrub(text, secrets)
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]")
    .replace(/\+?\d{10,}/g, "[digits]");
  return scrubbed.length > 200 ? `${scrubbed.slice(0, 200)}...` : scrubbed;
}

function classifyString(value) {
  if (value === "") return "empty";
  if (UUID.test(value)) return "uuid";
  if (/^\d+$/.test(value)) return `digits(${String(value.length)})`;
  if (/^[A-Z]{4}\d{10}$/.test(value)) return "AAAA+digits(10)";
  if (/^-?\d+\.\d+$/.test(value)) return "decimal";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return "datetime(ISO, Z)";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:?\d{2}$/.test(value))
    return "datetime(ISO, offset)";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return "datetime(YYYY-MM-DD HH:MM:SS)";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date(YYYY-MM-DD)";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return "time";
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(value)) return "jwt";
  if (/^https?:\/\//i.test(value)) return "url";
  if (/^[^@\s]+@[^@\s]+$/.test(value)) return "email";
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

/** Distinct values of a field: only for public dictionary values (categories, statuses), never personal data. */
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
      const value = row[field];
      types.add(
        typeof value === "string"
          ? `string:${classifyString(value)}`
          : value === null
            ? "null"
            : typeof value,
      );
    }
  }
  return [...types].sort();
}

function scriptOf(value) {
  return typeof value === "string" ? classifyString(value) : null;
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

function buildUrl(base, path, query) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) search.append(`${name}[]`, String(item));
    else search.append(name, String(value));
  }
  const text = search.toString();
  return `${base}${path}${text === "" ? "" : `?${text}`}`;
}

/**
 * One HTTP call. Records structural facts only: the URL (the key travels in the query of the authorization route) and the
 * body are never recorded. `auth`: "jwt" (ctx.jwt with ctx.authScheme), "jwt-raw", "jwt-bearer", "none", "junk-raw",
 * "junk-bearer". Returns {status, json, bytes, headers, record}; a transport error returns status null.
 */
async function call(ctx, label, spec) {
  // Self-test seam only (deps.injectFault): simulates a bug thrown in the middle of a stage.
  if (ctx.injectFault?.(label) === true) throw new Error(`injected fault at ${label}`);
  const method = spec.method ?? "GET";
  const headers = { accept: spec.accept ?? "application/json", ...(spec.headers ?? {}) };
  const auth = spec.auth ?? "jwt";
  let authSent = "none";
  if (auth === "jwt" || auth === "jwt-raw" || auth === "jwt-bearer") {
    const scheme = auth === "jwt" ? ctx.authScheme : auth === "jwt-raw" ? "raw" : "bearer";
    if (typeof ctx.jwt !== "string") throw new Error(`no JWT for ${label}`);
    headers.authorization = scheme === "bearer" ? `Bearer ${ctx.jwt}` : ctx.jwt;
    authSent = `jwt(${scheme})`;
  } else if (auth === "junk-raw") {
    headers.authorization = "fluxkit-not-a-jwt";
    authSent = "junk(raw)";
  } else if (auth === "junk-bearer") {
    headers.authorization = "Bearer fluxkit-not-a-jwt";
    authSent = "junk(bearer)";
  }
  let body;
  if (spec.rawBody !== undefined) {
    body = spec.rawBody;
    headers["content-type"] = "application/json";
  } else if (spec.body !== undefined) {
    body = JSON.stringify(spec.body);
    headers["content-type"] = "application/json";
  }
  const record = {
    label,
    method,
    path: spec.pathLabel ?? spec.path,
    host: spec.host ?? "base",
    authSent,
    keyInQuery: spec.keyInQuery === true,
  };
  ctx.calls.push(record);
  const url = buildUrl(spec.base ?? ctx.target.base, spec.path, spec.query);
  const started = performance.now();
  let response;
  let bytes;
  try {
    response = await ctx.fetch(url, {
      method,
      headers,
      body,
      redirect: spec.redirect ?? "error",
      signal: globalThis.AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    bytes = await readCapped(response);
  } catch (error) {
    record.transportError = scrubMessage(errorText(error), ctx.secrets);
    return { status: null, json: undefined, bytes: Buffer.alloc(0), headers: null, record };
  }
  record.latencyMs = Math.round(performance.now() - started);
  record.httpStatus = response.status;
  record.contentType = response.headers.get("content-type");
  record.contentEncoding = response.headers.get("content-encoding");
  record.responseBytes = bytes.byteLength;
  record.headerNames = [...response.headers.keys()].sort();
  record.rateHeaders = {};
  for (const name of record.headerNames) {
    if (RATE_HEADER.test(name))
      record.rateHeaders[name] = scrub(response.headers.get(name) ?? "", ctx.secrets);
  }
  const location = response.headers.get("location");
  if (location !== null) record.redirectHost = redirectHost(location, url);
  record.startsWithPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  // A binary route that answers JSON instead (an error) is described like any other answer, so a refusal of the label
  // records its error keys and scrubbed texts.
  const json = spec.binary === true && record.startsWithPdf ? undefined : parseJson(bytes);
  if (json !== undefined) Object.assign(record, describeJson(json, ctx.secrets));
  else if (spec.binary !== true) record.parseError = bytes.byteLength > 0;
  return { status: response.status, json, bytes, headers: response.headers, record };
}

function redirectHost(location, base) {
  try {
    const target = new URL(location, base);
    return `${target.protocol}//${target.host}${target.pathname === "/" ? "/" : "/..."}`;
  } catch {
    return "unparseable";
  }
}

function parseJson(bytes) {
  if (bytes.byteLength === 0) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/** Structure of a JSON answer: top-level keys, pagination meta, item count and shape, error keys and scrubbed texts. */
function describeJson(json, secrets) {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { bodyShape: shapeOf(json) };
  }
  const result = { bodyKeys: Object.keys(json).sort() };
  for (const key of ["current_page", "last_page", "per_page", "total", "from", "to"]) {
    if (key in json) (result.page ??= {})[key] = json[key];
  }
  if (Array.isArray(json.items)) {
    result.itemCount = json.items.length;
    result.itemShape = shapeOf(json.items).items ?? null;
  }
  if (json.errors !== undefined) {
    const errors = json.errors;
    if (errors !== null && typeof errors === "object" && !Array.isArray(errors)) {
      result.errorKeys = Object.keys(errors).sort();
      result.errorMessages = Object.values(errors)
        .slice(0, 10)
        .map((value) =>
          scrubMessage(typeof value === "string" ? value : JSON.stringify(value), secrets),
        );
    } else {
      result.errorShape = shapeOf(errors);
      result.errorMessages = (Array.isArray(errors) ? errors : [errors])
        .slice(0, 10)
        .map((value) => scrubMessage(String(value), secrets));
    }
  }
  if (json.error !== undefined) result.errorShape = shapeOf(json.error);
  return result;
}

function errorText(error) {
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error ? ` (cause: ${error.cause.name}: ${error.cause.message})` : "";
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

function items(json) {
  return json !== null && typeof json === "object" && Array.isArray(json.items) ? json.items : [];
}

function brief(record) {
  return pick(record ?? {}, [
    "httpStatus",
    "contentType",
    "bodyKeys",
    "page",
    "itemCount",
    "errorKeys",
    "errorMessages",
    "rateHeaders",
    "redirectHost",
    "responseBytes",
    "latencyMs",
    "transportError",
  ]);
}

function pick(object, keys) {
  const result = {};
  for (const key of keys) if (object[key] !== undefined) result[key] = object[key];
  return result;
}

/**
 * GET /shipments/print for a marking label. The parameter is named `type` (no brackets) and the text says `type=marking`
 * ([marking labels](https://api-portal.novapost.com/methods/methods/shipments/print-documents/marking-labels.md));
 * its schema says "array", but `type[]=marking` answered 422 {"type": "The type field must be a string."} on
 * production (2026-10-25). `numbers[]` stays an array parameter: "only one number is allowed per request" for marking.
 */
function labelQuery(number) {
  return { numbers: [number], type: "marking" };
}

/** Label request variants, tried in order until one answers a PDF: [name, extra query]. */
const LABEL_VARIANTS = Object.freeze([
  ["type=marking", {}],
  // `format` (pdf|zpl, default pdf) is documented on the print-documents overview page
  // (https://api-portal.novapost.com/methods/methods/shipments/print-documents.md).
  ["type=marking&format=pdf", { format: "pdf" }],
]);

function inventedUaNumber() {
  return `20${String(randomInt(10 ** 11, 10 ** 12))}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage: keyless

async function stageKeyless(ctx) {
  const facts = (ctx.facts.keyless = {});
  const inventedKey = randomBytes(16).toString("hex");
  const auth = async (label, query) =>
    brief((await call(ctx, label, { path: "/clients/authorization", query, auth: "none" })).record);
  facts.authorizationNoKey = await auth("authorization without apiKey", {});
  facts.authorizationEmptyKey = await auth("authorization with empty apiKey", { apiKey: "" });
  facts.authorizationInventedKey = await auth("authorization with an invented 32-hex apiKey", {
    apiKey: inventedKey,
  });

  const divisionsQuery = { countryCodes: ["UA"], limit: 1 };
  facts.divisionsNoAuth = brief(
    (
      await call(ctx, "divisions without Authorization", {
        path: "/divisions",
        query: divisionsQuery,
        auth: "none",
      })
    ).record,
  );
  facts.divisionsJunkRaw = brief(
    (
      await call(ctx, "divisions with a junk raw Authorization", {
        path: "/divisions",
        query: divisionsQuery,
        auth: "junk-raw",
      })
    ).record,
  );
  facts.divisionsJunkBearer = brief(
    (
      await call(ctx, "divisions with a junk Bearer Authorization", {
        path: "/divisions",
        query: divisionsQuery,
        auth: "junk-bearer",
      })
    ).record,
  );
  facts.settlementsNoAuth = brief(
    (
      await call(ctx, "settlements without Authorization", {
        path: "/settlements",
        query: { countryCodes: ["UA"], textSearch: ctx.options.cityQuery, limit: 1 },
        auth: "none",
      })
    ).record,
  );
  facts.shipmentsCreateNoAuthInvalidJson = brief(
    (
      await call(ctx, "POST /shipments invalid JSON, no Authorization", {
        method: "POST",
        path: "/shipments",
        rawBody: "{not json",
        auth: "none",
      })
    ).record,
  );
  facts.unknownRoute = brief(
    (await call(ctx, "unknown route", { path: "/fluxkit-no-such-route", auth: "none" })).record,
  );
  facts.offlineDivisions = brief(
    (
      await call(ctx, "dictionary/divisions (offline manifest redirect)", {
        path: "/dictionary/divisions",
        query: { measurementUnits: "g_mm" },
        headers: { "accept-language": "uk" },
        auth: "none",
        redirect: "manual",
      })
    ).record,
  );
  facts.offlineDivisionsBadUnits = brief(
    (
      await call(ctx, "dictionary/divisions invalid measurementUnits", {
        path: "/dictionary/divisions",
        query: { measurementUnits: "fluxkit" },
        auth: "none",
        redirect: "manual",
      })
    ).record,
  );
  // Documented as sandbox only; an empty body only triggers validation (no phone is ever sent).
  facts.testApiKeysEmptyBody = brief(
    (
      await call(ctx, "POST /test-api-keys empty body", {
        method: "POST",
        path: "/test-api-keys",
        body: {},
        auth: "none",
      })
    ).record,
  );
  if (ctx.target.altBase !== null) {
    facts.altSandboxHost = brief(
      (
        await call(ctx, "alternative sandbox host: authorization without apiKey", {
          base: ctx.target.altBase,
          host: "altBase",
          path: "/clients/authorization",
          auth: "none",
        })
      ).record,
    );
  }
  const burst = [];
  for (let index = 0; index < 5; index += 1) {
    const { record } = await call(ctx, `burst ${String(index + 1)}/5 (divisions, no auth)`, {
      path: "/divisions",
      query: divisionsQuery,
      auth: "none",
    });
    burst.push(record);
  }
  facts.burst = {
    statuses: [...new Set(burst.map((record) => record.httpStatus ?? null))],
    maxLatencyMs: Math.max(...burst.map((record) => record.latencyMs ?? 0)),
    rateHeaderNames: [...new Set(burst.flatMap((record) => Object.keys(record.rateHeaders ?? {})))],
  };
  facts.headerNames = [...new Set(ctx.calls.flatMap((record) => record.headerNames ?? []))].sort();
  facts.rateHeadersSeen = Object.fromEntries(
    ctx.calls
      .filter((record) => Object.keys(record.rateHeaders ?? {}).length > 0)
      .map((record) => [record.label, record.rateHeaders]),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Authorization (readonly and write)

function decodeJwtFacts(jwt) {
  const parts = jwt.split(".");
  const facts = { parts: parts.length };
  if (parts.length !== 3) return facts;
  const decode = (part) => {
    try {
      return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    } catch {
      return undefined;
    }
  };
  const header = decode(parts[0]);
  const payload = decode(parts[1]);
  facts.alg = typeof header?.alg === "string" ? header.alg : null;
  facts.claimNames =
    payload !== null && typeof payload === "object" ? Object.keys(payload).sort() : null;
  if (typeof payload?.exp === "number" && typeof payload?.iat === "number") {
    facts.lifetimeSeconds = payload.exp - payload.iat;
  } else if (typeof payload?.exp === "number") {
    facts.lifetimeSecondsFromNow = Math.round(payload.exp - Date.now() / 1000);
  }
  return facts;
}

async function issueJwt(ctx, label) {
  const result = await call(ctx, label, {
    path: "/clients/authorization",
    pathLabel: "/clients/authorization?apiKey=<key>",
    query: { apiKey: ctx.apiKey },
    keyInQuery: true,
    auth: "none",
  });
  const jwt = result.json?.jwt;
  if (typeof jwt === "string" && jwt !== "") {
    addSecret(ctx, jwt);
    return { jwt, record: result.record };
  }
  return { jwt: null, record: result.record };
}

/** Issues the JWT and finds which Authorization form the API accepts (docs differ: raw vs Bearer). */
async function establishAuth(ctx, facts) {
  const first = await issueJwt(ctx, "authorization (JWT)");
  facts.authorization = brief(first.record);
  if (first.jwt === null) {
    throw new Error("the key was not accepted (see authorization); nothing else was called");
  }
  facts.jwt = decodeJwtFacts(first.jwt);
  ctx.jwt = first.jwt;
  const probe = async (auth) =>
    (
      await call(ctx, `divisions limit 1 with ${auth}`, {
        path: "/divisions",
        query: { countryCodes: ["UA"], limit: 1 },
        auth,
      })
    ).record;
  const raw = await probe("jwt-raw");
  const bearer = await probe("jwt-bearer");
  facts.authScheme = { raw: raw.httpStatus ?? null, bearer: bearer.httpStatus ?? null };
  if (raw.httpStatus === 200) ctx.authScheme = "raw";
  else if (bearer.httpStatus === 200) ctx.authScheme = "bearer";
  else throw new Error("neither Authorization form was accepted with a fresh JWT (see authScheme)");
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage: readonly

async function stageReadonly(ctx) {
  const facts = (ctx.facts.readonly = {});
  const options = ctx.options;
  await establishAuth(ctx, facts);

  // A second token: does it invalidate the first ("the maximum number of active sessions may be limited")?
  const firstJwt = ctx.jwt;
  const second = await issueJwt(ctx, "authorization (second JWT)");
  if (second.jwt !== null) {
    const stillValid = await call(ctx, "first JWT after a second was issued", {
      path: "/divisions",
      query: { countryCodes: ["UA"], limit: 1 },
    });
    facts.secondJwt = {
      differs: second.jwt !== firstJwt,
      firstStillAccepted: stillValid.status === 200,
      firstStatus: stillValid.status,
    };
    ctx.jwt = second.jwt;
  } else {
    facts.secondJwt = { issued: false, record: brief(second.record) };
  }

  // Settlements.
  const settlements = await call(ctx, "settlements textSearch (limit 5)", {
    path: "/settlements",
    query: { countryCodes: ["UA"], textSearch: options.cityQuery, limit: 5 },
  });
  const settlementRows = items(settlements.json);
  facts.settlements = {
    ...brief(settlements.record),
    fields: fieldNames(settlementRows),
    idTypes: typesOf(settlementRows, "id"),
    nameScript: scriptOf(settlementRows[0]?.name),
    shape: settlements.record.itemShape ?? null,
  };
  facts.settlementLanguages = {};
  for (const language of ["en", "uk"]) {
    const result = await call(ctx, `settlements Accept-language ${language}`, {
      path: "/settlements",
      query: { countryCodes: ["UA"], textSearch: options.cityQuery, limit: 1 },
      headers: { "accept-language": language },
    });
    facts.settlementLanguages[language] = {
      status: result.status,
      nameScript: scriptOf(items(result.json)[0]?.name),
    };
  }
  facts.settlementsLowercaseCountry = brief(
    (
      await call(ctx, "settlements countryCodes[]=uk (the docs' enum lists languages)", {
        path: "/settlements",
        query: { countryCodes: ["uk"], textSearch: options.cityQuery, limit: 1 },
      })
    ).record,
  );
  facts.settlementsLatinSearch = brief(
    (
      await call(ctx, "settlements textSearch Kyiv (Latin)", {
        path: "/settlements",
        query: { countryCodes: ["UA"], textSearch: "Kyiv", limit: 5 },
      })
    ).record,
  );
  facts.settlementsPage2 = brief(
    (
      await call(ctx, "settlements textSearch page 2", {
        path: "/settlements",
        query: { countryCodes: ["UA"], textSearch: options.cityQuery, limit: 5, page: 2 },
      })
    ).record,
  );
  facts.settlementLimits = {};
  for (const limit of [100, 101, 500]) {
    const result = await call(ctx, `settlements limit ${String(limit)}`, {
      path: "/settlements",
      query: { countryCodes: ["UA"], textSearch: options.cityQuery, limit },
    });
    facts.settlementLimits[limit] = brief(result.record);
  }
  const allSettlements = await call(ctx, "settlements whole country (limit 1)", {
    path: "/settlements",
    query: { countryCodes: ["UA"], limit: 1 },
  });
  facts.settlementsCountryTotal = allSettlements.json?.total ?? null;

  // The first search hit is often a village of the same name without any division (run of 2026-10-25), so the
  // settlement for the division calls is chosen on purpose.
  const settlementId = await chooseSettlement(ctx, facts);

  // Divisions of that settlement.
  const page1 = await call(ctx, "divisions settlementIds limit 100 page 1", {
    path: "/divisions",
    query: { countryCodes: ["UA"], settlementIds: [settlementId], limit: 100, page: 1 },
  });
  const page2 = await call(ctx, "divisions settlementIds limit 100 page 2", {
    path: "/divisions",
    query: { countryCodes: ["UA"], settlementIds: [settlementId], limit: 100, page: 2 },
  });
  const divisionRows = items(page1.json);
  facts.divisions = {
    ...brief(page1.record),
    page2: brief(page2.record),
    pagesOverlap: items(page2.json).some((row) =>
      divisionRows.some((other) => other.id === row.id),
    ),
    fields: fieldNames(divisionRows),
    idTypes: typesOf(divisionRows, "id"),
    numberTypes: typesOf(divisionRows, "number"),
    divisionCategories: distinct(divisionRows, "divisionCategory"),
    statuses: distinct(divisionRows, "status"),
    sources: distinct(divisionRows, "source"),
    externalIdTypes: typesOf(divisionRows, "externalId"),
    maxWeightPlaceRecipientTypes: typesOf(divisionRows, "maxWeightPlaceRecipient"),
    maxDeclaredCostPlaceTypes: typesOf(divisionRows, "maxDeclaredCostPlace"),
    allInSettlement: divisionRows.every((row) => row?.settlement?.id === settlementId),
    shape: page1.record.itemShape ?? null,
  };
  facts.divisionLanguages = {};
  for (const language of ["en", "uk"]) {
    const result = await call(ctx, `divisions Accept-language ${language}`, {
      path: "/divisions",
      query: { countryCodes: ["UA"], settlementIds: [settlementId], limit: 1 },
      headers: { "accept-language": language },
    });
    const row = items(result.json)[0];
    facts.divisionLanguages[language] = {
      status: result.status,
      nameScript: scriptOf(row?.name),
      addressScript: scriptOf(row?.address),
      settlementScript: scriptOf(row?.settlement?.name),
    };
  }
  facts.divisionCategoryFilter = {};
  for (const category of ["Postomat", "PostBranch", "CargoBranch", "PUDO"]) {
    const result = await call(ctx, `divisions divisionCategories ${category}`, {
      path: "/divisions",
      query: {
        countryCodes: ["UA"],
        settlementIds: [settlementId],
        divisionCategories: [category],
        limit: 5,
      },
    });
    facts.divisionCategoryFilter[category] = {
      status: result.status,
      total: result.json?.total ?? null,
      allOfCategory: items(result.json).every((row) => row.divisionCategory === category),
    };
  }
  facts.divisionLimits = {};
  for (const limit of [100, 101, 500]) {
    facts.divisionLimits[limit] = brief(
      (
        await call(ctx, `divisions limit ${String(limit)}`, {
          path: "/divisions",
          query: { countryCodes: ["UA"], settlementIds: [settlementId], limit },
        })
      ).record,
    );
  }
  // One division by id: no documented filter. Try undocumented ones and compare with the expected id.
  const division = divisionRows[0];
  if (division !== undefined) {
    facts.divisionById = {};
    for (const [name, query] of [
      ["ids[]", { ids: [division.id] }],
      ["id", { id: division.id }],
      [
        "textSearch(number)",
        { textSearch: String(division.number ?? ""), settlementIds: [settlementId] },
      ],
    ]) {
      const result = await call(ctx, `divisions by ${name} (undocumented)`, {
        path: "/divisions",
        query: { countryCodes: ["UA"], limit: 5, ...query },
      });
      const rowsFound = items(result.json);
      facts.divisionById[name] = {
        status: result.status,
        total: result.json?.total ?? null,
        onlyThatDivision: rowsFound.length === 1 && rowsFound[0]?.id === division.id,
        containsIt: rowsFound.some((row) => row.id === division.id),
      };
    }
  }
  facts.divisionsUnknownSettlement = brief(
    (
      await call(ctx, "divisions unknown settlementId", {
        path: "/divisions",
        query: { countryCodes: ["UA"], settlementIds: [999_999_999], limit: 5 },
      })
    ).record,
  );
  facts.divisionsCountryTotal =
    (
      await call(ctx, "divisions whole country (limit 1)", {
        path: "/divisions",
        query: { countryCodes: ["UA"], limit: 1 },
      })
    ).json?.total ?? null;

  // Delivery cost (POST, creates nothing): division to division within the city.
  const senderDivision = options.senderDivisionId ?? division?.id;
  const recipientDivision = options.recipientDivisionId ?? divisionRows[1]?.id ?? division?.id;
  const calculationBody = (actualWeight) => ({
    payerType: options.payerType,
    parcels: [
      {
        cargoCategory: "parcel",
        insuranceCost: options.declaredValue,
        rowNumber: 1,
        width: options.widthMm,
        length: options.lengthMm,
        height: options.heightMm,
        actualWeight,
      },
    ],
    sender: { countryCode: "UA", divisionId: senderDivision },
    recipient: { countryCode: "UA", divisionId: recipientDivision },
  });
  if (senderDivision !== undefined && recipientDivision !== undefined) {
    const calculation = await call(ctx, "shipments/calculations UA division to division", {
      method: "POST",
      path: "/shipments/calculations",
      body: calculationBody(options.weightG),
    });
    const services = Array.isArray(calculation.json?.services) ? calculation.json.services : [];
    facts.calculation = {
      ...brief(calculation.record),
      shape: shapeOf(calculation.json),
      serviceCostTypes: typesOf(services, "cost"),
      serviceCount: services.length,
      hasCurrencyField: JSON.stringify(Object.keys(calculation.json ?? {})).includes("urrency"),
      scheduledDeliveryDate: typesOf([calculation.json ?? {}], "scheduledDeliveryDate"),
    };
    facts.calculationError = brief(
      (
        await call(ctx, "shipments/calculations actualWeight 0 (error sample)", {
          method: "POST",
          path: "/shipments/calculations",
          body: calculationBody(0),
        })
      ).record,
    );
  }

  // The account's shipment list: shapes, ordering, filters.
  const list = await call(ctx, "shipments list limit 5", {
    path: "/shipments",
    query: { limit: 5 },
  });
  const listRows = items(list.json);
  facts.shipmentList = {
    ...brief(list.record),
    fields: fieldNames(listRows),
    idTypes: typesOf(listRows, "id"),
    numberTypes: typesOf(listRows, "number"),
    createdAtTypes: typesOf(listRows, "createdAt"),
    dateTimeTypes: typesOf(listRows, "dateTime"),
    clientOrderTypes: typesOf(listRows, "clientOrder"),
    statuses: distinct(listRows, "status"),
    order: orderOf(listRows),
  };
  facts.shipmentListLimits = {};
  for (const limit of [100, 101]) {
    facts.shipmentListLimits[limit] = brief(
      (
        await call(ctx, `shipments list limit ${String(limit)}`, {
          path: "/shipments",
          query: { limit },
        })
      ).record,
    );
  }
  facts.shipmentListUndocumentedFilter = brief(
    (
      await call(ctx, "shipments list clientOrder filter (undocumented)", {
        path: "/shipments",
        query: { clientOrder: `${REFERENCE_PREFIX}NONE`, limit: 5 },
      })
    ).record,
  );
  const invented = inventedUaNumber();
  facts.shipmentByInventedNumber = brief(
    (
      await call(ctx, "shipments numbers[] invented", {
        path: "/shipments",
        query: { numbers: [invented] },
      })
    ).record,
  );
  facts.trackingInvented = brief(
    (
      await call(ctx, "shipments/tracking invented number", {
        path: "/shipments/tracking",
        query: { numbers: [invented] },
      })
    ).record,
  );
  facts.trackingHistoryInvented = brief(
    (
      await call(ctx, "shipments/tracking/history invented number", {
        path: "/shipments/tracking/history",
        query: { numbers: [invented] },
      })
    ).record,
  );
  facts.printInvented = brief(
    (
      await call(ctx, "shipments/print marking invented number", {
        path: "/shipments/print",
        query: labelQuery(invented),
        accept: "application/pdf, application/json",
        binary: true,
      })
    ).record,
  );
  // Documented max numbers per tracking call: none; try 100 and 101 invented numbers.
  facts.trackingBatch = {};
  for (const count of [100, 101]) {
    facts.trackingBatch[count] = brief(
      (
        await call(ctx, `shipments/tracking/history ${String(count)} invented numbers`, {
          path: "/shipments/tracking/history",
          query: { numbers: Array.from({ length: count }, inventedUaNumber) },
        })
      ).record,
    );
  }

  // Profile and webhook subscriptions (shapes only; the profile is not documented beyond authorization).
  const profile = await call(ctx, "clients (profile, undocumented)", { path: "/clients" });
  facts.clientProfile = { ...brief(profile.record), shape: shapeOf(profile.json) };
  const subscriptions = await call(ctx, "tracking-push/subscribers", {
    path: "/tracking-push/subscribers",
  });
  facts.webhookSubscriptions = {
    ...brief(subscriptions.record),
    shape: shapeOf(subscriptions.json),
  };

  // Expired or junk token answer with a real call (401 text).
  facts.junkToken = brief(
    (
      await call(ctx, "divisions with a junk token (raw)", {
        path: "/divisions",
        query: { countryCodes: ["UA"], limit: 1 },
        auth: "junk-raw",
      })
    ).record,
  );

  // Authenticated burst: rate-limit headers and values.
  const burst = [];
  for (let index = 0; index < 10; index += 1) {
    burst.push(
      (
        await call(ctx, `burst ${String(index + 1)}/10 (divisions limit 1)`, {
          path: "/divisions",
          query: { countryCodes: ["UA"], limit: 1 },
        })
      ).record,
    );
  }
  facts.burst = {
    statuses: [...new Set(burst.map((record) => record.httpStatus ?? null))],
    rateHeaders: burst.map((record) => record.rateHeaders ?? {}),
    maxLatencyMs: Math.max(...burst.map((record) => record.latencyMs ?? 0)),
  };
}

/**
 * The current status row of a GET /shipments/tracking answer: the documented `currentStatus[0]`, else inside the first
 * of `items` (`items[0].currentStatus[0]` or `items[0]` itself), whichever carries a `statusCode`. {at, row} or undefined.
 */
function currentTrackingStatus(json) {
  const first = (value) => (Array.isArray(value) ? value[0] : value);
  const item = items(json)[0];
  const candidates = [
    ["currentStatus[0]", first(json?.currentStatus)],
    ["items[0].currentStatus[0]", first(item?.currentStatus)],
    ["items[0]", item],
  ];
  for (const [at, row] of candidates) {
    if (row !== null && typeof row === "object" && "statusCode" in row) return { at, row };
  }
  return undefined;
}

const SETTLEMENT_CANDIDATES = 5;

/** Lower case, trimmed, without a leading settlement-type word ("місто Київ" and "м. Київ" both become "київ"). */
function normalizeSettlementName(value) {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/^(місто|м\.|city of|city|misto|m\.)\s*/u, "")
        .trim()
    : "";
}

function isExactSettlementMatch(row, query) {
  const wanted = normalizeSettlementName(query);
  if (wanted === "") return false;
  const names = [row?.name, ...(Array.isArray(row?.alternativeNames) ? row.alternativeNames : [])];
  return names.some((name) => normalizeSettlementName(name) === wanted);
}

/**
 * The settlement whose divisions the readonly stage examines: --settlement-id, else the first exact name match of
 * --city-query that has divisions, else the probed candidate with the most divisions. Records ids and counts only.
 */
async function chooseSettlement(ctx, facts) {
  const options = ctx.options;
  const divisionTotal = async (id, label) =>
    (
      await call(ctx, label, {
        path: "/divisions",
        query: { countryCodes: ["UA"], settlementIds: [id], limit: 1 },
      })
    ).json?.total ?? null;
  if (options.settlementId !== undefined) {
    facts.settlementChoice = {
      source: "--settlement-id",
      id: options.settlementId,
      divisionsTotal: await divisionTotal(options.settlementId, "divisions of --settlement-id"),
    };
    return options.settlementId;
  }
  const search = await call(ctx, "settlements textSearch for the division calls (limit 100, uk)", {
    path: "/settlements",
    query: { countryCodes: ["UA"], textSearch: options.cityQuery, limit: 100 },
    headers: { "accept-language": "uk" },
  });
  const rows = items(search.json).filter((row) => typeof row?.id === "number");
  const exact = rows.filter((row) => isExactSettlementMatch(row, options.cityQuery));
  const candidates = [...exact, ...rows.filter((row) => !exact.includes(row))].slice(
    0,
    SETTLEMENT_CANDIDATES,
  );
  if (candidates.length === 0) throw new Error("no settlement found for --city-query");
  const probed = [];
  for (const [index, row] of candidates.entries()) {
    const total = await divisionTotal(
      row.id,
      `divisions of settlement candidate ${String(index + 1)}`,
    );
    probed.push({ id: row.id, exactNameMatch: exact.includes(row), divisionsTotal: total });
    if (exact.includes(row) && typeof total === "number" && total > 0) break;
  }
  const exactWithDivisions = probed.find(
    (item) =>
      item.exactNameMatch && typeof item.divisionsTotal === "number" && item.divisionsTotal > 0,
  );
  const chosen =
    exactWithDivisions ??
    probed.reduce((best, item) =>
      (item.divisionsTotal ?? -1) > (best.divisionsTotal ?? -1) ? item : best,
    );
  facts.settlementChoice = {
    source: "--city-query",
    searchTotal: search.json?.total ?? null,
    exactMatches: exact.length,
    probed,
    id: chosen.id,
    exactNameMatch: chosen.exactNameMatch,
    divisionsTotal: chosen.divisionsTotal,
  };
  return chosen.id;
}

/** "newest first", "oldest first", "unordered" or "unknown" by `createdAt` (ISO) of the rows. */
function orderOf(rows) {
  const times = rows
    .map((row) => (typeof row?.createdAt === "string" ? Date.parse(row.createdAt) : Number.NaN))
    .filter((value) => !Number.isNaN(value));
  if (times.length < 2) return "unknown";
  const descending = times.every((value, index) => index === 0 || times[index - 1] >= value);
  const ascending = times.every((value, index) => index === 0 || times[index - 1] <= value);
  return descending ? "newest first" : ascending ? "oldest first" : "unordered";
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage: write

function writePlan(options, target) {
  const steps = [
    "(first) the keyless calls of --stage keyless: no key is sent, nothing is created",
    "GET /clients/authorization - issue a JWT; GET /divisions twice to find the accepted Authorization form",
    `POST /shipments - creates shipment A (UA division ${String(options.senderDivisionId)} to division ${String(options.recipientDivisionId)}, clientOrder ${REFERENCE_PREFIX}<timestamp>-<random>, payer ${options.payerType})`,
  ];
  if (!options.skipRepeatCreate) {
    steps.push(
      "POST /shipments - the SAME request again (idempotency test; may create shipment B)",
    );
  }
  steps.push(
    "GET /shipments?numbers[]=A, GET /shipments?ids[]=A.id, then up to 5 pages of GET /shipments?limit=100 to find A by clientOrder",
    "GET /shipments/tracking and /shipments/tracking/history for A",
    "GET /shipments/print?numbers[]=A&type=marking for A (the label; A then counts as printed); on a refusal once more with &format=pdf",
    "DELETE /shipments/<B number> (expected refusal: UA deletes by id only), DELETE /shipments/<A id>, again (repeat), /shipments/<B id>",
    "DELETE /shipments/<random uuid> (404 sample); GET /shipments and tracking - check A and B are gone",
    "finally: DELETE /shipments/<id> again for any shipment not confirmed gone",
  );
  return [`target: ${target.base}`, ...steps];
}

function createBody(options, reference) {
  const body = {
    status: "ReadyToShip",
    clientOrder: reference,
    note: "Fluxkit API check, delete",
    payerType: options.payerType,
    parcels: [
      {
        cargoCategory: "parcel",
        parcelDescription: "Fluxkit API check",
        insuranceCost: options.declaredValue,
        rowNumber: 1,
        width: options.widthMm,
        length: options.lengthMm,
        height: options.heightMm,
        actualWeight: options.weightG,
      },
    ],
    sender: {
      companyTin: options.senderCompanyTin ?? "",
      companyName: options.senderCompanyName ?? "",
      phone: options.senderPhone,
      email: options.senderEmail ?? "",
      name: options.senderName,
      countryCode: "UA",
      divisionId: options.senderDivisionId,
      addressParts: {},
    },
    recipient: {
      companyTin: "",
      companyName: "",
      phone: options.recipientPhone,
      email: options.recipientEmail ?? "",
      name: options.recipientName,
      countryCode: "UA",
      divisionId: options.recipientDivisionId,
      addressParts: {},
    },
  };
  if (nonEmpty(options.payerContractNumber)) body.payerContractNumber = options.payerContractNumber;
  return body;
}

function isDeletedAnswer(result) {
  if (result.status === 200) return true;
  return (
    result.status === 422 &&
    Object.values(result.json?.errors ?? {}).some((value) => value === "shipment_was_deleted")
  );
}

async function stageWrite(ctx) {
  const facts = (ctx.facts.write = {});
  const options = ctx.options;
  const created = []; // {label, id, number, deleted, labelPrinted, savedBetween}
  const now = ctx.now();
  const reference = `${REFERENCE_PREFIX}${now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}-${randomBytes(2).toString("hex").toUpperCase()}`;
  facts.reference = reference;
  facts.referenceLength = reference.length;
  try {
    await establishAuth(ctx, facts);
    const body = createBody(options, reference);
    const create = async (label) => {
      const before = ctx.now();
      const result = await call(ctx, label, { method: "POST", path: "/shipments", body });
      const after = ctx.now();
      const id = result.json?.id;
      if (
        result.status !== null &&
        result.status < 300 &&
        (typeof id === "string" || typeof id === "number")
      ) {
        created.push({
          label,
          id: String(id),
          number: typeof result.json?.number === "string" ? result.json.number : null,
          deleted: false,
          labelPrinted: false,
          savedBetween: [before, after],
        });
      }
      return result;
    };
    const first = await create("POST /shipments (A)");
    facts.create = {
      ...brief(first.record),
      shape: shapeOf(first.json),
      idType: typesOf([first.json ?? {}], "id"),
      numberType: typesOf([first.json ?? {}], "number"),
      costType: typesOf([first.json ?? {}], "cost"),
      statusValue: typeof first.json?.status === "string" ? first.json.status : null,
      createdAtType: typesOf([first.json ?? {}], "createdAt"),
    };
    if (created.length === 0)
      throw new Error("POST /shipments (A) did not create a shipment (see create)");
    const a = created[0];
    // Which clock is createdAt in? Compare with the instant of our call.
    if (typeof first.json?.createdAt === "string") {
      const at = Date.parse(first.json.createdAt);
      const [before, after] = a.savedBetween;
      facts.createdAtClock = Number.isNaN(at)
        ? { parsed: false }
        : {
            parsed: true,
            offsetMinutesFromOurClock: Math.round(
              (at - (before.getTime() + after.getTime()) / 2) / 60000,
            ),
          };
    }

    if (!options.skipRepeatCreate) {
      const second = await create("POST /shipments (B, same clientOrder)");
      facts.repeatCreate = {
        ...brief(second.record),
        createdAnother: created.length === 2,
        sameId: created.length === 2 ? created[1].id === a.id : second.json?.id === a.id,
      };
    }

    // Find back.
    if (a.number !== null) {
      const byNumber = await call(ctx, "GET /shipments numbers[] (A)", {
        path: "/shipments",
        query: { numbers: [a.number] },
      });
      const row = items(byNumber.json).find((item) => item.number === a.number);
      facts.findByNumber = {
        ...brief(byNumber.record),
        found: row !== undefined,
        sameId: row !== undefined && String(row.id) === a.id,
        clientOrderEchoed: row?.clientOrder === reference,
        fields: fieldNames(row === undefined ? [] : [row]),
        statusValue: typeof row?.status === "string" ? row.status : null,
      };
    }
    const byId = await call(ctx, "GET /shipments ids[] (A id from create)", {
      path: "/shipments",
      query: { ids: [a.id] },
    });
    facts.findById = {
      ...brief(byId.record),
      found: items(byId.json).some((item) => String(item.id) === a.id),
    };
    facts.findByReference = { pagesRead: 0, foundOnPage: null, matches: 0, order: [] };
    for (let page = 1; page <= FIND_BACK_MAX_PAGES; page += 1) {
      const result = await call(
        ctx,
        `GET /shipments limit 100 page ${String(page)} (find by clientOrder)`,
        {
          path: "/shipments",
          query: { limit: 100, page },
        },
      );
      facts.findByReference.pagesRead = page;
      if (result.status !== 200) {
        facts.findByReference.failure = brief(result.record);
        break;
      }
      const rows = items(result.json);
      facts.findByReference.order.push(orderOf(rows));
      const matches = rows.filter((item) => item.clientOrder === reference).length;
      facts.findByReference.matches += matches;
      if (matches > 0 && facts.findByReference.foundOnPage === null)
        facts.findByReference.foundOnPage = page;
      facts.findByReference.total = result.json?.total ?? null;
      if (facts.findByReference.matches >= created.length || page >= (result.json?.last_page ?? 1))
        break;
    }

    // Tracking.
    if (a.number !== null) {
      const full = await call(ctx, "GET /shipments/tracking (A)", {
        path: "/shipments/tracking",
        query: { numbers: [a.number] },
      });
      const current = currentTrackingStatus(full.json);
      const firstItem = items(full.json)[0];
      facts.tracking = {
        ...brief(full.record),
        topKeys:
          full.json !== null && typeof full.json === "object"
            ? Object.keys(full.json).sort()
            : null,
        // The documented answer is {currentStatus: [...]}; production answered {items: [...]} (2026-10-25).
        itemFields: fieldNames(firstItem === undefined ? [] : [firstItem]),
        itemShape: firstItem === undefined ? null : shapeOf(firstItem),
        statusCodeFoundAt: current?.at ?? null,
        statusCode:
          typeof current?.row.statusCode === "string" || typeof current?.row.statusCode === "number"
            ? current.row.statusCode
            : null,
        statusCodeType: typesOf(current === undefined ? [] : [current.row], "statusCode"),
        statusDateType: typesOf(current === undefined ? [] : [current.row], "statusDate"),
      };
      const history = await call(ctx, "GET /shipments/tracking/history (A)", {
        path: "/shipments/tracking/history",
        query: { numbers: [a.number] },
      });
      const historyRows = items(history.json)[0]?.history_tracking ?? [];
      facts.trackingHistory = {
        ...brief(history.record),
        codes: distinct(historyRows, "code"),
        dateTypes: typesOf(historyRows, "date"),
      };

      // Label: the documented form first; on a refusal one variant with the documented optional `format=pdf`.
      facts.label = { attempts: [] };
      for (const [variant, extra] of LABEL_VARIANTS) {
        const label = await call(ctx, `GET /shipments/print marking (A, ${variant})`, {
          path: "/shipments/print",
          query: { ...labelQuery(a.number), ...extra },
          accept: "application/pdf, application/json",
          binary: true,
        });
        if (label.status === 200 && label.record.startsWithPdf) a.labelPrinted = true;
        const attempt = {
          variant,
          ...pick(label.record, [
            "httpStatus",
            "contentType",
            "responseBytes",
            "startsWithPdf",
            "bodyKeys",
            "errorKeys",
            "errorMessages",
            "latencyMs",
            "transportError",
          ]),
        };
        facts.label.attempts.push(attempt);
        Object.assign(facts.label, attempt);
        if (a.labelPrinted) break;
      }
      facts.label.noKeyInUrl = true;
    }

    // Delete: B by number (expected refusal for UA), A by id after its label was printed, A again, B by id.
    const b = created[1];
    if (b !== undefined && b.number !== null) {
      const byNumberDelete = await call(ctx, "DELETE /shipments/<B number>", {
        method: "DELETE",
        path: `/shipments/${encodeURIComponent(b.number)}`,
        pathLabel: "/shipments/<number>",
      });
      facts.deleteByNumber = brief(byNumberDelete.record);
      if (isDeletedAnswer(byNumberDelete)) b.deleted = true;
    }
    const deleteA = await call(ctx, "DELETE /shipments/<A id> (after label)", {
      method: "DELETE",
      path: `/shipments/${encodeURIComponent(a.id)}`,
      pathLabel: "/shipments/<id>",
    });
    facts.deleteAfterLabel = {
      ...brief(deleteA.record),
      labelPrinted: a.labelPrinted,
      shape: shapeOf(deleteA.json),
    };
    if (isDeletedAnswer(deleteA)) a.deleted = true;
    const repeatA = await call(ctx, "DELETE /shipments/<A id> again", {
      method: "DELETE",
      path: `/shipments/${encodeURIComponent(a.id)}`,
      pathLabel: "/shipments/<id>",
    });
    facts.deleteRepeat = brief(repeatA.record);
    if (b !== undefined && !b.deleted) {
      const deleteB = await call(ctx, "DELETE /shipments/<B id>", {
        method: "DELETE",
        path: `/shipments/${encodeURIComponent(b.id)}`,
        pathLabel: "/shipments/<id>",
      });
      facts.deleteB = brief(deleteB.record);
      if (isDeletedAnswer(deleteB)) b.deleted = true;
    }
    facts.deleteUnknown = brief(
      (
        await call(ctx, "DELETE /shipments/<random uuid>", {
          method: "DELETE",
          path: `/shipments/${randomUUID()}`,
          pathLabel: "/shipments/<random uuid>",
        })
      ).record,
    );

    // Verify gone.
    const numbers = created.map((item) => item.number).filter((number) => number !== null);
    if (numbers.length > 0) {
      const after = await call(ctx, "GET /shipments numbers[] after delete", {
        path: "/shipments",
        query: { numbers },
      });
      const rowsAfter = items(after.json);
      facts.afterDelete = {
        ...brief(after.record),
        listed: rowsAfter.length,
        statuses: distinct(rowsAfter, "status"),
        deletedAtTypes: typesOf(rowsAfter, "deletedAt"),
      };
      const trackAfter = await call(ctx, "GET /shipments/tracking/history (A after delete)", {
        path: "/shipments/tracking/history",
        query: { numbers: [numbers[0]] },
      });
      facts.afterDelete.trackingCodes = distinct(
        items(trackAfter.json)[0]?.history_tracking ?? [],
        "code",
      );
      if (after.status === 200) {
        for (const item of created) {
          const row = rowsAfter.find((candidate) => candidate.number === item.number);
          const gone =
            row === undefined ||
            row.status === "Deleted" ||
            (typeof row.deletedAt === "string" && row.deletedAt !== "");
          item.deleted = item.deleted && gone;
        }
      }
    }
  } finally {
    await cleanup(ctx, created);
  }
}

async function cleanup(ctx, created) {
  const pending = created.filter((item) => !item.deleted);
  const result = { created: created.length, retried: pending.length, leftovers: [] };
  for (const item of pending) {
    try {
      const answer = await call(ctx, "cleanup DELETE /shipments/<id>", {
        method: "DELETE",
        path: `/shipments/${encodeURIComponent(item.id)}`,
        pathLabel: "/shipments/<id>",
      });
      if (isDeletedAnswer(answer)) item.deleted = true;
    } catch (error) {
      result.cleanupError = scrubMessage(errorText(error), ctx.secrets);
    }
  }
  for (const item of created) {
    // Our own spike shipment number: needed to delete it by hand; not personal data.
    if (!item.deleted) result.leftovers.push(String(item.number ?? item.id));
  }
  ctx.cleanup = result;
}

// ---------------------------------------------------------------------------------------------------------------------
// The doc-based hypotheses (docs/plans/2026-10-24-shipping.md, section 8, "Nova Post API") and what the run says

const DOCS = "https://api-portal.novapost.com";
const NOT_TESTED = (why) => ({ status: "NOT TESTED", fact: why });
const verdict = (ok, fact) => ({ status: ok ? "CONFIRMED" : "DIFFERENT", fact });
const statusOf = (record) => String(record?.httpStatus ?? record?.transportError ?? "-");

/** Division facts are only evidence when the chosen settlement has divisions (the run of 2026-10-25 had none). */
const noDivisions = (f) =>
  f.readonly?.divisions !== undefined && !(f.readonly.divisions.itemCount > 0)
    ? NOT_TESTED(
        `the chosen settlement has no divisions (${JSON.stringify(f.readonly.settlementChoice ?? null)}); rerun with --settlement-id`,
      )
    : undefined;

const HYPOTHESES = [
  [
    "H01",
    `Base URLs: production https://api.novapost.com/v.1.0, sandbox https://api-stage.novapost.com/v.1.0 (also named: api-stage.novapost.pl) [${DOCS}/methods/methods/authorization.md, ${DOCS}/novaposhta-docs/integration-guide/testing.md]`,
    (f) => {
      const k = f.keyless;
      if (k === undefined) return NOT_TESTED("not run");
      const answered = typeof k.authorizationNoKey.httpStatus === "number";
      return verdict(
        answered,
        `${f.environment} base answers (authorization without key: ${statusOf(k.authorizationNoKey)})${k.altSandboxHost ? `; alternative sandbox host: ${statusOf(k.altSandboxHost)}` : ""}`,
      );
    },
  ],
  [
    "H02",
    `GET /clients/authorization?apiKey= returns {jwt}; 401/422 on a bad key [${DOCS}/methods/methods/authorization.md]`,
    (f) => {
      const k = f.keyless;
      if (k === undefined) return NOT_TESTED("not run");
      const keyed = f.readonly?.authorization ?? f.write?.authorization;
      return {
        status:
          keyed === undefined ? "NOT TESTED" : keyed.httpStatus === 200 ? "CONFIRMED" : "DIFFERENT",
        fact: `no key: ${statusOf(k.authorizationNoKey)} ${JSON.stringify(k.authorizationNoKey.errorKeys)}; invented key: ${statusOf(k.authorizationInventedKey)} ${JSON.stringify(k.authorizationInventedKey.errorMessages)}${keyed ? `; real key: ${statusOf(keyed)} ${JSON.stringify(keyed.bodyKeys)}` : "; real key: needs readonly"}`,
      };
    },
  ],
  [
    "H03",
    `The JWT is valid about 1 hour [${DOCS}/novaposhta-docs/integration-guide/using-tokens.md]`,
    (f) => {
      const jwt = f.readonly?.jwt ?? f.write?.jwt;
      if (jwt === undefined) return NOT_TESTED("needs a key");
      const seconds = jwt.lifetimeSeconds ?? jwt.lifetimeSecondsFromNow;
      if (typeof seconds !== "number")
        return NOT_TESTED(`no exp claim (claims ${JSON.stringify(jwt.claimNames)})`);
      return verdict(
        seconds >= 3000 && seconds <= 4000,
        `exp - iat = ${String(seconds)} s; alg ${String(jwt.alg)}; claims ${JSON.stringify(jwt.claimNames)}`,
      );
    },
  ],
  [
    "H04",
    `Authorization header carries the raw JWT [${DOCS}/methods/methods/authorization.md] (the help center and API errors pages say "Bearer" [${DOCS}/help-center/readme.md, ${DOCS}/methods/methods/api-errors.md])`,
    (f) => {
      const scheme = f.readonly?.authScheme ?? f.write?.authScheme;
      if (scheme === undefined) return NOT_TESTED("needs a key");
      return verdict(
        scheme.raw === 200,
        `raw: ${String(scheme.raw)}, Bearer: ${String(scheme.bearer)}`,
      );
    },
  ],
  [
    "H05",
    `A second JWT does not invalidate the first ("the maximum number of active sessions may be limited") [${DOCS}/novaposhta-docs/integration-guide/using-tokens.md]`,
    (f) => {
      const s = f.readonly?.secondJwt;
      if (s === undefined) return NOT_TESTED("needs readonly");
      return verdict(s.firstStillAccepted === true, JSON.stringify(s));
    },
  ],
  [
    "H06",
    `Errors are {errors: {<field>|errorMessage: text}}; 401 "Invalid token", 404 route, 422 validation [${DOCS}/methods/methods/api-errors.md]`,
    (f) => {
      const k = f.keyless;
      if (k === undefined) return NOT_TESTED("not run");
      const ok =
        k.divisionsNoAuth.httpStatus === 401 &&
        JSON.stringify(k.divisionsNoAuth.bodyKeys) === '["errors"]' &&
        k.unknownRoute.httpStatus === 404;
      return verdict(
        ok,
        `no auth: ${statusOf(k.divisionsNoAuth)} ${JSON.stringify(k.divisionsNoAuth.errorKeys)} ${JSON.stringify(k.divisionsNoAuth.errorMessages)}; junk raw/Bearer: ${statusOf(k.divisionsJunkRaw)}/${statusOf(k.divisionsJunkBearer)}; unknown route: ${statusOf(k.unknownRoute)}; invalid JSON without auth: ${statusOf(k.shipmentsCreateNoAuthInvalidJson)} (auth is checked first)`,
      );
    },
  ],
  [
    "H07",
    `POST /test-api-keys is sandbox only ("not available in PROD") [${DOCS}/novaposhta-docs/integration-guide/api-key-generation.md]`,
    (f) => {
      const t = f.keyless?.testApiKeysEmptyBody;
      if (t === undefined) return NOT_TESTED("not run");
      if (f.environment !== "production")
        return NOT_TESTED(
          `sandbox: ${statusOf(t)} ${JSON.stringify(t.errorMessages)}; run --env production to check absence`,
        );
      return verdict(
        t.httpStatus === 404,
        `production: ${statusOf(t)} ${JSON.stringify(t.errorMessages)}`,
      );
    },
  ],
  [
    "H08",
    `Per-minute rate limit answers 429 "Too Many Attempts." [${DOCS}/methods/methods/api-errors.md]; numbers not documented`,
    (f) => {
      const b = f.readonly?.burst;
      const seen = f.keyless?.rateHeadersSeen ?? {};
      if (b === undefined)
        return NOT_TESTED(`key-less rate headers seen on: ${JSON.stringify(Object.keys(seen))}`);
      return NOT_TESTED(
        `10 authenticated calls: statuses ${JSON.stringify(b.statuses)}, rate headers ${JSON.stringify(b.rateHeaders.at(-1))}; the limit itself is not provoked`,
      );
    },
  ],
  [
    "H09",
    `GET /settlements: textSearch, countryCodes[], limit/page; page envelope {current_page, last_page, per_page, total, from, to, items} [${DOCS}/methods/methods/dictionaries.md]`,
    (f) => {
      const s = f.readonly?.settlements;
      if (s === undefined) return NOT_TESTED("needs a key");
      return verdict(
        s.httpStatus === 200 && s.page !== undefined,
        `${statusOf(s)}, page ${JSON.stringify(s.page)}, ${String(s.itemCount)} items; Latin search: ${statusOf(f.readonly.settlementsLatinSearch)} total ${String(f.readonly.settlementsLatinSearch.page?.total)}; countryCodes[]=uk: ${statusOf(f.readonly.settlementsLowercaseCountry)}; country total ${String(f.readonly.settlementsCountryTotal)}`,
      );
    },
  ],
  [
    "H10",
    `Settlement fields id (int), name, region {id, name, parent}, postCode1/2, alternativeNames, prohibitedIssuance/Sending [${DOCS}/methods/methods/dictionaries.md]`,
    (f) => {
      const s = f.readonly?.settlements;
      if (s === undefined) return NOT_TESTED("needs a key");
      const expected = [
        "id",
        "name",
        "region",
        "postCode1",
        "postCode2",
        "alternativeNames",
        "prohibitedIssuance",
        "prohibitedSending",
      ];
      const missing = expected.filter((name) => !s.fields.includes(name));
      return verdict(
        missing.length === 0 && s.idTypes.includes("number"),
        `${missing.length ? `missing ${missing.join(", ")}; ` : ""}id ${JSON.stringify(s.idTypes)}; fields ${JSON.stringify(s.fields)}`,
      );
    },
  ],
  [
    "H11",
    `Settlement names follow Accept-language (the schema lists no language header for /settlements) [${DOCS}/methods/methods/dictionaries.md]`,
    (f) => {
      const l = f.readonly?.settlementLanguages;
      if (l === undefined) return NOT_TESTED("needs a key");
      return verdict(
        l.en?.nameScript === "text(latin)",
        `en: ${JSON.stringify(l.en)}, uk: ${JSON.stringify(l.uk)}`,
      );
    },
  ],
  [
    "H12",
    `GET /divisions: settlementIds[], divisionCategories[] (Postomat, PostBranch, CargoBranch, PUDO), statuses default Working, limit default 15 [${DOCS}/methods/methods/dictionaries.md]`,
    (f) => {
      const d = f.readonly?.divisions;
      if (d === undefined) return NOT_TESTED("needs a key");
      const empty = noDivisions(f);
      if (empty !== undefined) return empty;
      return verdict(
        d.httpStatus === 200 && d.allInSettlement,
        `${statusOf(d)}, page ${JSON.stringify(d.page)}, page 2 ${statusOf(d.page2)} (overlap ${String(d.pagesOverlap)}); categories ${JSON.stringify(d.divisionCategories)}; statuses ${JSON.stringify(d.statuses)}; filter ${JSON.stringify(f.readonly.divisionCategoryFilter)}; country total ${String(f.readonly.divisionsCountryTotal)}; ${String(d.responseBytes)} bytes for ${String(d.itemCount)}`,
      );
    },
  ],
  [
    "H13",
    `Division fields id (int), number, name, shortName, address, divisionCategory, status, settlement, max*PlaceRecipient (g, mm), maxDeclaredCostPlace, workSchedule; externalId not for integrations [${DOCS}/methods/methods/dictionaries.md, ${DOCS}/checklists/change-in-the-semantics-of-the-externalid-field-in-the-division-directory.md]`,
    (f) => {
      const d = f.readonly?.divisions;
      if (d === undefined) return NOT_TESTED("needs a key");
      const empty = noDivisions(f);
      if (empty !== undefined) return empty;
      const expected = [
        "id",
        "number",
        "name",
        "shortName",
        "address",
        "divisionCategory",
        "status",
        "settlement",
        "maxWeightPlaceRecipient",
        "maxDeclaredCostPlace",
        "workSchedule",
      ];
      const missing = expected.filter((name) => !d.fields.includes(name));
      return verdict(
        missing.length === 0 && d.idTypes.includes("number"),
        `${missing.length ? `missing ${missing.join(", ")}; ` : ""}id ${JSON.stringify(d.idTypes)}, number ${JSON.stringify(d.numberTypes)}, externalId ${JSON.stringify(d.externalIdTypes)}, maxWeightPlaceRecipient ${JSON.stringify(d.maxWeightPlaceRecipientTypes)}`,
      );
    },
  ],
  [
    "H14",
    `Division names in uk and en via Accept-language [${DOCS}/methods/methods/dictionaries.md]`,
    (f) => {
      const l = f.readonly?.divisionLanguages;
      if (l === undefined) return NOT_TESTED("needs a key");
      const empty = noDivisions(f);
      if (empty !== undefined) return empty;
      return verdict(
        l.en?.nameScript === "text(latin)" && l.uk?.nameScript === "text(cyrillic)",
        `en ${JSON.stringify(l.en)}; uk ${JSON.stringify(l.uk)}`,
      );
    },
  ],
  [
    "H15",
    `Largest page: limit at most 100 ("The limit field must not be greater than 100") [${DOCS}/methods/methods/api-errors.md]`,
    (f) => {
      const r = f.readonly;
      if (r?.divisionLimits === undefined) return NOT_TESTED("needs a key");
      const ok100 =
        r.divisionLimits[100].httpStatus === 200 && r.settlementLimits[100].httpStatus === 200;
      const refused101 = r.divisionLimits[101].httpStatus === 422;
      return verdict(
        ok100 && refused101,
        `divisions 100/101/500: ${statusOf(r.divisionLimits[100])}/${statusOf(r.divisionLimits[101])}/${statusOf(r.divisionLimits[500])} (500: ${JSON.stringify(r.divisionLimits[500].errorMessages ?? [])}); settlements: ${statusOf(r.settlementLimits[100])}/${statusOf(r.settlementLimits[101])}/${statusOf(r.settlementLimits[500])}; shipments: ${statusOf(r.shipmentListLimits[100])}/${statusOf(r.shipmentListLimits[101])}`,
      );
    },
  ],
  [
    "H16",
    `One division by id: no documented filter on GET /divisions [${DOCS}/methods/methods/dictionaries.md]`,
    (f) => {
      const d = f.readonly?.divisionById;
      if (d === undefined) return noDivisions(f) ?? NOT_TESTED("needs a key");
      const works = Object.entries(d)
        .filter(([, value]) => value.onlyThatDivision)
        .map(([name]) => name);
      return {
        status: works.length > 0 ? "DIFFERENT" : "CONFIRMED",
        fact: `undocumented filters that return exactly that division: ${JSON.stringify(works)}; all: ${JSON.stringify(d)}`,
      };
    },
  ],
  [
    "H17",
    `Offline divisions dictionary is key-less (302 to a CDN .json.gz manifest, daily) [${DOCS}/methods/methods/dictionaries.md]`,
    (f) => {
      const o = f.keyless?.offlineDivisions;
      if (o === undefined) return NOT_TESTED("not run");
      return verdict(
        o.httpStatus === 302,
        `${statusOf(o)} to ${String(o.redirectHost)}; bad units: ${statusOf(f.keyless.offlineDivisionsBadUnits)}`,
      );
    },
  ],
  [
    "H18",
    `POST /shipments/calculations prices a UA division-to-division parcel; the answer names no currency [${DOCS}/methods/methods/shipments/delivery-cost.md]`,
    (f) => {
      const c = f.readonly?.calculation;
      if (c === undefined) return NOT_TESTED("needs a key (and two divisions)");
      return verdict(
        c.httpStatus === 200 && c.serviceCount > 0,
        `${statusOf(c)}; services ${String(c.serviceCount)}, cost ${JSON.stringify(c.serviceCostTypes)}, currency field ${String(c.hasCurrencyField)}; error sample ${statusOf(f.readonly.calculationError)} ${JSON.stringify(f.readonly.calculationError?.errorKeys)}`,
      );
    },
  ],
  [
    "H19",
    `POST /shipments takes inline sender/recipient (name, phone, divisionId) and answers 201 {id (uuid), number, cost, scheduledDeliveryDate, status ReadyToShip, createdAt} [${DOCS}/methods/methods/shipments/create-shipments/domestic-shipments-within-ukraine.md]`,
    (f) => {
      const c = f.write?.create;
      if (c === undefined) return NOT_TESTED("needs the write stage");
      return verdict(
        c.httpStatus === 201 && c.statusValue === "ReadyToShip",
        `${statusOf(c)}; id ${JSON.stringify(c.idType)}, number ${JSON.stringify(c.numberType)}, cost ${JSON.stringify(c.costType)}, status ${String(c.statusValue)}; errors ${JSON.stringify(c.errorKeys)} ${JSON.stringify(c.errorMessages)}`,
      );
    },
  ],
  [
    "H20",
    `Shipment number: the schema says ^[A-Z]{4}\\d{10}$; UA numbers appear as 14 digits elsewhere [${DOCS}/methods/methods/shipments.md, ${DOCS}/methods/methods/pickups.md]`,
    (f) => {
      const c = f.write?.create;
      if (c === undefined) return NOT_TESTED("needs the write stage");
      return {
        status: "CONFIRMED",
        fact: `a UA domestic shipment number is ${JSON.stringify(c.numberType)} (record, not a pass/fail)`,
      };
    },
  ],
  [
    "H21",
    `clientOrder (max 50) is stored and returned by GET /shipments [${DOCS}/methods/methods/shipments/create-shipments/domestic-shipments-within-ukraine.md]`,
    (f) => {
      const n = f.write?.findByNumber;
      if (n === undefined) return NOT_TESTED("needs the write stage");
      return verdict(
        n.clientOrderEchoed,
        `found by number ${String(n.found)}, clientOrder echoed ${String(n.clientOrderEchoed)}, reference length ${String(f.write.referenceLength)}`,
      );
    },
  ],
  [
    "H22",
    "No idempotency for POST /shipments (no key, header or rule in the docs) [the create pages; no page mentions idempotency]",
    (f) => {
      const r = f.write?.repeatCreate;
      if (r === undefined)
        return NOT_TESTED(f.write ? "--skip-repeat-create" : "needs the write stage");
      return verdict(
        r.createdAnother && !r.sameId,
        `repeat with the same clientOrder: ${statusOf(r)}, another shipment ${String(r.createdAnother)}, same id ${String(r.sameId)}`,
      );
    },
  ],
  [
    "H23",
    `GET /shipments has no clientOrder or date filter (numbers[], ids[], limit, page, senderDivisionId only): finding a shipment by our reference means paging [${DOCS}/methods/methods/shipments.md]`,
    (f) => {
      const r = f.write?.findByReference;
      const u = f.readonly?.shipmentListUndocumentedFilter;
      if (r === undefined)
        return NOT_TESTED(
          u
            ? `readonly: clientOrder filter answers ${statusOf(u)} with ${String(u.page?.total)} total; order ${String(f.readonly.shipmentList?.order)}`
            : "needs a key",
        );
      return verdict(
        r.foundOnPage !== null,
        `found by clientOrder on page ${String(r.foundOnPage)} after ${String(r.pagesRead)} page(s), ${String(r.matches)} match(es), list total ${String(r.total)}, order per page ${JSON.stringify(r.order)}`,
      );
    },
  ],
  [
    "H24",
    `GET /shipments?ids[] takes the id that POST answered (the schema says int32 ids, the create answer a uuid) [${DOCS}/methods/methods/shipments.md]`,
    (f) => {
      const i = f.write?.findById;
      if (i === undefined) return NOT_TESTED("needs the write stage");
      return verdict(
        i.found,
        `${statusOf(i)}, found ${String(i.found)} ${JSON.stringify(i.errorKeys ?? [])}`,
      );
    },
  ],
  [
    "H25",
    `Tracking needs the JWT and answers string status codes (1 Ready to send, 2 Deleted, ...) [${DOCS}/methods/methods/shipments/tracking-shipment.md]`,
    (f) => {
      const t = f.write?.tracking;
      const invented = f.readonly?.trackingInvented;
      if (t === undefined)
        return NOT_TESTED(
          invented
            ? `readonly: invented number ${statusOf(invented)} ${JSON.stringify(invented.errorMessages)}; key-less divisions: ${statusOf(f.keyless?.divisionsNoAuth)}`
            : "needs a key",
        );
      return verdict(
        String(t.statusCode) === "1",
        `fresh shipment: statusCode ${JSON.stringify(t.statusCode)} ${JSON.stringify(t.statusCodeType)} at ${String(t.statusCodeFoundAt)} (answer keys ${JSON.stringify(t.topKeys)}, item fields ${JSON.stringify(t.itemFields ?? [])}); history codes ${JSON.stringify(f.write.trackingHistory?.codes)}; after delete ${JSON.stringify(f.write.afterDelete?.trackingCodes)}`,
      );
    },
  ],
  [
    "H26",
    "Most numbers per tracking call: not documented (the error catalogue lists 100 and 200 item caps for unnamed routes)",
    (f) => {
      const b = f.readonly?.trackingBatch;
      if (b === undefined) return NOT_TESTED("needs a key");
      return NOT_TESTED(
        `invented numbers 100: ${statusOf(b[100])} ${JSON.stringify(b[100].errorMessages ?? [])}; 101: ${statusOf(b[101])} ${JSON.stringify(b[101].errorMessages ?? [])}`,
      );
    },
  ],
  [
    "H27",
    `Label: GET /shipments/print?numbers[]=<number>&type=marking answers application/pdf with the JWT (no key in a URL; one number per marking request) [${DOCS}/methods/methods/shipments/print-documents/marking-labels.md]`,
    (f) => {
      const l = f.write?.label;
      if (l === undefined)
        return NOT_TESTED(
          f.readonly?.printInvented
            ? `readonly: invented number ${statusOf(f.readonly.printInvented)} ${JSON.stringify(f.readonly.printInvented.errorKeys ?? [])} ${JSON.stringify(f.readonly.printInvented.errorMessages ?? [])}`
            : "needs the write stage",
        );
      const attempts = (l.attempts ?? [l])
        .map(
          (item) =>
            `${String(item.variant ?? "request")}: ${statusOf(item)} ${String(item.contentType)} ${String(item.responseBytes)} bytes, %PDF- ${String(item.startsWithPdf)}${item.errorKeys ? ` ${JSON.stringify(item.errorKeys)} ${JSON.stringify(item.errorMessages)}` : ""}`,
        )
        .join("; ");
      return verdict(l.startsWithPdf === true, attempts);
    },
  ],
  [
    "H28",
    `DELETE /shipments/{id} cancels by id; a UA shipment cannot be deleted by number [${DOCS}/methods/methods/shipments.md]`,
    (f) => {
      const d = f.write?.deleteAfterLabel;
      if (d === undefined) return NOT_TESTED("needs the write stage");
      return verdict(
        d.httpStatus === 200 &&
          (f.write.deleteByNumber === undefined || f.write.deleteByNumber.httpStatus !== 200),
        `by id: ${statusOf(d)}; by number: ${statusOf(f.write.deleteByNumber)} ${JSON.stringify(f.write.deleteByNumber?.errorMessages ?? [])}`,
      );
    },
  ],
  [
    "H29",
    `Repeat delete answers 422 shipment_was_deleted; an unknown id 404 shipment_not_found [${DOCS}/changelog-1/documentation-eng/returning-doc-was-deleted-response-for-repeated-deletion-of-a-shipment.md]`,
    (f) => {
      const r = f.write?.deleteRepeat;
      if (r === undefined) return NOT_TESTED("needs the write stage");
      return verdict(
        r.httpStatus === 422 && JSON.stringify(r.errorMessages).includes("shipment_was_deleted"),
        `repeat: ${statusOf(r)} ${JSON.stringify(r.errorMessages)}; unknown: ${statusOf(f.write.deleteUnknown)} ${JSON.stringify(f.write.deleteUnknown?.errorMessages)}`,
      );
    },
  ],
  [
    "H30",
    `A shipment whose label was printed can still be deleted (only updates are documented as blocked after printing) [${DOCS}/methods/methods/shipments.md]`,
    (f) => {
      const d = f.write?.deleteAfterLabel;
      if (d === undefined) return NOT_TESTED("needs the write stage");
      if (d.labelPrinted !== true) return NOT_TESTED("the label was not printed in this run");
      return verdict(
        d.httpStatus === 200,
        `delete after the label: ${statusOf(d)} ${JSON.stringify(d.errorMessages ?? [])}`,
      );
    },
  ],
  [
    "H31",
    `Shipment and tracking times are ISO 8601 in UTC (no Kyiv local dates) [${DOCS}/methods/methods/shipments/tracking-shipment.md]`,
    (f) => {
      const c = f.write?.create;
      const clock = f.write?.createdAtClock;
      if (c === undefined)
        return NOT_TESTED(
          f.readonly?.shipmentList
            ? `readonly list createdAt ${JSON.stringify(f.readonly.shipmentList.createdAtTypes)}`
            : "needs a key",
        );
      return verdict(
        JSON.stringify(c.createdAtType).includes("ISO") &&
          Math.abs(clock?.offsetMinutesFromOurClock ?? 999) <= 5,
        `createdAt ${JSON.stringify(c.createdAtType)}, offset from our clock ${String(clock?.offsetMinutesFromOurClock)} min; history dates ${JSON.stringify(f.write.trackingHistory?.dateTypes)}`,
      );
    },
  ],
  [
    "H32",
    `Webhooks exist (tracking-push subscriptions; in the sandbox only the test webhook is sent) [${DOCS}/methods/methods/webhooks.md]`,
    (f) => {
      const w = f.readonly?.webhookSubscriptions;
      if (w === undefined) return NOT_TESTED("docs fact; the readonly stage lists subscriptions");
      return verdict(w.httpStatus === 200, `GET /tracking-push/subscribers: ${statusOf(w)}`);
    },
  ],
  [
    "H33",
    "Production shipments are billable / a deleted ReadyToShip shipment costs nothing: not stated in the docs",
    () => NOT_TESTED("not observable by a script; check the contract or the manager"),
  ],
  [
    "H34",
    `Sandbox test keys: POST /test-api-keys with a phone registered at my.novapost.com, "UA key generation is currently not supported" [${DOCS}/novaposhta-docs/integration-guide/api-key-generation.md]`,
    () => NOT_TESTED("docs fact; the spike never requests a key"),
  ],
  [
    "H35",
    `Weights in grams and sizes in mm as integers; insuranceCost in the sender country's currency [${DOCS}/methods/methods/shipments/create-shipments/domestic-shipments-within-ukraine.md]`,
    (f) => {
      const c = f.write?.create;
      if (c === undefined) return NOT_TESTED("needs the write stage");
      return verdict(
        c.httpStatus === 201,
        `a ${String(f.write?.weightG ?? "")}g parcel was accepted as sent (${statusOf(c)})`,
      );
    },
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
    "Usage: node scripts/spikes/nova-post-verify.mjs [--stage keyless|readonly|write] [--env sandbox|production] [--confirm] [--allow-production-write] [--out <path>] [...]",
  );
  io.out("       node scripts/spikes/nova-post-verify.mjs --self-test");
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

  const apiKey = env.NOVA_POST_API_KEY;
  const secrets = collectSecrets(apiKey, options);
  const say = (line) => io.out(scrub(line, secrets));
  const warn = (line) => io.err(scrub(line, secrets));
  const target = (deps.targets ?? TARGETS)[options.environment];

  if (options.stage !== "keyless" && !nonEmpty(apiKey)) {
    warn(
      `refused: --stage ${options.stage} needs NOVA_POST_API_KEY in the environment (never pass it as a flag). Nothing was sent.`,
    );
    return 2;
  }
  if (options.stage === "write") {
    say(
      `Write stage plan (${options.environment}; on the account of the key's owner; nothing else is called):`,
    );
    for (const [index, step] of writePlan(options, target).entries())
      say(`  ${String(index + 1)}. ${step}`);
    if (options.environment === "production" && !options.allowProductionWrite) {
      warn(
        "refused: the write stage creates real shipments; on --env production it also needs --allow-production-write. Nothing was sent.",
      );
      return 2;
    }
    const missing = missingWriteInputs(options);
    if (missing.length > 0) {
      warn(`refused: missing inputs: ${missing.join(", ")}. Nothing was sent.`);
      return 2;
    }
    if (!options.confirm) {
      warn(
        "refused: the write stage creates and deletes shipments; re-run with --confirm after reading the plan. Nothing was sent.",
      );
      return 2;
    }
  }

  const ctx = {
    target,
    fetch: deps.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    now: deps.now ?? (() => new Date()),
    apiKey: nonEmpty(apiKey) ? apiKey.trim() : undefined,
    jwt: undefined,
    authScheme: "raw",
    secrets,
    options,
    calls: [],
    facts: {},
    cleanup: undefined,
    injectFault: deps.injectFault,
  };
  if (options.stage === "keyless") ctx.apiKey = undefined;

  const startedAt = ctx.now().toISOString();
  let failure;
  try {
    // keyless always runs first: it is cheap and the other stages' summaries build on it.
    say(`Stage keyless (${options.environment}: ${target.base})...`);
    await stageKeyless(ctx);
    if (options.stage === "readonly") {
      say("Stage readonly...");
      await stageReadonly(ctx);
    }
    if (options.stage === "write") {
      say("Stage write...");
      await stageWrite(ctx);
      ctx.facts.write.weightG = options.weightG;
    }
  } catch (error) {
    failure = scrubMessage(errorText(error), ctx.secrets);
    warn(`stage failed: ${failure}`);
  }

  const hypotheses = evaluateHypotheses({
    ...ctx.facts,
    environment: options.environment,
    calls: ctx.calls,
  });
  const findings = {
    tool: "scripts/spikes/nova-post-verify.mjs",
    spikeVersion: SPIKE_VERSION,
    stage: options.stage,
    environment: options.environment,
    base: target.base,
    startedAt,
    finishedAt: ctx.now().toISOString(),
    node: process.version,
    failure: failure ?? null,
    cleanup: ctx.cleanup ?? null,
    hypotheses,
    facts: ctx.facts,
    calls: ctx.calls,
  };
  const outPath = resolve(options.out);
  writeFileSync(outPath, `${scrubMessageless(JSON.stringify(findings, null, 2), ctx.secrets)}\n`, {
    mode: 0o600,
  });

  const sayFinal = (line) => io.out(scrub(line, ctx.secrets));
  sayFinal("");
  sayFinal(`Calls: ${String(ctx.calls.length)}; findings written to ${outPath}`);
  sayFinal("Plan section 8 (Nova Post API) hypotheses:");
  for (const item of hypotheses)
    sayFinal(`  ${item.id} ${item.status.padEnd(10)} ${item.claim}\n      -> ${item.fact}`);
  if (ctx.cleanup !== undefined) {
    if (ctx.cleanup.leftovers.length > 0) {
      io.err(
        scrub(
          `CLEANUP INCOMPLETE: delete these spike shipments by hand in the cabinet: ${ctx.cleanup.leftovers.join(", ")}`,
          ctx.secrets,
        ),
      );
      return 3;
    }
    sayFinal(`Cleanup: ${String(ctx.cleanup.created)} shipment(s) created, all confirmed deleted.`);
  }
  return failure === undefined ? 0 : 1;
}

/** The findings file: secrets replaced, JWT-like runs replaced (texts were already cut when recorded). */
function scrubMessageless(text, secrets) {
  return scrub(text, secrets).replace(
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
    "[jwt]",
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Self-test: a local stub of the carrier, no network

const STUB_PHONE = "380001112233";
const STUB_SENDER_NAME = "Стабенко Тест";

function stubJwt(lifetime) {
  const now = Math.floor(Date.now() / 1000);
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ iat: now, exp: now + lifetime, sub: "stub-subject" })}.${randomBytes(16).toString("base64url")}`;
}

function startStub(behaviour) {
  const state = {
    requests: 0,
    keysSeen: new Set(),
    jwts: new Set(),
    shipments: new Map(), // id -> shipment
    deleteFailures: 0,
    lastRequestPaths: [],
  };
  const page = (list, query) => {
    const limit = Number(query.get("limit") ?? "15");
    const pageNumber = Number(query.get("page") ?? "1");
    const start = (pageNumber - 1) * limit;
    const slice = list.slice(start, start + limit);
    return {
      current_page: pageNumber,
      last_page: Math.max(1, Math.ceil(list.length / limit)),
      per_page: limit,
      total: list.length,
      from: slice.length > 0 ? start + 1 : null,
      to: slice.length > 0 ? start + slice.length : null,
      items: slice,
    };
  };
  const settlementRow = (id, name) => ({
    id,
    name,
    country: { name: "Україна", code: "UA" },
    region: { id: 1, name: "Тестовий район", parent: { id: 2, name: "Тестова область" } },
    latitude: 50.4,
    longitude: 30.5,
    postCode1: "01001",
    postCode2: "01999",
    alternativeNames: [],
    externalId: randomUUID(),
    boost: 0,
    prohibitedIssuance: false,
    prohibitedSending: false,
    createdAt: "2026-01-01T00:00:00.000000Z",
    updatedAt: "2026-01-01T00:00:00.000000Z",
    deletedAt: null,
  });
  // Like production: the first search hit is a namesake village without divisions; the city comes later.
  const city = settlementRow(100_001, "місто Київ");
  const settlements = [settlementRow(100_002, "село Київське"), city];
  const divisions = [1, 2, 3].map((index) => ({
    id: 4000 + index,
    name: `Відділення №${String(index)}`,
    shortName: `№${String(index)}`,
    externalId: randomUUID(),
    source: "NPUA",
    countryCode: "UA",
    settlement: city,
    address: "Тестова вул., 1",
    number: String(index),
    status: "Working",
    divisionCategory: index === 3 ? "Postomat" : "PostBranch",
    maxWeightPlaceRecipient: 30_000,
    maxLengthPlaceRecipient: 1200,
    maxWidthPlaceRecipient: 700,
    maxHeightPlaceRecipient: 700,
    maxDeclaredCostPlace: 50_000,
    workSchedule: [{ day: "Monday", from: "08:00", to: "20:00" }],
    publicPhones: [STUB_PHONE],
  }));
  const errors = (status, errorsObject) => [status, { errors: errorsObject }];
  const authorized = (headers) => {
    const value = headers.authorization;
    if (typeof value !== "string") return false;
    // The stub accepts the raw form only, like the authorization page documents.
    return state.jwts.has(value);
  };

  const handle = (method, path, query, headers, body) => {
    if (path === "/v.1.0/clients/authorization" && method === "GET") {
      const key = query.get("apiKey");
      if (key === null || key === "")
        return errors(422, { apiKey: "The api key field is required." });
      state.keysSeen.add(key);
      // Echo the key back, as a careless server might: the spike must still never print it.
      if (key !== behaviour.validKey)
        return errors(422, { errorMessage: `API key expired: ${key}` });
      const jwt = stubJwt(3600);
      state.jwts.add(jwt);
      return [200, { jwt }];
    }
    if (path === "/v.1.0/dictionary/divisions") {
      if (
        query.get("measurementUnits") !== null &&
        !["kg_cm", "g_mm"].includes(query.get("measurementUnits"))
      )
        return errors(422, { measurementUnits: "The selected measurement units is invalid." });
      return [
        302,
        null,
        { location: "https://cdn.example.test/dictionary/divisions/versions.json" },
      ];
    }
    if (path === "/v.1.0/test-api-keys" && method === "POST") {
      return [
        422,
        { errors: { phone: "The phone field is required." } },
        { "x-ratelimit-limit": "10", "x-ratelimit-remaining": "9" },
      ];
    }
    const known = [
      "/v.1.0/divisions",
      "/v.1.0/settlements",
      "/v.1.0/shipments",
      "/v.1.0/shipments/calculations",
      "/v.1.0/shipments/tracking",
      "/v.1.0/shipments/tracking/history",
      "/v.1.0/shipments/print",
      "/v.1.0/clients",
      "/v.1.0/tracking-push/subscribers",
    ];
    if (!known.includes(path) && !path.startsWith("/v.1.0/shipments/")) {
      return errors(404, { errorMessage: `The route ${path.slice(1)} could not be found.` });
    }
    if (!authorized(headers)) return errors(401, { errorMessage: "Invalid token" });
    const rateHeaders = { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "59" };
    const limit = Number(query.get("limit") ?? "15");
    if (query.get("limit") !== null && (limit < 1 || limit > 100))
      return errors(422, { limit: "The limit field must not be greater than 100." });
    switch (path) {
      case "/v.1.0/settlements":
        return [200, page(settlements, query), rateHeaders];
      case "/v.1.0/divisions": {
        let list = divisions;
        const settlementIds = query.getAll("settlementIds[]").map(Number);
        if (settlementIds.length > 0)
          list = list.filter((row) => settlementIds.includes(row.settlement.id));
        const categories = query.getAll("divisionCategories[]");
        if (categories.length > 0)
          list = list.filter((row) => categories.includes(row.divisionCategory));
        const english = headers["accept-language"] === "en";
        const shaped = english
          ? list.map((row) => ({ ...row, name: `Branch No ${row.number}` }))
          : list;
        return [200, page(shaped, query), rateHeaders];
      }
      case "/v.1.0/shipments/calculations":
        if (body?.parcels?.[0]?.actualWeight < 1)
          return errors(422, {
            "parcels.0.actualWeight": "The parcels.0.actualWeight field must be at least 1.",
          });
        return [
          200,
          {
            scheduledDeliveryDate: "2026-10-27T00:00:00.000000Z",
            sender: { countryCode: "UA" },
            recipient: { countryCode: "UA" },
            services: [
              {
                serviceId: randomUUID(),
                cost: 80.5,
                price: 80.5,
                discount: 0,
                payer_type: "Recipient",
              },
            ],
          },
        ];
      case "/v.1.0/clients":
        return [200, { id: 1, name: STUB_SENDER_NAME, phone: STUB_PHONE, companyTins: [] }];
      case "/v.1.0/tracking-push/subscribers":
        return [200, { items: [] }];
      case "/v.1.0/shipments": {
        if (method === "POST") {
          const id = randomUUID();
          const number = `20${String(450_000_000_000 + state.shipments.size)}`;
          const shipment = {
            id,
            number,
            status: "ReadyToShip",
            clientOrder: body.clientOrder,
            createdAt: new Date().toISOString().replace(/\.(\d{3})Z$/, ".$1000Z"),
            deletedAt: null,
            sender: body.sender,
            recipient: body.recipient,
            labelPrinted: false,
          };
          state.shipments.set(id, shipment);
          return [
            201,
            {
              id,
              number,
              scheduledDeliveryDate: "2026-10-27T00:00:00.000000Z",
              status: "ReadyToShip",
              cost: 80.5,
              parcelsAmount: 1,
              createdAt: shipment.createdAt,
              updatedAt: shipment.createdAt,
              deletedAt: null,
            },
          ];
        }
        let list = [...state.shipments.values()].reverse();
        const numbers = query.getAll("numbers[]");
        const ids = query.getAll("ids[]");
        if (numbers.length > 0) list = list.filter((item) => numbers.includes(item.number));
        if (ids.length > 0) list = list.filter((item) => ids.includes(item.id));
        // Rows carry the personal data back, as the real list does; the spike records shapes only.
        return [
          200,
          page(
            list.map((item) => withoutLabelFlag(item)),
            query,
          ),
          rateHeaders,
        ];
      }
      case "/v.1.0/shipments/tracking":
      case "/v.1.0/shipments/tracking/history": {
        if (behaviour.failTracking) return [500, { message: "boom" }];
        const numbers = query.getAll("numbers[]");
        if (numbers.length > 100)
          return errors(422, { numbers: "The numbers field must not have more than 100 items." });
        const found = [...state.shipments.values()].filter((item) => numbers.includes(item.number));
        if (found.length === 0) return errors(404, { errorMessage: "Shipments not found" });
        if (path.endsWith("/history")) {
          return [
            200,
            {
              items: found.map((item) => ({
                id: item.id,
                number: item.number,
                history_tracking: [
                  {
                    code: item.status === "Deleted" ? "2" : "1",
                    code_name: "Ready to send",
                    country_code: "UA",
                    settlement: "Тест",
                    date: item.createdAt,
                  },
                ],
              })),
            },
          ];
        }
        if (behaviour.trackingItems) {
          // The shape production answered (top key `items`), with the status inside each item.
          return [
            200,
            {
              items: found.map((item) => ({
                number: item.number,
                statusCode: item.status === "Deleted" ? "2" : "1",
                statusDate: item.createdAt,
              })),
            },
          ];
        }
        return [
          200,
          {
            currentStatus: found.map((item) => ({
              number: item.number,
              statusCode: item.status === "Deleted" ? "2" : "1",
              status: "Ready to send",
              statusDate: item.createdAt,
            })),
            detailsTracking: [],
            historyOnlineTracking: [],
          },
        ];
      }
      case "/v.1.0/shipments/print": {
        // Like production (2026-10-25): `type[]=marking` is refused, `type` must be a single string.
        if (query.getAll("type[]").length > 0)
          return errors(422, { type: "The type field must be a string." });
        if (query.get("type") !== "marking")
          return errors(422, { type: "The selected type is invalid." });
        if (behaviour.labelRefuses)
          return errors(422, { "numbers.0": "The shipment cannot be printed: 0501234567." });
        const numbers = query.getAll("numbers[]");
        const found = [...state.shipments.values()].find(
          (item) => item.number === numbers[0] && item.status !== "Deleted",
        );
        if (found === undefined) return errors(404, { errorMessage: "shipments not found" });
        found.labelPrinted = true;
        return [
          200,
          Buffer.from("%PDF-1.4\n% stub label\n%%EOF\n", "latin1"),
          { "content-type": "application/pdf" },
        ];
      }
      default: {
        // DELETE /shipments/{id}
        if (method !== "DELETE") return errors(405, { errorMessage: "Method Not Allowed" });
        const id = decodeURIComponent(path.slice("/v.1.0/shipments/".length));
        if (behaviour.failDeletes > state.deleteFailures) {
          state.deleteFailures += 1;
          return [503, { errors: { errorMessage: "timeout error" } }];
        }
        const shipment = state.shipments.get(id);
        if (shipment === undefined) return errors(404, { errorMessage: "shipment_not_found" });
        if (shipment.status === "Deleted")
          return errors(422, { errorMessage: "shipment_was_deleted" });
        shipment.status = "Deleted";
        shipment.deletedAt = new Date().toISOString();
        return [200, { success: true }];
      }
    }
  };

  const server = createServer((request, response) => {
    state.requests += 1;
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://stub.invalid");
      state.lastRequestPaths.push(`${request.method ?? "?"} ${url.pathname}`);
      let body;
      const text = Buffer.concat(chunks).toString("utf8");
      if (text !== "") {
        try {
          body = JSON.parse(text);
        } catch {
          // Like the real gateway, authorization is checked before the body.
          if (!state.jwts.has(String(request.headers.authorization))) {
            response.writeHead(401, { "content-type": "application/json" });
            response.end(JSON.stringify({ errors: { errorMessage: "Invalid token" } }));
            return;
          }
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ errors: { errorMessage: "Invalid JSON format" } }));
          return;
        }
      }
      const [status, payload, extraHeaders] = handle(
        request.method ?? "GET",
        url.pathname,
        url.searchParams,
        request.headers,
        body,
      );
      const headers = { "content-type": "application/json", ...(extraHeaders ?? {}) };
      response.writeHead(status, headers);
      if (payload === null || payload === undefined) response.end();
      else if (Buffer.isBuffer(payload)) response.end(payload);
      else response.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const base = `http://127.0.0.1:${String(address.port)}/v.1.0`;
      resolveServer({
        state,
        targets: {
          sandbox: { base, altBase: base },
          production: { base, altBase: null },
        },
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function withoutLabelFlag(shipment) {
  const row = { ...shipment };
  delete row.labelPrinted;
  return row;
}

async function selfTest(io) {
  const dir = mkdtempSync(join(tmpdir(), "np-v1-spike-selftest-"));
  const key = `selftest-${randomBytes(12).toString("hex")}`;
  const personal = {
    NP_SPIKE_SENDER_NAME: STUB_SENDER_NAME,
    NP_SPIKE_SENDER_PHONE: STUB_PHONE,
    NP_SPIKE_SENDER_EMAIL: "sender.selftest@example.test",
    NP_SPIKE_RECIPIENT_NAME: "Тестоимя Тестопрізвище",
    NP_SPIKE_RECIPIENT_PHONE: "380009998877",
    NP_SPIKE_PAYER_CONTRACT_NUMBER: "SELFTEST-CONTRACT-77",
  };
  const writeFlags = ["--sender-division-id", "4001", "--recipient-division-id", "4002"];
  const forbidden = [key, encodeURIComponent(key), ...Object.values(personal)];
  const results = [];
  const run = async (name, argv, env, behaviour, check, injectFault) => {
    const stub = await startStub({ validKey: key, ...behaviour });
    const lines = [];
    const capture = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
    try {
      const out = join(dir, `${name.replace(/\W+/g, "-")}.json`);
      const code = await main([...argv, "--out", out], env, {
        io: capture,
        targets: stub.targets,
        injectFault,
      });
      let file = "";
      try {
        file = readFileSync(out, "utf8");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const everything = `${lines.join("\n")}\n${file}`;
      for (const secret of [...forbidden, ...stub.state.jwts]) {
        assert.ok(
          !everything.includes(secret),
          `${name}: a secret or personal value reached the output`,
        );
      }
      assert.ok(
        !/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(everything),
        `${name}: a JWT reached the output`,
      );
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
  const status = (file, id) => file.hypotheses.find((item) => item.id === id).status;

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
      { NOVA_POST_API_KEY: key, ...personal },
      {},
      ({ code, lines, stub }) => {
        assert.equal(code, 2);
        assert.equal(
          stub.state.requests,
          0,
          "the write stage may not call anything without --confirm",
        );
        assert.ok(
          lines.some((line) => line.includes("POST /shipments")),
          "the plan is printed",
        );
      },
    );
    await run(
      "write refuses production without --allow-production-write",
      ["--stage", "write", "--env", "production", "--confirm", ...writeFlags],
      { NOVA_POST_API_KEY: key, ...personal },
      {},
      ({ code, lines, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests, 0);
        assert.ok(lines.some((line) => line.includes("--allow-production-write")));
      },
    );
    await run(
      "write refuses with missing inputs",
      ["--stage", "write", "--confirm"],
      { NOVA_POST_API_KEY: key },
      {},
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests, 0);
      },
    );
    await run(
      "unknown flag and bad env are usage errors",
      ["--stage", "readonly", "--api-key", "x"],
      {},
      {},
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests, 0);
      },
    );
    await run("bad --env is a usage error", ["--env", "staging"], {}, {}, ({ code, stub }) => {
      assert.equal(code, 2);
      assert.equal(stub.state.requests, 0);
    });
    await run(
      "keyless sends no key",
      ["--stage", "keyless"],
      { NOVA_POST_API_KEY: key },
      {},
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.ok(!stub.state.keysSeen.has(key), "the keyless stage never sends the real key");
        assert.equal(file.facts.keyless.divisionsNoAuth.httpStatus, 401);
        assert.equal(file.facts.keyless.offlineDivisions.httpStatus, 302);
        assert.equal(status(file, "H06"), "CONFIRMED");
        assert.equal(status(file, "H17"), "CONFIRMED");
      },
    );
    await run(
      "readonly with a key (stub echoes the key, rows carry phones and names)",
      ["--stage", "readonly"],
      { NOVA_POST_API_KEY: key, ...personal },
      {},
      ({ code, file, stub }) => {
        assert.equal(code, 0, "readonly completes");
        assert.ok(stub.state.keysSeen.has(key), "the key was sent to the stub");
        assert.ok(
          file.calls.every((record) => !("url" in record) && !("body" in record)),
          "no URL or body recorded",
        );
        assert.ok(
          file.calls
            .filter((record) => record.keyInQuery)
            .every((record) => record.path.includes("<key>")),
          "the authorization path is recorded with a placeholder",
        );
        assert.equal(stub.state.shipments.size, 0, "readonly creates nothing");
        assert.ok(
          !stub.state.lastRequestPaths.some((path) => path.startsWith("DELETE")),
          "readonly deletes nothing",
        );
        for (const id of ["H03", "H04", "H09", "H12", "H13", "H14", "H15", "H18"]) {
          assert.equal(status(file, id), "CONFIRMED", id);
        }
        const choice = file.facts.readonly.settlementChoice;
        assert.equal(choice.source, "--city-query");
        assert.equal(choice.id, 100_001, "the exact name match with divisions, not the first hit");
        assert.equal(choice.exactNameMatch, true);
        assert.equal(choice.divisionsTotal, 3);
        assert.equal(file.facts.readonly.divisions.itemCount, 3);
        assert.equal(
          file.facts.readonly.printInvented.httpStatus,
          404,
          "the label request passes validation (type=marking)",
        );
      },
    );
    await run(
      "readonly without an exact name match takes the candidate with the most divisions",
      ["--stage", "readonly", "--city-query", "Ніде"],
      { NOVA_POST_API_KEY: key },
      {},
      ({ code, file }) => {
        assert.equal(code, 0);
        const choice = file.facts.readonly.settlementChoice;
        assert.equal(choice.exactMatches, 0);
        assert.equal(choice.probed.length, 2);
        assert.equal(choice.id, 100_001);
        assert.equal(status(file, "H12"), "CONFIRMED");
      },
    );
    await run(
      "readonly with --settlement-id of a settlement without divisions marks H12-H14 NOT TESTED",
      ["--stage", "readonly", "--settlement-id", "100002"],
      { NOVA_POST_API_KEY: key },
      {},
      ({ code, file }) => {
        assert.equal(code, 0);
        assert.deepEqual(file.facts.readonly.settlementChoice, {
          source: "--settlement-id",
          id: 100_002,
          divisionsTotal: 0,
        });
        for (const id of ["H12", "H13", "H14", "H16"]) {
          assert.equal(status(file, id), "NOT TESTED", id);
        }
      },
    );
    await run(
      "a non-numeric --settlement-id is a usage error",
      ["--stage", "readonly", "--settlement-id", "Kyiv"],
      { NOVA_POST_API_KEY: key },
      {},
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests, 0);
      },
    );
    await run(
      "readonly with a rejected key: the echoed key is scrubbed",
      ["--stage", "readonly"],
      { NOVA_POST_API_KEY: key },
      { validKey: `other-${key}` },
      ({ code, file }) => {
        assert.equal(code, 1, "a rejected key stops the stage");
        assert.ok(
          file.facts.readonly.authorization.errorMessages.some((text) => text.includes(REDACTED)),
          "the echo was replaced",
        );
      },
    );
    await run(
      "write creates, finds, tracks, labels, deletes (sandbox)",
      ["--stage", "write", "--confirm", ...writeFlags],
      { NOVA_POST_API_KEY: key, ...personal },
      {},
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.ok(
          [...stub.state.shipments.values()].every((item) => item.status === "Deleted"),
          "every spike shipment is deleted",
        );
        assert.equal(file.cleanup.created, 2);
        assert.deepEqual(file.cleanup.leftovers, []);
        assert.equal(file.facts.write.label.startsWithPdf, true);
        assert.equal(
          file.facts.write.label.attempts.length,
          1,
          "the documented form answers a PDF",
        );
        assert.equal(file.facts.write.label.variant, "type=marking");
        assert.equal(file.facts.write.tracking.statusCodeFoundAt, "currentStatus[0]");
        assert.equal(file.facts.write.repeatCreate.createdAnother, true);
        assert.ok(file.facts.write.reference.startsWith(REFERENCE_PREFIX));
        assert.ok(file.facts.write.referenceLength <= 50);
        for (const id of [
          "H19",
          "H21",
          "H22",
          "H23",
          "H24",
          "H25",
          "H27",
          "H28",
          "H29",
          "H30",
          "H31",
        ]) {
          assert.equal(status(file, id), "CONFIRMED", id);
        }
      },
    );
    await run(
      "write on production with --allow-production-write reaches the production target",
      [
        "--stage",
        "write",
        "--env",
        "production",
        "--allow-production-write",
        "--confirm",
        "--skip-repeat-create",
        ...writeFlags,
      ],
      { NOVA_POST_API_KEY: key, ...personal },
      {},
      ({ code, file }) => {
        assert.equal(code, 0);
        assert.equal(file.environment, "production");
        assert.equal(file.cleanup.created, 1);
        assert.deepEqual(file.cleanup.leftovers, []);
      },
    );
    await run(
      "write retries failed deletes in finally",
      ["--stage", "write", "--confirm", ...writeFlags],
      { NOVA_POST_API_KEY: key, ...personal },
      { failDeletes: 3 },
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.ok([...stub.state.shipments.values()].every((item) => item.status === "Deleted"));
        assert.ok(file.cleanup.retried >= 1);
        assert.deepEqual(file.cleanup.leftovers, []);
      },
    );
    await run(
      "write cleans up after a thrown error",
      ["--stage", "write", "--confirm", ...writeFlags],
      { NOVA_POST_API_KEY: key, ...personal },
      {},
      ({ code, file, stub }) => {
        assert.equal(code, 1, "the stage failure is reported");
        assert.ok(file.failure.includes("injected fault"));
        assert.ok(
          [...stub.state.shipments.values()].every((item) => item.status === "Deleted"),
          "finally deleted both",
        );
        assert.equal(file.cleanup.retried, 2);
        assert.deepEqual(file.cleanup.leftovers, []);
      },
      (label) => label === "GET /shipments/tracking (A)",
    );
    await run(
      "write reports leftovers when cleanup cannot delete",
      ["--stage", "write", "--confirm", "--skip-repeat-create", ...writeFlags],
      { NOVA_POST_API_KEY: key, ...personal },
      {},
      ({ code, file, stub, lines }) => {
        assert.equal(code, 3);
        assert.equal(
          [...stub.state.shipments.values()].filter((item) => item.status !== "Deleted").length,
          1,
        );
        assert.equal(file.cleanup.leftovers.length, 1);
        assert.ok(lines.some((line) => line.startsWith("CLEANUP INCOMPLETE")));
      },
      (label) =>
        label.startsWith("DELETE /shipments/<A id>") || label === "cleanup DELETE /shipments/<id>",
    );
    await run(
      "write records a refused label (error keys, scrubbed text) and still cleans up",
      ["--stage", "write", "--confirm", ...writeFlags],
      { NOVA_POST_API_KEY: key, ...personal },
      { labelRefuses: true },
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.ok([...stub.state.shipments.values()].every((item) => item.status === "Deleted"));
        assert.deepEqual(file.cleanup.leftovers, []);
        const label = file.facts.write.label;
        assert.deepEqual(
          label.attempts.map((item) => item.variant),
          ["type=marking", "type=marking&format=pdf"],
        );
        assert.equal(label.httpStatus, 422);
        assert.deepEqual(label.errorKeys, ["numbers.0"]);
        assert.ok(
          label.errorMessages[0].includes("[digits]") &&
            !label.errorMessages[0].includes("0501234567"),
          "the error text is kept, digit runs are scrubbed",
        );
        assert.equal(status(file, "H27"), "DIFFERENT");
        assert.equal(status(file, "H30"), "NOT TESTED");
      },
    );
    await run(
      "write reads the tracking status from items[] (the shape production answered)",
      ["--stage", "write", "--confirm", "--skip-repeat-create", ...writeFlags],
      { NOVA_POST_API_KEY: key, ...personal },
      { trackingItems: true },
      ({ code, file }) => {
        assert.equal(code, 0);
        assert.equal(file.facts.write.tracking.statusCodeFoundAt, "items[0]");
        assert.deepEqual(file.facts.write.tracking.topKeys, ["items"]);
        assert.equal(status(file, "H25"), "CONFIRMED");
      },
    );
    await run(
      "write cleans up when tracking answers 500",
      ["--stage", "write", "--confirm", ...writeFlags],
      { NOVA_POST_API_KEY: key, ...personal },
      { failTracking: true },
      ({ code, file, stub }) => {
        assert.ok([...stub.state.shipments.values()].every((item) => item.status === "Deleted"));
        assert.deepEqual(file.cleanup.leftovers, []);
        assert.equal(code, 0, "a tracking failure is recorded, the run still completes");
        assert.equal(file.facts.write.tracking.httpStatus, 500);
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
      const secrets = collectSecrets(process.env.NOVA_POST_API_KEY, {});
      console.error(`unexpected error: ${scrubMessage(errorText(error), secrets)}`);
      process.exitCode = 1;
    },
  );
}
