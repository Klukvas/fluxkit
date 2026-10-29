// Monobank acquiring verification spike (payments plan check S1; ADR 0032 decision 15). Plain Node 22 ESM, built-in fetch
// only, no dependencies, not part of any package build. How to run it, what it calls and how to read the findings:
// scripts/spikes/README.md. It checks the documented Monobank facts the plugin packages/providers/monobank codes against
// (plan docs/plans/2026-10-26-payments-monobank.md, section "Monobank acquiring facts", M1 to M25) with the owner's TEST
// token (https://api.monobank.ua/; a test token takes no real money, M2).
//
// Stages (--stage):
//   readonly  (default) Needs MONOBANK_TOKEN. Changes nothing: GET /api/merchant/pubkey (key type and curve, M12),
//             GET /api/merchant/details (member names only, M22), the status of an invoice id that does not exist (the
//             404 error shape, M16), the status read without an id (the 400 shape) and one call with an invented token
//             (the 403 shape). Runs without --confirm.
//   invoice   Needs MONOBANK_TOKEN and --confirm. Runs readonly first, then creates TINY test invoices nobody pays and
//             removes each one: (1) 1.00 UAH with the plugin's exact body shape, its status, (2) the same reference again
//             (M5: a second invoice?), (3) validity 10 s (M19: the minimum), (4) ccy 840 (M18), (5) a refund of the unpaid
//             invoice (M13: CANCEL_NOT_AVAILABLE), (6) remove each created invoice, its status after (M14), remove again.
//   pay       Needs MONOBANK_TOKEN and --confirm; MONOBANK_SPIKE_WEBHOOK_URL optional (a public https URL that reaches a
//             running API's webhook route; Monobank posts the status changes there, M8). Runs readonly first, then
//             creates ONE 2.00 UAH test invoice, prints its payment page for the owner to pay with a Luhn-valid TEST card
//             (M2), polls its status every 5 s for at most 10 minutes, and once it is paid makes refunds: 0.50 UAH with
//             extRef A, the same extRef A and amount again (M13: deduplicated?), 0.50 UAH with extRef B (several partial
//             refunds), the rest with extRef C (a full refund with an explicit amount; reversed?), reading the status
//             after each; finally removes the paid invoice (M14 on a paid one).
//   webhook   Needs MONOBANK_TOKEN, MONOBANK_SPIKE_WEBHOOK_BODY_FILE (the raw body of one webhook the staging API
//             received, saved byte for byte) and MONOBANK_SPIKE_WEBHOOK_SIGN (its X-Sign header). Verifies it with the live
//             key of GET /api/merchant/pubkey (M12 live). Changes nothing.
//   --self-test  Runs every stage against a local stub of Monobank on 127.0.0.1 and asserts the gating and the redaction.
//
// Inputs (environment only; never on the command line, so nothing lands in the shell history):
//   MONOBANK_TOKEN                   the TEST token. Never printed or written; scrubbed from every output with its
//                                    fragments.
//   MONOBANK_SPIKE_WEBHOOK_URL       optional (pay): webHookUrl of the test invoice.
//   MONOBANK_SPIKE_WEBHOOK_BODY_FILE, MONOBANK_SPIKE_WEBHOOK_SIGN  (webhook stage).
//   --out <path>                     findings JSON (default ./monobank-findings.json, git-ignored, mode 600).
//
// Never recorded: the token, errText (its length only), failureReason, maskedPan (whether it is present only), rrn,
// approvalCode, merchantName, merchantId, edrpou, the payment page path (its host only).
//
// Exit codes: 0 done; 1 a call failed or the stage could not finish (findings still written); 2 usage error or refusal,
// nothing sent.
//
// Behind an HTTPS proxy, Node's fetch may need NODE_USE_ENV_PROXY=1 (Node >= 22.21).

import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

const SPIKE_VERSION = 1;
// A constant, never configurable from a flag or the environment (no SSRF). Only the self-test passes its stub.
const MONOBANK_ORIGIN = "https://api.monobank.ua";
const MAX_BODY_BYTES = 64 * 1024;
const CALL_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_LIMIT_MS = 10 * 60_000;
const REDACTED = "[REDACTED]";
const DEFAULT_OUT = "monobank-findings.json";
const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const RATE_HEADER = /(rate|limit|retry)/i;
// The errCode values the OpenAPI spec documents (the plugin's MONOBANK_ERROR_CODES); anything else is "[undocumented]".
const DOCUMENTED_ERROR_CODES = new Set([
  "BAD_REQUEST",
  "1001",
  "INVALID_MERCHANT_PAYM_INFO",
  "ORDER_IN_PROGRESS",
  "HOLD_INVOICE_NOT_FINALIZED",
  "WRONG_CANCEL_AMOUNT",
  "TOKEN_NOT_FOUND",
  "FORBIDDEN",
  "NOT_FOUND",
  "1004",
  "METHOD_NOT_ALLOWED",
  "TMR",
  "INTERNAL_ERROR",
  "CANCEL_NOT_AVAILABLE",
]);

class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// Arguments and inputs

function parseArgs(argv) {
  const options = {
    stage: "readonly",
    out: DEFAULT_OUT,
    confirm: false,
    selfTest: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--confirm") options.confirm = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--stage" || arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      index += 1;
    } else throw new UsageError(`Unexpected argument: ${arg}`);
  }
  if (!["readonly", "invoice", "pay", "webhook"].includes(options.stage))
    throw new UsageError("--stage must be readonly, invoice, pay or webhook");
  return options;
}

const nonEmpty = (value) => typeof value === "string" && value.trim() !== "";

function collectSecrets(env) {
  const secrets = [];
  const token = env.MONOBANK_TOKEN;
  if (nonEmpty(token)) {
    const trimmed = token.trim();
    secrets.push(trimmed, encodeURIComponent(trimmed));
    // Every 8-character fragment, so a partial echo is scrubbed too.
    for (let start = 0; start + 8 <= trimmed.length; start += 1)
      secrets.push(trimmed.slice(start, start + 8));
  }
  return [...new Set(secrets)]
    .filter((secret) => secret.length >= 8)
    .sort((a, b) => b.length - a.length);
}

function scrub(text, secrets) {
  let result = String(text);
  for (const secret of secrets) result = result.split(secret).join(REDACTED);
  // A card mask in any spelling (6 digits, stars, 4 digits).
  return result.replace(/\b\d{6}\*{2,}\d{4}\b/g, "[card]");
}

// ---------------------------------------------------------------------------------------------------------------------
// HTTP

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
      throw new Error(`answer larger than ${String(MAX_BODY_BYTES)} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The error code when it is a documented one, else a marker; never errText (its length only). */
function describeError(json) {
  const facts = {};
  if (json !== null && typeof json === "object" && !Array.isArray(json)) {
    if ("errCode" in json) {
      const code = String(json.errCode);
      facts.errCode = DOCUMENTED_ERROR_CODES.has(code) ? code : "[undocumented]";
    }
    if (typeof json.errText === "string") facts.errTextLength = json.errText.length;
  }
  return facts;
}

/**
 * One call. Records structural facts only: status, latency, content type, header names, rate-like headers, the answer's
 * member names and, for errors, the documented errCode. Never the token, a body value or a text.
 */
async function call(ctx, label, { method, path, invoiceId, body, token }) {
  const url = new URL(path, ctx.origin);
  if (invoiceId !== undefined)
    url.search = new globalThis.URLSearchParams({ invoiceId }).toString();
  const headers = { accept: "application/json" };
  const sentToken = token === undefined ? ctx.token : token;
  if (sentToken !== null) headers["x-token"] = sentToken;
  if (body !== undefined) headers["content-type"] = "application/json";
  const record = {
    label,
    method,
    path,
    tokenSent: sentToken === null ? "none" : sentToken === ctx.token ? "token" : "invented",
  };
  ctx.calls.push(record);
  const started = performance.now();
  let response;
  let bytes;
  try {
    response = await ctx.fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    bytes = await readCapped(response);
  } catch (error) {
    record.transportError = scrub(error instanceof Error ? error.name : "error", ctx.secrets);
    return { status: null, json: undefined, record };
  }
  record.latencyMs = Math.round(performance.now() - started);
  record.httpStatus = response.status;
  record.contentType = response.headers.get("content-type");
  record.headerNames = [...response.headers.keys()].sort();
  record.rateHeaders = {};
  for (const name of record.headerNames) {
    if (RATE_HEADER.test(name)) {
      const value = response.headers.get(name) ?? "";
      record.rateHeaders[name] = /^[\d., =;a-z-]{0,80}$/i.test(value) ? value : "[not numeric]";
    }
  }
  record.bodyBytes = bytes.byteLength;
  let json;
  try {
    json = bytes.byteLength === 0 ? undefined : JSON.parse(bytes.toString("utf8"));
  } catch {
    json = undefined;
    record.notJson = true;
  }
  if (json !== null && typeof json === "object" && !Array.isArray(json))
    record.keys = Object.keys(json).sort();
  if (response.status >= 400) Object.assign(record, describeError(json));
  if (response.status === 429) ctx.facts.saw429 = true;
  return { status: response.status, json, record };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shapes (structural only)

function keyFacts(json) {
  if (json === null || typeof json !== "object" || typeof json.key !== "string")
    return { readable: false };
  try {
    const pem = Buffer.from(json.key, "base64").toString("utf8");
    const key = createPublicKey(pem);
    return {
      readable: true,
      type: key.asymmetricKeyType,
      curve: key.asymmetricKeyDetails?.namedCurve ?? null,
      // A public key is not a secret; a short fingerprint lets two runs tell whether it rotated.
      fingerprint: createHash("sha256")
        .update(key.export({ type: "spki", format: "der" }))
        .digest("hex")
        .slice(0, 16),
    };
  } catch {
    return { readable: false };
  }
}

function statusFacts(json) {
  if (json === null || typeof json !== "object") return null;
  const cancelList = Array.isArray(json.cancelList) ? json.cancelList : [];
  const info =
    json.paymentInfo !== null && typeof json.paymentInfo === "object" ? json.paymentInfo : null;
  return {
    keys: Object.keys(json).sort(),
    status:
      typeof json.status === "string" && SAFE_CODE.test(json.status) ? json.status : "[not a code]",
    amount: Number.isSafeInteger(json.amount) ? json.amount : null,
    ccy: Number.isSafeInteger(json.ccy) ? json.ccy : null,
    finalAmount: Number.isSafeInteger(json.finalAmount) ? json.finalAmount : null,
    hasModifiedDate: typeof json.modifiedDate === "string",
    modifiedDateShape:
      typeof json.modifiedDate === "string" ? json.modifiedDate.replace(/\d/g, "9") : null,
    referenceEchoed: typeof json.reference === "string",
    errCode:
      json.errCode === undefined
        ? null
        : SAFE_CODE.test(String(json.errCode))
          ? String(json.errCode)
          : "[not a code]",
    hasFailureReason: typeof json.failureReason === "string",
    cancelList: cancelList.map((entry) => ({
      keys: entry !== null && typeof entry === "object" ? Object.keys(entry).sort() : [],
      status:
        typeof entry?.status === "string" && SAFE_CODE.test(entry.status)
          ? entry.status
          : "[not a code]",
      amount: Number.isSafeInteger(entry?.amount) ? entry.amount : null,
      extRef:
        typeof entry?.extRef === "string"
          ? entry.extRef.startsWith("fluxkit-s1-")
            ? entry.extRef
            : "[other]"
          : null,
    })),
    paymentInfo:
      info === null
        ? null
        : {
            keys: Object.keys(info).sort(),
            paymentSystem:
              typeof info.paymentSystem === "string" && SAFE_CODE.test(info.paymentSystem)
                ? info.paymentSystem
                : null,
            paymentMethod:
              typeof info.paymentMethod === "string" && SAFE_CODE.test(info.paymentMethod)
                ? info.paymentMethod
                : null,
            maskedPanPresent: typeof info.maskedPan === "string",
            maskedPanEndsWith4Digits:
              typeof info.maskedPan === "string" && /\d{4}$/.test(info.maskedPan),
          },
  };
}

function createFacts(json) {
  if (json === null || typeof json !== "object") return null;
  let host;
  try {
    const url = new URL(json.pageUrl);
    host = `${url.protocol}//${url.host}`;
  } catch {
    host = typeof json.pageUrl === "string" ? "[not a URL]" : null;
  }
  return {
    keys: Object.keys(json).sort(),
    invoiceIdShape:
      typeof json.invoiceId === "string"
        ? json.invoiceId.replace(/[A-Za-z]/g, "a").replace(/\d/g, "9")
        : null,
    invoiceIdMatchesPluginPattern:
      typeof json.invoiceId === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(json.invoiceId),
    pageOrigin: host,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stages

const STATUS_PATH = "/api/merchant/invoice/status";

async function stageReadonly(ctx) {
  const facts = {};
  const pubkey = await call(ctx, "readonly: pubkey", {
    method: "GET",
    path: "/api/merchant/pubkey",
  });
  facts.pubkey = { ...pubkey.record, key: keyFacts(pubkey.json) };
  const details = await call(ctx, "readonly: merchant details", {
    method: "GET",
    path: "/api/merchant/details",
  });
  facts.details = details.record; // member names only: merchantName, merchantId and edrpou are never recorded
  const unknownId = `fluxkitS1${randomBytes(6).toString("hex")}`;
  facts.unknownInvoice = (
    await call(ctx, "readonly: status of an invoice that does not exist", {
      method: "GET",
      path: STATUS_PATH,
      invoiceId: unknownId,
    })
  ).record;
  facts.missingId = (
    await call(ctx, "readonly: status without invoiceId", { method: "GET", path: STATUS_PATH })
  ).record;
  const invented = `fluxkitS1Invented${randomBytes(12).toString("hex")}`;
  ctx.secrets.push(invented);
  facts.inventedToken = (
    await call(ctx, "readonly: pubkey with an invented token", {
      method: "GET",
      path: "/api/merchant/pubkey",
      token: invented,
    })
  ).record;
  ctx.facts.readonly = facts;
  return pubkey;
}

function createBody(ctx, overrides = {}) {
  return {
    amount: 100,
    ccy: 980,
    merchantPaymInfo: {
      reference: ctx.reference,
      destination: "Fluxkit S1 check, not an order",
      basketOrder: [{ name: "Fluxkit S1 check", qty: 1, sum: 100, total: 100, code: "fluxkit-s1" }],
    },
    redirectUrl: "https://example.com/fluxkit-s1-return",
    validity: 600,
    paymentType: "debit",
    ...overrides,
  };
}

async function readStatus(ctx, label, invoiceId) {
  const answer = await call(ctx, label, { method: "GET", path: STATUS_PATH, invoiceId });
  return { record: answer.record, facts: answer.status === 200 ? statusFacts(answer.json) : null };
}

async function stageInvoice(ctx) {
  const facts = { created: [] };
  const created = [];
  const create = async (label, body) => {
    const answer = await call(ctx, label, {
      method: "POST",
      path: "/api/merchant/invoice/create",
      body,
    });
    const entry = {
      label,
      record: answer.record,
      answer: answer.status === 200 ? createFacts(answer.json) : null,
    };
    facts.created.push(entry);
    if (answer.status === 200 && typeof answer.json?.invoiceId === "string")
      created.push(answer.json.invoiceId);
    return answer;
  };
  try {
    const first = await create("invoice: 1.00 UAH, plugin body shape", createBody(ctx));
    const firstId = typeof first.json?.invoiceId === "string" ? first.json.invoiceId : undefined;
    if (firstId !== undefined)
      facts.firstStatus = await readStatus(ctx, "invoice: status of the new invoice", firstId);
    const second = await create("invoice: the same reference again (M5)", createBody(ctx));
    facts.sameReferenceNewInvoice =
      typeof second.json?.invoiceId === "string" && firstId !== undefined
        ? second.json.invoiceId !== firstId
        : null;
    await create("invoice: validity 10 s (M19)", createBody(ctx, { validity: 10 }));
    await create("invoice: ccy 840 (M18)", createBody(ctx, { ccy: 840 }));
    if (firstId !== undefined) {
      facts.refundUnpaid = (
        await call(ctx, "invoice: refund of the unpaid invoice (M13)", {
          method: "POST",
          path: "/api/merchant/invoice/cancel",
          body: { invoiceId: firstId, extRef: "fluxkit-s1-unpaid", amount: 100 },
        })
      ).record;
    }
  } finally {
    // Every created invoice is removed, whatever happened above.
    facts.removed = [];
    for (const invoiceId of created) {
      const removed = await call(ctx, "invoice: remove", {
        method: "POST",
        path: "/api/merchant/invoice/remove",
        body: { invoiceId },
      });
      const after = await readStatus(ctx, "invoice: status after remove", invoiceId);
      const again = await call(ctx, "invoice: remove again", {
        method: "POST",
        path: "/api/merchant/invoice/remove",
        body: { invoiceId },
      });
      facts.removed.push({
        remove: removed.record,
        statusAfter: after.facts?.status ?? null,
        removeAgain: again.record,
      });
    }
  }
  ctx.facts.invoice = facts;
}

const sleep = (ms) => new Promise((resolveSleep) => globalThis.setTimeout(resolveSleep, ms));

async function stagePay(ctx, io) {
  const facts = { statuses: [], refunds: [] };
  ctx.facts.pay = facts;
  const body = createBody(ctx, {
    amount: 200,
    validity: 900,
    merchantPaymInfo: {
      reference: ctx.reference,
      destination: "Fluxkit S1 test payment, refunded",
      basketOrder: [{ name: "Fluxkit S1 check", qty: 1, sum: 200, total: 200, code: "fluxkit-s1" }],
    },
    ...(ctx.webhookUrl === undefined ? {} : { webHookUrl: ctx.webhookUrl }),
  });
  const created = await call(ctx, "pay: create 2.00 UAH", {
    method: "POST",
    path: "/api/merchant/invoice/create",
    body,
  });
  facts.create = {
    record: created.record,
    answer: created.status === 200 ? createFacts(created.json) : null,
  };
  facts.webhookUrlSent = ctx.webhookUrl !== undefined;
  const invoiceId =
    typeof created.json?.invoiceId === "string" ? created.json.invoiceId : undefined;
  if (invoiceId === undefined || typeof created.json?.pageUrl !== "string")
    throw new Error("create failed");
  // The page URL goes to the terminal only (the owner opens it); the findings keep its origin.
  io.out(
    `Open this TEST payment page and pay with a Luhn-valid test card (no real money with a test token, M2):`,
  );
  io.out(`  ${created.json.pageUrl}`);
  io.out(
    `Polling the status every ${String(ctx.pollMs / 1000)} s for at most ${String(ctx.pollLimitMs / 60000)} minutes...`,
  );
  const started = Date.now();
  let last;
  for (;;) {
    const read = await readStatus(ctx, "pay: poll status", invoiceId);
    const status = read.facts?.status ?? null;
    if (status !== last) {
      facts.statuses.push({
        afterMs: Date.now() - started,
        status,
        modifiedDateShape: read.facts?.modifiedDateShape ?? null,
      });
      io.out(`  status: ${String(status)}`);
      last = status;
    }
    if (status === "success" || status === "failure" || status === "expired") {
      facts.finalStatus = read.facts;
      break;
    }
    if (Date.now() - started > ctx.pollLimitMs) {
      facts.timedOut = true;
      break;
    }
    await sleep(ctx.pollMs);
  }
  if (facts.finalStatus?.status === "success") {
    const refund = async (label, extRef, amount) => {
      const answer = await call(ctx, label, {
        method: "POST",
        path: "/api/merchant/invoice/cancel",
        body: { invoiceId, extRef, amount },
      });
      const after = await readStatus(ctx, `${label}: status after`, invoiceId);
      facts.refunds.push({
        label,
        extRef,
        amount,
        record: answer.record,
        answerStatus:
          typeof answer.json?.status === "string" && SAFE_CODE.test(answer.json.status)
            ? answer.json.status
            : null,
        after: after.facts,
      });
    };
    await refund("pay: partial refund 0.50 UAH, extRef A", "fluxkit-s1-a", 50);
    await refund("pay: the same extRef A and amount again (M13 dedupe?)", "fluxkit-s1-a", 50);
    await refund("pay: second partial refund 0.50 UAH, extRef B", "fluxkit-s1-b", 50);
    const remaining = facts.refunds.at(-1)?.after?.finalAmount;
    if (Number.isSafeInteger(remaining) && remaining > 0) {
      await refund("pay: the rest with an explicit amount, extRef C", "fluxkit-s1-c", remaining);
    }
  } else {
    io.err("the invoice was not paid; no refund was made");
  }
  facts.removePaid = (
    await call(ctx, "pay: remove the invoice (M14 on a paid one)", {
      method: "POST",
      path: "/api/merchant/invoice/remove",
      body: { invoiceId },
    })
  ).record;
  const final = await readStatus(ctx, "pay: final status", invoiceId);
  facts.final = final.facts;
}

async function stageWebhook(ctx, env) {
  const facts = {};
  ctx.facts.webhook = facts;
  const pubkey = await call(ctx, "webhook: pubkey", {
    method: "GET",
    path: "/api/merchant/pubkey",
  });
  facts.key = keyFacts(pubkey.json);
  const raw = readFileSync(env.MONOBANK_SPIKE_WEBHOOK_BODY_FILE);
  facts.bodyBytes = raw.byteLength;
  facts.bodySha256 = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  try {
    const key = createPublicKey(Buffer.from(pubkey.json.key, "base64").toString("utf8"));
    const signature = Buffer.from(env.MONOBANK_SPIKE_WEBHOOK_SIGN.trim(), "base64");
    facts.verifies = verify("sha256", raw, { key, dsaEncoding: "der" }, signature);
    const changed = Buffer.from(raw);
    changed[changed.length - 1] ^= 0x01;
    facts.changedByteVerifies = verify("sha256", changed, { key, dsaEncoding: "der" }, signature);
  } catch (error) {
    facts.error = error instanceof Error ? error.name : "error";
  }
  try {
    facts.body = statusFacts(JSON.parse(raw.toString("utf8")));
  } catch {
    facts.body = null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Hypotheses (plan section "Monobank acquiring facts")

const NOT_TESTED = (why) => ({ status: "NOT TESTED", fact: why });
const verdict = (ok, fact) => ({ status: ok ? "CONFIRMED" : "DIFFERENT", fact });
const recorded = (fact) => ({ status: "RECORDED", fact });
const said = (record) =>
  record === undefined
    ? "-"
    : `${String(record.httpStatus ?? record.transportError)}${record.errCode === undefined ? "" : ` ${record.errCode}`}`;

const HYPOTHESES = [
  [
    "M1",
    "X-Token authenticates every call; an invented token is 403 FORBIDDEN",
    (f) =>
      f.readonly === undefined
        ? NOT_TESTED("readonly not run")
        : verdict(
            f.readonly.pubkey.httpStatus === 200 && f.readonly.inventedToken.httpStatus === 403,
            `token: ${said(f.readonly.pubkey)}; invented: ${said(f.readonly.inventedToken)}`,
          ),
  ],
  [
    "M2",
    "A test token answers pubkey and details (open question 11)",
    (f) =>
      f.readonly === undefined
        ? NOT_TESTED("readonly not run")
        : recorded(
            `pubkey: ${said(f.readonly.pubkey)}; details: ${said(f.readonly.details)}, keys ${JSON.stringify(f.readonly.details.keys ?? null)}`,
          ),
  ],
  [
    "M4",
    "Create answers {invoiceId, pageUrl}",
    (f) => {
      const first = f.invoice?.created[0] ?? f.pay?.create;
      return first === undefined
        ? NOT_TESTED("no create")
        : verdict(
            first.record.httpStatus === 200 &&
              JSON.stringify(first.answer?.keys ?? []).includes("pageUrl") &&
              first.answer?.invoiceIdMatchesPluginPattern === true,
            `${said(first.record)} keys ${JSON.stringify(first.answer?.keys ?? null)}, id shape ${String(first.answer?.invoiceIdShape)}`,
          );
    },
  ],
  [
    "M5",
    "No dedupe by reference: the same reference makes a second invoice",
    (f) =>
      f.invoice === undefined
        ? NOT_TESTED("invoice stage not run")
        : verdict(
            f.invoice.sameReferenceNewInvoice === true,
            `second invoice: ${String(f.invoice.sameReferenceNewInvoice)}`,
          ),
  ],
  [
    "M6",
    "Status answers invoiceId, status, amount, ccy, modifiedDate, reference (and cancelList, paymentInfo when paid)",
    (f) => {
      const status = f.invoice?.firstStatus?.facts ?? f.pay?.final;
      return status === undefined || status === null
        ? NOT_TESTED("no status read")
        : verdict(
            ["invoiceId", "status", "amount", "ccy"].every((key) => status.keys.includes(key)) &&
              status.hasModifiedDate &&
              status.referenceEchoed,
            `keys ${JSON.stringify(status.keys)}, modifiedDate ${String(status.modifiedDateShape)}`,
          );
    },
  ],
  [
    "M8",
    "A webhook arrives at webHookUrl on each status change but expired, with X-Sign (whether `created` is sent too)",
    (f) =>
      f.pay?.webhookUrlSent === true
        ? {
            status: "MANUAL",
            fact: "read the staging API log for POST /webhooks/payments/monobank (statuses, count, order); save one raw body and X-Sign and run --stage webhook",
          }
        : NOT_TESTED("pay stage not run with MONOBANK_SPIKE_WEBHOOK_URL"),
  ],
  [
    "M10",
    "Statuses seen by polling (ordering of webhooks is checked in the staging log)",
    (f) =>
      f.pay === undefined
        ? NOT_TESTED("pay stage not run")
        : recorded(JSON.stringify(f.pay.statuses.map((entry) => entry.status))),
  ],
  [
    "M12",
    "The pubkey is EC P-256; a live webhook's X-Sign verifies over its raw body",
    (f) => {
      if (f.webhook !== undefined)
        return verdict(
          f.webhook.verifies === true &&
            f.webhook.changedByteVerifies === false &&
            f.webhook.key.curve === "prime256v1",
          `live verify ${String(f.webhook.verifies)}, changed byte ${String(f.webhook.changedByteVerifies)}, curve ${String(f.webhook.key.curve)}`,
        );
      return f.readonly === undefined
        ? NOT_TESTED("readonly not run")
        : {
            status: f.readonly.pubkey.key.curve === "prime256v1" ? "PARTLY CONFIRMED" : "DIFFERENT",
            fact: `key ${JSON.stringify(f.readonly.pubkey.key)} (run --stage webhook for the live signature)`,
          };
    },
  ],
  [
    "M13a",
    "Refund of an unpaid invoice is 500 CANCEL_NOT_AVAILABLE",
    (f) =>
      f.invoice?.refundUnpaid === undefined
        ? NOT_TESTED("invoice stage not run")
        : verdict(
            f.invoice.refundUnpaid.httpStatus === 500 &&
              f.invoice.refundUnpaid.errCode === "CANCEL_NOT_AVAILABLE",
            said(f.invoice.refundUnpaid),
          ),
  ],
  [
    "M13b",
    "A partial refund is listed in cancelList under our extRef; status and finalAmount after it",
    (f) => {
      const first = f.pay?.refunds[0];
      return first === undefined
        ? NOT_TESTED("no refund made")
        : recorded(
            `answer ${said(first.record)} ${String(first.answerStatus)}; after: status ${String(first.after?.status)}, finalAmount ${String(first.after?.finalAmount)}, cancelList ${JSON.stringify(first.after?.cancelList ?? null)}`,
          );
    },
  ],
  [
    "M13c",
    "The same extRef and amount again: deduplicated (no second refund) or a second refund",
    (f) => {
      const repeat = f.pay?.refunds[1];
      return repeat === undefined
        ? NOT_TESTED("no repeated refund")
        : recorded(
            `answer ${said(repeat.record)} ${String(repeat.answerStatus)}; cancelList entries with extRef A: ${String(repeat.after?.cancelList.filter((entry) => entry.extRef === "fluxkit-s1-a").length)}`,
          );
    },
  ],
  [
    "M13d",
    "Several partial refunds and a full refund with an explicit amount; status after the last (reversed?)",
    (f) => {
      const last = f.pay?.refunds.at(-1);
      return last === undefined || f.pay.refunds.length < 3
        ? NOT_TESTED("not enough refunds")
        : recorded(
            `refunds: ${f.pay.refunds.map((entry) => `${entry.extRef} ${said(entry.record)}`).join("; ")}; final status ${String(last.after?.status)}, finalAmount ${String(last.after?.finalAmount)}`,
          );
    },
  ],
  [
    "M14",
    "remove invalidates an unpaid invoice (status after it), a repeat and a paid invoice answer what?",
    (f) =>
      f.invoice === undefined && f.pay === undefined
        ? NOT_TESTED("no invoice stage")
        : recorded(
            `unpaid: ${JSON.stringify((f.invoice?.removed ?? []).map((entry) => [said(entry.remove), entry.statusAfter, said(entry.removeAgain)]))}; paid: ${said(f.pay?.removePaid)}`,
          ),
  ],
  [
    "M16",
    "Errors are {errCode, errText} with documented codes: unknown invoice 404 NOT_FOUND, missing id 400",
    (f) =>
      f.readonly === undefined
        ? NOT_TESTED("readonly not run")
        : verdict(
            f.readonly.unknownInvoice.httpStatus === 404 &&
              ["NOT_FOUND", "1004"].includes(f.readonly.unknownInvoice.errCode) &&
              JSON.stringify(f.readonly.unknownInvoice.keys) ===
                JSON.stringify(["errCode", "errText"]),
            `unknown: ${said(f.readonly.unknownInvoice)} keys ${JSON.stringify(f.readonly.unknownInvoice.keys ?? null)}; missing id: ${said(f.readonly.missingId)}`,
          ),
  ],
  [
    "M17",
    "Rate limits: a 429 and rate headers",
    (f) =>
      recorded(
        `429 seen: ${String(f.saw429 === true)}; rate headers of the pubkey answer: ${JSON.stringify(f.readonly?.pubkey.rateHeaders ?? null)}`,
      ),
  ],
  [
    "M18",
    "An invoice in ccy 840",
    (f) => {
      const usd = f.invoice?.created.find((entry) => entry.label.includes("ccy 840"));
      return usd === undefined ? NOT_TESTED("invoice stage not run") : recorded(said(usd.record));
    },
  ],
  [
    "M19",
    "The minimum validity (10 s accepted?)",
    (f) => {
      const short = f.invoice?.created.find((entry) => entry.label.includes("validity 10"));
      return short === undefined
        ? NOT_TESTED("invoice stage not run")
        : recorded(said(short.record));
    },
  ],
  [
    "M22",
    "details answers {merchantId, merchantName, edrpou}",
    (f) =>
      f.readonly === undefined
        ? NOT_TESTED("readonly not run")
        : verdict(
            JSON.stringify(f.readonly.details.keys ?? []) ===
              JSON.stringify(["edrpou", "merchantId", "merchantName"]),
            `${said(f.readonly.details)} keys ${JSON.stringify(f.readonly.details.keys ?? null)}`,
          ),
  ],
  [
    "M23",
    "pageUrl is https://pay.mbnk.biz/... (the plugin's allow-list)",
    (f) => {
      const origins = [
        ...(f.invoice?.created ?? []),
        ...(f.pay?.create === undefined ? [] : [f.pay.create]),
      ]
        .map((entry) => entry.answer?.pageOrigin)
        .filter((origin) => origin !== undefined && origin !== null);
      return origins.length === 0
        ? NOT_TESTED("no create answered")
        : verdict(
            origins.every((origin) => origin === "https://pay.mbnk.biz"),
            JSON.stringify([...new Set(origins)]),
          );
    },
  ],
];

function evaluate(facts) {
  return HYPOTHESES.map(([id, claim, check]) => {
    try {
      return { id, claim, ...check(facts) };
    } catch (error) {
      return {
        id,
        claim,
        status: "NOT TESTED",
        fact: `evaluation failed: ${error instanceof Error ? error.name : "error"}`,
      };
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Main

function plan(stage) {
  const steps = [
    "GET /api/merchant/pubkey (no change)",
    "GET /api/merchant/details (no change; member names only are recorded)",
    "GET /api/merchant/invoice/status of an invented invoice id and without an id (no change)",
    "GET /api/merchant/pubkey with an INVENTED token (no change)",
  ];
  if (stage === "invoice") {
    steps.push(
      "POST invoice/create: 1.00 UAH test invoice (nobody pays it), then its status",
      "POST invoice/create: the same reference again (a second unpaid test invoice?)",
      "POST invoice/create: validity 10 s; then ccy 840",
      "POST invoice/cancel on the unpaid invoice (expected refusal)",
      "POST invoice/remove of EVERY created invoice, its status after, remove again",
    );
  }
  if (stage === "pay") {
    steps.push(
      "POST invoice/create: ONE 2.00 UAH test invoice (webHookUrl = MONOBANK_SPIKE_WEBHOOK_URL when set)",
      "print its payment page: YOU pay it with a Luhn-valid TEST card; the status is polled for 10 minutes",
      "when paid: refund 0.50 UAH (extRef A), the same again, 0.50 UAH (extRef B), the rest (extRef C), status after each",
      "POST invoice/remove of the paid invoice, final status",
    );
  }
  if (stage === "webhook") {
    steps.splice(1);
    steps.push(
      "verify MONOBANK_SPIKE_WEBHOOK_SIGN over the bytes of MONOBANK_SPIKE_WEBHOOK_BODY_FILE with that key (no call)",
    );
  }
  return steps;
}

function usage(io) {
  io.out(
    "Usage: node scripts/spikes/monobank-verify.mjs [--stage readonly|invoice|pay|webhook] [--confirm] [--out <path>]",
  );
  io.out("       node scripts/spikes/monobank-verify.mjs --self-test");
  io.out(
    "Inputs come from the environment only: see the header of this file and scripts/spikes/README.md.",
  );
}

export async function main(argv, env, deps = {}) {
  const io = deps.io ?? { out: (line) => console.log(line), err: (line) => console.error(line) };
  let options;
  try {
    options = parseArgs(argv);
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

  const secrets = collectSecrets(env);
  const say = (line) => io.out(scrub(line, secrets));
  const warn = (line) => io.err(scrub(line, secrets));
  const ctx = {
    origin: deps.origin ?? MONOBANK_ORIGIN,
    fetch: deps.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    token: undefined,
    secrets,
    calls: [],
    facts: {},
    reference: randomUUID(),
    pollMs: deps.pollMs ?? POLL_INTERVAL_MS,
    pollLimitMs: deps.pollLimitMs ?? POLL_LIMIT_MS,
  };

  say(
    `Plan (${options.stage}; origin ${ctx.origin === MONOBANK_ORIGIN ? MONOBANK_ORIGIN : "local stub"}):`,
  );
  for (const [index, step] of plan(options.stage).entries()) say(`  ${String(index + 1)}. ${step}`);
  if (!nonEmpty(env.MONOBANK_TOKEN)) {
    warn(
      "refused: MONOBANK_TOKEN is missing in the environment (never pass it as a flag). Nothing was sent.",
    );
    return 2;
  }
  if (options.stage === "pay" && nonEmpty(env.MONOBANK_SPIKE_WEBHOOK_URL)) {
    let url;
    try {
      url = new URL(env.MONOBANK_SPIKE_WEBHOOK_URL.trim());
    } catch {
      url = undefined;
    }
    if (url === undefined || url.protocol !== "https:") {
      warn("refused: MONOBANK_SPIKE_WEBHOOK_URL must be an https URL. Nothing was sent.");
      return 2;
    }
    ctx.webhookUrl = url.href;
  }
  if (options.stage === "webhook") {
    const missing = ["MONOBANK_SPIKE_WEBHOOK_BODY_FILE", "MONOBANK_SPIKE_WEBHOOK_SIGN"].filter(
      (name) => !nonEmpty(env[name]),
    );
    if (missing.length > 0) {
      warn(`refused: missing in the environment: ${missing.join(", ")}. Nothing was sent.`);
      return 2;
    }
  }
  if ((options.stage === "invoice" || options.stage === "pay") && !options.confirm) {
    warn(
      `refused: the ${options.stage} stage creates test invoices${options.stage === "pay" ? " and refunds a test payment" : ""}; re-run with --confirm after reading the plan. Nothing was sent.`,
    );
    return 2;
  }
  ctx.token = env.MONOBANK_TOKEN.trim();

  const startedAt = new Date().toISOString();
  let failure;
  try {
    if (options.stage === "webhook") {
      say("Stage webhook...");
      await stageWebhook(ctx, env);
    } else {
      say("Stage readonly...");
      await stageReadonly(ctx);
      if (options.stage === "invoice") {
        say("Stage invoice...");
        await stageInvoice(ctx);
      }
      if (options.stage === "pay") {
        say("Stage pay...");
        await stagePay(ctx, { out: say, err: warn });
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.name : "error";
    warn(`stage failed: ${failure}`);
  }
  const hypotheses = evaluate(ctx.facts);
  const findings = {
    tool: "scripts/spikes/monobank-verify.mjs",
    spikeVersion: SPIKE_VERSION,
    stage: options.stage,
    origin: ctx.origin === MONOBANK_ORIGIN ? MONOBANK_ORIGIN : "local stub",
    startedAt,
    finishedAt: new Date().toISOString(),
    node: process.version,
    failure: failure ?? null,
    hypotheses,
    facts: ctx.facts,
    calls: ctx.calls,
  };
  const outPath = resolve(options.out);
  writeFileSync(outPath, `${scrub(JSON.stringify(findings, null, 2), ctx.secrets)}\n`, {
    mode: 0o600,
  });
  say("");
  say(`Calls: ${String(ctx.calls.length)}; findings written to ${outPath}`);
  say("Monobank facts (plan M-numbers):");
  for (const item of hypotheses)
    say(`  ${item.id.padEnd(5)} ${item.status.padEnd(16)} ${item.claim}\n        -> ${item.fact}`);
  const transport = ctx.calls.some((entry) => entry.transportError !== undefined);
  return failure === undefined && !transport ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------------
// Self-test: a local stub of Monobank, no network

/** Behaves like the documented Monobank (M4, M6, M13, M14, M16) and echoes the token and a card mask in its texts. */
function startStub(validToken) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const state = { requests: [], invoices: new Map(), counter: 0, polls: 0 };
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const url = new URL(request.url, "http://127.0.0.1");
      state.requests.push({
        method: request.method,
        path: url.pathname,
        query: url.search,
        headers: { ...request.headers },
        raw,
      });
      const send = (status, json) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(json === undefined ? "" : JSON.stringify(json));
      };
      const error = (status, errCode, errText) => send(status, { errCode, errText });
      const token = request.headers["x-token"];
      if (token === undefined) return error(400, "BAD_REQUEST", "empty token");
      if (token !== validToken)
        return error(403, "FORBIDDEN", `forbidden ${token} 444403******1902`);
      const body = raw === "" ? {} : JSON.parse(raw);
      const find = (id) => state.invoices.get(id);
      switch (url.pathname) {
        case "/api/merchant/pubkey":
          return send(200, {
            key: Buffer.from(pair.publicKey.export({ type: "spki", format: "pem" })).toString(
              "base64",
            ),
          });
        case "/api/merchant/details":
          return send(200, {
            merchantId: "12o4Vv7EWy",
            merchantName: "Selftest Merchant FOP",
            edrpou: "1234567890",
          });
        case "/api/merchant/invoice/status": {
          const id = url.searchParams.get("invoiceId");
          if (id === null) return error(400, "BAD_REQUEST", "empty 'invoiceId'");
          const invoice = find(id);
          if (invoice === undefined)
            return error(404, "NOT_FOUND", `invalid 'invoiceId' with ${validToken}`);
          state.polls += 1;
          if (invoice.status === "created" && invoice.amount === 200 && state.polls >= 2) {
            // The "owner" paid on the page.
            invoice.status = "success";
            invoice.finalAmount = invoice.amount;
            invoice.paymentInfo = {
              maskedPan: "444403******1902",
              paymentSystem: "visa",
              paymentMethod: "pan",
              rrn: "060189181768",
              approvalCode: "662476",
            };
            invoice.modifiedDate = now();
          }
          return send(200, invoice);
        }
        case "/api/merchant/invoice/create": {
          if (body.ccy !== undefined && body.ccy !== 980) return error(400, "BAD_REQUEST", "ccy");
          state.counter += 1;
          const invoiceId = `p2_self${String(state.counter)}`;
          state.invoices.set(invoiceId, {
            invoiceId,
            status: "created",
            amount: body.amount,
            ccy: 980,
            createdDate: now(),
            modifiedDate: now(),
            reference: body.merchantPaymInfo?.reference,
            cancelList: [],
          });
          return send(200, { invoiceId, pageUrl: `https://pay.mbnk.biz/${invoiceId}` });
        }
        case "/api/merchant/invoice/cancel": {
          const invoice = find(body.invoiceId);
          if (invoice === undefined) return error(404, "NOT_FOUND", "invoice");
          if (invoice.status !== "success") return error(500, "CANCEL_NOT_AVAILABLE", "cannot");
          const refunded = invoice.cancelList.reduce((sum, entry) => sum + entry.amount, 0);
          if (body.amount > invoice.amount - refunded)
            return error(400, "WRONG_CANCEL_AMOUNT", "amount");
          invoice.cancelList.push({
            status: "success",
            amount: body.amount,
            ccy: 980,
            createdDate: now(),
            modifiedDate: now(),
            extRef: body.extRef,
            rrn: "1",
            approvalCode: "2",
          });
          invoice.finalAmount = invoice.amount - refunded - body.amount;
          if (invoice.finalAmount === 0) invoice.status = "reversed";
          return send(200, { status: "success", createdDate: now(), modifiedDate: now() });
        }
        case "/api/merchant/invoice/remove": {
          const invoice = find(body.invoiceId);
          if (invoice === undefined) return error(404, "NOT_FOUND", "invoice");
          if (invoice.status !== "created") return error(400, "BAD_REQUEST", "paid");
          invoice.status = "expired";
          return send(200);
        }
        default:
          return error(404, "NOT_FOUND", "route");
      }
    });
  });
  return new Promise((resolveStub) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveStub({
        origin: `http://127.0.0.1:${String(port)}`,
        state,
        sign: (bytes) =>
          sign("sha256", bytes, { key: pair.privateKey, dsaEncoding: "der" }).toString("base64"),
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(done);
          }),
      });
    }),
  );
}

async function selfTest(io) {
  const dir = mkdtempSync(join(tmpdir(), "monobank-spike-selftest-"));
  const token = `uSelfTest${randomBytes(16).toString("hex")}`;
  const env = { MONOBANK_TOKEN: token };
  const forbidden = [
    token,
    token.slice(5, 13),
    token.slice(-8),
    "444403",
    "Selftest Merchant",
    "1234567890",
    "12o4Vv7EWy",
    "060189181768",
    "662476",
  ];
  const results = [];
  const run = async (name, argv, runEnv, check, prepare) => {
    const stub = await startStub(token);
    const lines = [];
    const capture = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
    try {
      const extraEnv = prepare === undefined ? {} : prepare(stub);
      const out = join(dir, `${name.replace(/\W+/g, "-")}.json`);
      const code = await main(
        [...argv, "--out", out],
        { ...runEnv, ...extraEnv },
        {
          io: capture,
          origin: stub.origin,
          pollMs: 5,
          pollLimitMs: 2_000,
        },
      );
      let file = "";
      try {
        file = readFileSync(out, "utf8");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const everything = `${lines.join("\n")}\n${file}`;
      for (const secret of forbidden)
        assert.ok(
          !everything.includes(secret),
          `${name}: a secret or personal value reached the output`,
        );
      await check({ code, lines, file: file === "" ? null : JSON.parse(file), stub });
      results.push(`PASS ${name}`);
    } finally {
      await stub.close();
    }
  };
  const status = (file, id) => file.hypotheses.find((item) => item.id === id)?.status;
  try {
    await run(
      "every stage without a token is refused",
      [],
      { MONOBANK_TOKEN: "" },
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests.length, 0);
      },
    );
    await run(
      "invoice without --confirm prints the plan and sends nothing",
      ["--stage", "invoice"],
      env,
      ({ code, lines, stub }) => {
        assert.equal(code, 2);
        assert.ok(lines.some((line) => line.includes("1.00 UAH test invoice")));
        assert.equal(stub.state.requests.length, 0);
      },
    );
    await run("pay without --confirm sends nothing", ["--stage", "pay"], env, ({ code, stub }) => {
      assert.equal(code, 2);
      assert.equal(stub.state.requests.length, 0);
    });
    await run(
      "pay with an http webhook URL is refused",
      ["--stage", "pay", "--confirm"],
      { ...env, MONOBANK_SPIKE_WEBHOOK_URL: "http://staging.example/webhooks/payments/monobank" },
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests.length, 0);
      },
    );
    await run("an unknown flag is a usage error", ["--token", token], env, ({ code, stub }) => {
      assert.equal(code, 2);
      assert.equal(stub.state.requests.length, 0);
    });
    await run(
      "readonly changes nothing and sends the token only in X-Token",
      [],
      env,
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.equal(stub.state.requests.length, 5);
        assert.ok(stub.state.requests.every((request) => request.method === "GET"));
        for (const request of stub.state.requests) {
          assert.ok(!request.query.includes(token) && !request.raw.includes(token));
          assert.ok(!request.path.includes(token));
        }
        assert.equal(
          stub.state.requests.filter((request) => request.headers["x-token"] === token).length,
          4,
        );
        for (const id of ["M1", "M16", "M22"]) assert.equal(status(file, id), "CONFIRMED", id);
        assert.equal(status(file, "M12"), "PARTLY CONFIRMED");
        assert.equal(status(file, "M4"), "NOT TESTED");
      },
    );
    await run(
      "invoice creates tiny invoices and removes every one",
      ["--stage", "invoice", "--confirm"],
      env,
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        const creates = stub.state.requests.filter((request) => request.path.endsWith("/create"));
        assert.equal(creates.length, 4);
        const body = JSON.parse(creates[0].raw);
        assert.deepEqual(Object.keys(body).sort(), [
          "amount",
          "ccy",
          "merchantPaymInfo",
          "paymentType",
          "redirectUrl",
          "validity",
        ]);
        assert.equal(body.amount, 100);
        for (const invoice of stub.state.invoices.values())
          assert.equal(invoice.status, "expired", "every created invoice removed");
        for (const id of ["M1", "M4", "M5", "M6", "M13a", "M16", "M23"])
          assert.equal(status(file, id), "CONFIRMED", id);
      },
    );
    await run(
      "pay waits for the payment, refunds four times and removes",
      ["--stage", "pay", "--confirm"],
      { ...env, MONOBANK_SPIKE_WEBHOOK_URL: "https://staging.example/webhooks/payments/monobank" },
      ({ code, file, stub, lines }) => {
        assert.equal(code, 0);
        assert.ok(
          lines.some((line) => line.includes("https://pay.mbnk.biz/")),
          "the page URL is printed for the owner",
        );
        assert.ok(
          !file.facts.pay.create.answer.pageOrigin.includes("p2_self"),
          "only the page origin is recorded",
        );
        const create = JSON.parse(
          stub.state.requests.find((request) => request.path.endsWith("/create")).raw,
        );
        assert.equal(create.webHookUrl, "https://staging.example/webhooks/payments/monobank");
        const cancels = stub.state.requests
          .filter((request) => request.path.endsWith("/cancel"))
          .map((request) => JSON.parse(request.raw));
        assert.deepEqual(
          cancels.map((body) => [body.extRef, body.amount]),
          [
            ["fluxkit-s1-a", 50],
            ["fluxkit-s1-a", 50],
            ["fluxkit-s1-b", 50],
            ["fluxkit-s1-c", 50],
          ],
        );
        assert.equal(file.facts.pay.final.status, "reversed");
        assert.equal(status(file, "M8"), "MANUAL");
        assert.equal(status(file, "M13d"), "RECORDED");
        assert.equal(file.facts.pay.finalStatus.paymentInfo.maskedPanPresent, true);
      },
    );
    const bodyFile = join(dir, "webhook-body.json");
    await run(
      "webhook verifies a saved body and its X-Sign with the live key",
      ["--stage", "webhook"],
      env,
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.equal(stub.state.requests.length, 1);
        assert.equal(file.facts.webhook.verifies, true);
        assert.equal(file.facts.webhook.changedByteVerifies, false);
        assert.equal(status(file, "M12"), "CONFIRMED");
      },
      (stub) => {
        const body = Buffer.from(
          '{\n  "invoiceId": "p2_self1",\n  "status": "success",\n  "amount": 200,\n  "ccy": 980\n}',
        );
        writeFileSync(bodyFile, body);
        return {
          MONOBANK_SPIKE_WEBHOOK_BODY_FILE: bodyFile,
          MONOBANK_SPIKE_WEBHOOK_SIGN: stub.sign(body),
        };
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
      // Unexpected bug: the class only (a message may carry the token).
      console.error(`unexpected error: ${error instanceof Error ? error.name : "error"}`);
      process.exitCode = 1;
    },
  );
}
