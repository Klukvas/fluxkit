// Resend verification spike (email plan step 6, check S1; ADR 0031 decision 17). Plain Node 22 ESM, built-in fetch only,
// no dependencies, not part of any package build. How to run it, what it sends and how to read the findings:
// scripts/spikes/README.md. It checks the documented Resend facts the plugin packages/providers/resend codes against
// (plan docs/plans/2026-10-26-email.md, section 2, R1 to R9) with ONE real mail to the owner's own address.
//
// Stages (--stage):
//   keyless   No valid key is sent, so nothing can be delivered: POST /emails without a key, with an invented key, and
//             with an invented key and an empty User-Agent. Records statuses, error names and the error body's keys
//             (R6, R8, R9). Safe to run anywhere.
//   send      (default) Needs RESEND_API_KEY, RESEND_SPIKE_FROM, RESEND_SPIKE_TO and --confirm. Runs keyless first, then:
//             (1) the key with an empty User-Agent and an empty recipient list (cannot deliver; R6), (2) ONE test mail to
//             RESEND_SPIKE_TO shaped exactly like the plugin's request (R1, R2, R3, R5, R7), (3) the same key and body
//             again (R4: same id, no second mail), (4) the same key with another subject (R4: 409
//             invalid_idempotent_request, no mail), (5) a 257-character key with an empty recipient list (R4: 400
//             invalid_idempotency_key; cannot deliver). Without --confirm it prints the plan and exits 2 before any call.
//   --self-test  Runs both stages against a local stub of Resend on 127.0.0.1 and asserts the gating and the redaction.
//
// Inputs (environment only; never on the command line, so nothing lands in the shell history):
//   RESEND_API_KEY           the key (a sending-only key is enough). Never printed or written; scrubbed from every output.
//   RESEND_SPIKE_FROM        the sender, `Name <address>` or an address on the VERIFIED domain (testing mode: Resend's
//                            own test sender, see the README).
//   RESEND_SPIKE_TO          the owner's own address (testing mode sends only there, R8).
//   RESEND_SPIKE_REPLY_TO    optional; the reply-to address to check R3 (default: the sender's address).
//   --out <path>             findings JSON (default ./resend-findings.json, git-ignored, mode 600).
//
// Exit codes: 0 done; 1 a call failed or an expectation was not met (findings still written); 2 usage error or refusal,
// nothing sent.
//
// Behind an HTTPS proxy, Node's fetch may need NODE_USE_ENV_PROXY=1 (Node >= 22.21).

import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

const SPIKE_VERSION = 1;
// A constant, never configurable from a flag or the environment (no SSRF). Only the self-test passes its stub.
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const USER_AGENT = "fluxkit-provider-resend/1"; // the plugin's value (packages/providers/resend/src/config.ts)
const MAX_BODY_BYTES = 64 * 1024;
const CALL_TIMEOUT_MS = 15_000;
const REDACTED = "[REDACTED]";
const DEFAULT_OUT = "resend-findings.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const RATE_HEADER = /(rate|limit|retry|quota)/i;

class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// Arguments and inputs

function parseArgs(argv) {
  const options = { stage: "send", out: DEFAULT_OUT, confirm: false, selfTest: false, help: false };
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
  if (!["keyless", "send"].includes(options.stage))
    throw new UsageError("--stage must be keyless or send");
  return options;
}

const nonEmpty = (value) => typeof value === "string" && value.trim() !== "";

/** `Name <address>` or `"Name" <address>` or a bare address -> {name, address}; anything else is a usage error. */
function parseMailbox(value, variable) {
  const text = value.trim();
  const match = /^(?:"?([^"<>\r\n]*?)"?\s*<([^<>\s]+@[^<>\s]+)>|([^<>\s"]+@[^<>\s"]+))$/.exec(text);
  if (match === null) throw new UsageError(`${variable} must be an address or "Name <address>"`);
  return { name: (match[1] ?? "").trim() || null, address: (match[2] ?? match[3]).toLowerCase() };
}

/** As the plugin writes a mailbox (core formatMailbox): `"Name" <address>` or the bare address. */
const formatMailbox = (mailbox) =>
  mailbox.name === null ? mailbox.address : `"${mailbox.name}" <${mailbox.address}>`;

function collectSecrets(env) {
  const secrets = [];
  const add = (value) => {
    if (nonEmpty(value)) {
      const trimmed = value.trim();
      secrets.push(trimmed, trimmed.toLowerCase(), encodeURIComponent(trimmed));
      if (trimmed.length > 12) secrets.push(trimmed.slice(3, 15)); // the key without its prefix, a fragment
    }
  };
  add(env.RESEND_API_KEY);
  for (const variable of ["RESEND_SPIKE_FROM", "RESEND_SPIKE_TO", "RESEND_SPIKE_REPLY_TO"]) {
    const value = env[variable];
    add(value);
    if (nonEmpty(value)) {
      try {
        const mailbox = parseMailbox(value, variable);
        add(mailbox.address);
        add(mailbox.address.split("@")[0]);
        if (mailbox.name !== null) add(mailbox.name);
      } catch {
        // A malformed value is reported by the caller as a usage error; its raw form is already a secret.
      }
    }
  }
  return [...new Set(secrets)]
    .filter((secret) => secret.length >= 3)
    .sort((a, b) => b.length - a.length);
}

function scrub(text, secrets) {
  let result = String(text);
  for (const secret of secrets) result = result.split(secret).join(REDACTED);
  // Any address-like or key-like run left (an echo in another spelling).
  return result
    .replace(/[^\s"'<>(),;:]+@[^\s"'<>(),;:]+/g, "[address]")
    .replace(/\bre_[A-Za-z0-9_-]{6,}/g, "[key]");
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

/** The structure of an answer: keys, the `name` when it is a code, the id's shape. Never a message text or a value. */
function describeAnswer(json, secrets) {
  if (json === undefined) return { json: false };
  if (typeof json !== "object" || json === null || Array.isArray(json))
    return { json: true, topLevel: Array.isArray(json) ? "array" : typeof json };
  const facts = { json: true, keys: Object.keys(json).sort() };
  if (typeof json.name === "string") {
    const name = scrub(json.name, secrets);
    facts.name = SAFE_NAME.test(name) ? name : "[not a code]";
  }
  if (typeof json.statusCode === "number") facts.statusCode = json.statusCode;
  if (typeof json.message === "string") {
    facts.messageLength = json.message.length;
    facts.messageEchoesAnAddress = /@/.test(json.message);
  }
  if (typeof json.id === "string")
    facts.idShape = UUID.test(json.id) ? "uuid" : `string(${String(json.id.length)})`;
  return facts;
}

/** One POST /emails. Records structural facts only (never the key, the body, an address or a message text). */
async function postEmails(ctx, label, { key, userAgent, idempotencyKey, body, rawBody }) {
  const headers = { accept: "application/json", "content-type": "application/json" };
  if (key !== undefined) headers.authorization = `Bearer ${key}`;
  if (userAgent !== undefined) headers["user-agent"] = userAgent;
  if (idempotencyKey !== undefined) headers["idempotency-key"] = idempotencyKey;
  const text = rawBody ?? JSON.stringify(body);
  const record = {
    label,
    authSent: key === undefined ? "none" : key === ctx.apiKey ? "key" : "invented",
    userAgentSent: userAgent === undefined ? "default" : userAgent === "" ? "empty" : "plugin",
    idempotencyKeyLength: idempotencyKey === undefined ? null : idempotencyKey.length,
    bodySha256: createHash("sha256").update(text).digest("hex").slice(0, 16),
  };
  ctx.calls.push(record);
  const started = performance.now();
  let response;
  let bytes;
  try {
    response = await ctx.fetch(ctx.endpoint, {
      method: "POST",
      headers,
      body: text,
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
  let json;
  try {
    json = bytes.byteLength === 0 ? undefined : JSON.parse(bytes.toString("utf8"));
  } catch {
    json = undefined;
  }
  Object.assign(record, describeAnswer(json, ctx.secrets));
  if (json === undefined && bytes.byteLength > 0) record.plainTextLength = bytes.byteLength;
  return { status: response.status, json, record };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stages

async function stageKeyless(ctx) {
  const invented = `re_${randomBytes(18).toString("base64url")}`;
  ctx.secrets.push(invented);
  const body = { from: "spike@example.invalid", to: [], subject: "x", html: "<p>x</p>", text: "x" };
  ctx.facts.keyless = {
    noKey: (await postEmails(ctx, "keyless: no key", { userAgent: USER_AGENT, body })).record,
    inventedKey: (
      await postEmails(ctx, "keyless: invented key", { key: invented, userAgent: USER_AGENT, body })
    ).record,
    inventedKeyNoAgent: (
      await postEmails(ctx, "keyless: invented key, empty User-Agent", {
        key: invented,
        userAgent: "",
        body,
      })
    ).record,
  };
}

function sendBody(ctx, subject) {
  return {
    from: formatMailbox(ctx.from),
    to: [formatMailbox(ctx.to)],
    subject,
    html: `<p>Fluxkit email check S1 (${ctx.stamp}). If you did not expect this mail, ignore it.</p>`,
    text: `Fluxkit email check S1 (${ctx.stamp}). If you did not expect this mail, ignore it.`,
    reply_to: formatMailbox(ctx.replyTo),
    tags: [{ name: "category", value: "spike" }],
  };
}

async function stageSend(ctx) {
  const undeliverable = { ...sendBody(ctx, "Fluxkit S1 probe"), to: [] };
  const facts = {};
  facts.agentProbe = (
    await postEmails(ctx, "send: key, empty User-Agent, no recipient", {
      key: ctx.apiKey,
      userAgent: "",
      idempotencyKey: randomUUID(),
      body: undeliverable,
    })
  ).record;
  const key = randomUUID();
  const subject = `Fluxkit S1 test ${ctx.stamp}`;
  const first = await postEmails(ctx, "send: the test mail", {
    key: ctx.apiKey,
    userAgent: USER_AGENT,
    idempotencyKey: key,
    body: sendBody(ctx, subject),
  });
  facts.first = first.record;
  const replay = await postEmails(ctx, "send: replay (same key, same body)", {
    key: ctx.apiKey,
    userAgent: USER_AGENT,
    idempotencyKey: key,
    body: sendBody(ctx, subject),
  });
  facts.replay = replay.record;
  facts.replaySameId =
    typeof first.json?.id === "string" && first.json.id === replay.json?.id
      ? true
      : replay.status === 200
        ? false
        : null;
  facts.conflict = (
    await postEmails(ctx, "send: same key, another subject", {
      key: ctx.apiKey,
      userAgent: USER_AGENT,
      idempotencyKey: key,
      body: sendBody(ctx, `${subject} (changed)`),
    })
  ).record;
  facts.longKey = (
    await postEmails(ctx, "send: 257-character key, no recipient", {
      key: ctx.apiKey,
      userAgent: USER_AGENT,
      idempotencyKey: "k".repeat(257),
      body: undeliverable,
    })
  ).record;
  ctx.facts.send = facts;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hypotheses (plan section 2)

const NOT_TESTED = (why) => ({ status: "NOT TESTED", fact: why });
const verdict = (ok, fact) => ({ status: ok ? "CONFIRMED" : "DIFFERENT", fact });
const said = (record) =>
  record === undefined
    ? "-"
    : `${String(record.httpStatus ?? record.transportError)}${record.name === undefined ? "" : ` ${record.name}`}`;

const HYPOTHESES = [
  [
    "R1",
    "POST /emails with Authorization: Bearer <key> accepts a mail",
    (f) =>
      f.send === undefined
        ? NOT_TESTED("send stage not run")
        : verdict(f.send.first.httpStatus === 200, `test mail: ${said(f.send.first)}`),
  ],
  [
    "R2",
    "The body (quoted display name in from, to array, subject, html, text, tags) is accepted",
    (f) =>
      f.send === undefined
        ? NOT_TESTED("send stage not run")
        : verdict(f.send.first.httpStatus === 200, `test mail: ${said(f.send.first)}`),
  ],
  [
    "R3",
    "reply_to is the reply-to member (the received mail shows it as Reply-To)",
    (f) =>
      f.send === undefined || f.send.first.httpStatus !== 200
        ? NOT_TESTED("no mail was accepted")
        : {
            status: "MANUAL",
            fact: "open the received mail's headers: Reply-To must be RESEND_SPIKE_REPLY_TO (else the member is ignored); write the result into the plan",
          },
  ],
  [
    "R4a",
    "The same key and body replays the first answer (same id, no second mail)",
    (f) =>
      f.send === undefined
        ? NOT_TESTED("send stage not run")
        : verdict(
            f.send.replaySameId === true,
            `replay: ${said(f.send.replay)}, same id: ${String(f.send.replaySameId)} (check the inbox holds ONE mail)`,
          ),
  ],
  [
    "R4b",
    "The same key with another body is 409 invalid_idempotent_request",
    (f) =>
      f.send === undefined
        ? NOT_TESTED("send stage not run")
        : verdict(
            f.send.conflict.httpStatus === 409 &&
              f.send.conflict.name === "invalid_idempotent_request",
            `changed body: ${said(f.send.conflict)}`,
          ),
  ],
  [
    "R4c",
    "A key longer than 256 characters is 400 invalid_idempotency_key",
    (f) =>
      f.send === undefined
        ? NOT_TESTED("send stage not run")
        : verdict(
            f.send.longKey.httpStatus === 400 && f.send.longKey.name === "invalid_idempotency_key",
            `257 characters: ${said(f.send.longKey)} (a 422 means the body was checked first: inconclusive)`,
          ),
  ],
  [
    "R5",
    "Success answers {id: <uuid>}",
    (f) =>
      f.send === undefined || f.send.first.httpStatus !== 200
        ? NOT_TESTED("no mail was accepted")
        : verdict(
            f.send.first.idShape === "uuid",
            `id: ${String(f.send.first.idShape)}, keys: ${String(f.send.first.keys)}`,
          ),
  ],
  [
    "R6",
    "A request without a User-Agent is 403",
    (f) =>
      f.send === undefined
        ? NOT_TESTED("send stage not run")
        : verdict(
            f.send.agentProbe.httpStatus === 403,
            `valid key, empty User-Agent: ${said(f.send.agentProbe)}`,
          ),
  ],
  [
    "R7",
    "Rate-limit headers (ratelimit-limit, -remaining, -reset) on answers; retry-after in seconds on 429",
    (f) => {
      const record = f.send?.first ?? f.keyless?.noKey;
      return record === undefined
        ? NOT_TESTED("no answer")
        : { status: "RECORDED", fact: `rate headers: ${JSON.stringify(record.rateHeaders ?? {})}` };
    },
  ],
  [
    "R8a",
    "No key is 401 missing_api_key",
    (f) =>
      f.keyless === undefined
        ? NOT_TESTED("keyless not run")
        : verdict(
            f.keyless.noKey.httpStatus === 401 && f.keyless.noKey.name === "missing_api_key",
            `no key: ${said(f.keyless.noKey)}`,
          ),
  ],
  [
    "R8b",
    "An invented key is refused (400 or 401 validation_error: which one decides the plugin's mapping)",
    (f) =>
      f.keyless === undefined
        ? NOT_TESTED("keyless not run")
        : verdict(
            [400, 401, 403].includes(f.keyless.inventedKey.httpStatus),
            `invented key: ${said(f.keyless.inventedKey)} (the plugin reads 400 as rejected, 401/403 as misconfigured)`,
          ),
  ],
  [
    "R9",
    "Error bodies are {statusCode, name, message}",
    (f) => {
      const record = f.keyless?.noKey;
      return record === undefined
        ? NOT_TESTED("keyless not run")
        : verdict(
            JSON.stringify(record.keys) === JSON.stringify(["message", "name", "statusCode"]),
            `keys: ${JSON.stringify(record.keys ?? null)}`,
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
    "POST /emails without a key (no mail possible)",
    "POST /emails with an invented key (no mail possible)",
    "POST /emails with an invented key and an empty User-Agent (no mail possible)",
  ];
  if (stage === "send") {
    steps.push(
      "POST /emails with the key, an empty User-Agent and NO recipient (no mail possible; R6)",
      "POST /emails with the key: ONE test mail to RESEND_SPIKE_TO (R1, R2, R3, R5, R7)",
      "the same request again with the same Idempotency-Key (R4: same id, no second mail)",
      "the same key with another subject (R4: 409, no mail)",
      "a 257-character Idempotency-Key with NO recipient (R4: 400; no mail possible)",
    );
  }
  return steps;
}

function usage(io) {
  io.out(
    "Usage: node scripts/spikes/resend-verify.mjs [--stage keyless|send] [--confirm] [--out <path>]",
  );
  io.out("       node scripts/spikes/resend-verify.mjs --self-test");
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
    endpoint: deps.endpoint ?? RESEND_ENDPOINT,
    fetch: deps.fetch ?? ((url, init) => globalThis.fetch(url, init)),
    apiKey: undefined,
    secrets,
    calls: [],
    facts: {},
    stamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };

  say(
    `Plan (${options.stage}; endpoint ${ctx.endpoint === RESEND_ENDPOINT ? RESEND_ENDPOINT : "local stub"}):`,
  );
  for (const [index, step] of plan(options.stage).entries()) say(`  ${String(index + 1)}. ${step}`);
  if (options.stage === "send") {
    const missing = ["RESEND_API_KEY", "RESEND_SPIKE_FROM", "RESEND_SPIKE_TO"].filter(
      (name) => !nonEmpty(env[name]),
    );
    if (missing.length > 0) {
      warn(
        `refused: missing in the environment: ${missing.join(", ")} (never pass them as flags). Nothing was sent.`,
      );
      return 2;
    }
    try {
      ctx.from = parseMailbox(env.RESEND_SPIKE_FROM, "RESEND_SPIKE_FROM");
      ctx.to = parseMailbox(env.RESEND_SPIKE_TO, "RESEND_SPIKE_TO");
      ctx.replyTo = nonEmpty(env.RESEND_SPIKE_REPLY_TO)
        ? parseMailbox(env.RESEND_SPIKE_REPLY_TO, "RESEND_SPIKE_REPLY_TO")
        : { name: null, address: ctx.from.address };
    } catch (error) {
      if (error instanceof UsageError) {
        warn(`refused: ${error.message}. Nothing was sent.`);
        return 2;
      }
      throw error;
    }
    if (!options.confirm) {
      warn(
        "refused: the send stage delivers ONE real mail; re-run with --confirm after reading the plan. Nothing was sent.",
      );
      return 2;
    }
    ctx.apiKey = env.RESEND_API_KEY.trim();
  }

  const startedAt = new Date().toISOString();
  let failure;
  try {
    say("Stage keyless...");
    await stageKeyless(ctx);
    if (options.stage === "send") {
      say("Stage send...");
      await stageSend(ctx);
    }
  } catch (error) {
    failure = error instanceof Error ? error.name : "error";
    warn(`stage failed: ${failure}`);
  }
  const hypotheses = evaluate(ctx.facts);
  const findings = {
    tool: "scripts/spikes/resend-verify.mjs",
    spikeVersion: SPIKE_VERSION,
    stage: options.stage,
    endpoint: ctx.endpoint === RESEND_ENDPOINT ? RESEND_ENDPOINT : "local stub",
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
  say("Plan section 2 (Resend) hypotheses:");
  for (const item of hypotheses)
    say(`  ${item.id.padEnd(4)} ${item.status.padEnd(10)} ${item.claim}\n       -> ${item.fact}`);
  const transport = ctx.calls.some((call) => call.transportError !== undefined);
  return failure === undefined && !transport ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------------------
// Self-test: a local stub of Resend, no network

/** Behaves like the documented Resend (R4, R6, R8, R9) and echoes the key and the address in its texts on purpose. */
function startStub(validKey) {
  const state = { requests: [], accepted: 0, keys: new Map() };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      state.requests.push({ headers: { ...request.headers }, raw });
      const answer = (status, name, message) => {
        response.writeHead(status, {
          "content-type": "application/json",
          "ratelimit-limit": "10",
          "ratelimit-remaining": "9",
        });
        response.end(
          JSON.stringify(name === undefined ? message : { statusCode: status, name, message }),
        );
      };
      const authorization = request.headers.authorization;
      if (authorization === undefined) return answer(401, "missing_api_key", "Missing API key");
      if ((request.headers["user-agent"] ?? "") === "") {
        response.writeHead(403, { "content-type": "text/plain" });
        return response.end("error code: 1010");
      }
      if (authorization !== `Bearer ${validKey}`)
        return answer(401, "validation_error", `API key is invalid: ${authorization}`);
      const key = request.headers["idempotency-key"];
      if (typeof key === "string" && key.length > 256)
        return answer(400, "invalid_idempotency_key", "1-256");
      const body = JSON.parse(raw);
      if (!Array.isArray(body.to) || body.to.length === 0)
        return answer(422, "invalid_parameter", "`to` is empty");
      if (typeof body.reply_to !== "string") return answer(422, "invalid_parameter", "reply_to");
      const known = typeof key === "string" ? state.keys.get(key) : undefined;
      if (known !== undefined) {
        if (known.raw !== raw)
          return answer(409, "invalid_idempotent_request", `different payload for ${body.to[0]}`);
        return answer(200, undefined, { id: known.id });
      }
      state.accepted += 1;
      const id = randomUUID();
      if (typeof key === "string") state.keys.set(key, { raw, id });
      return answer(200, undefined, { id });
    });
  });
  return new Promise((resolveStub) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveStub({
        endpoint: `http://127.0.0.1:${String(port)}/emails`,
        state,
        close: () => new Promise((done) => server.close(done)),
      });
    }),
  );
}

async function selfTest(io) {
  const dir = mkdtempSync(join(tmpdir(), "resend-spike-selftest-"));
  const key = `re_SelfTest_${randomBytes(12).toString("hex")}`;
  const env = {
    RESEND_API_KEY: key,
    RESEND_SPIKE_FROM: "Selftest Shop <sender.selftest@example.test>",
    RESEND_SPIKE_TO: "owner.selftest@example.test",
    RESEND_SPIKE_REPLY_TO: "reply.selftest@example.test",
  };
  const forbidden = [
    key,
    key.slice(3, 15),
    "sender.selftest",
    "owner.selftest",
    "reply.selftest",
    "Selftest Shop",
  ];
  const results = [];
  const run = async (name, argv, runEnv, check) => {
    const stub = await startStub(key);
    const lines = [];
    const capture = { out: (line) => lines.push(line), err: (line) => lines.push(line) };
    try {
      const out = join(dir, `${name.replace(/\W+/g, "-")}.json`);
      const code = await main([...argv, "--out", out], runEnv, {
        io: capture,
        endpoint: stub.endpoint,
      });
      let file = "";
      try {
        file = readFileSync(out, "utf8");
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const everything = `${lines.join("\n")}\n${file}`;
      for (const secret of forbidden)
        assert.ok(!everything.includes(secret), `${name}: a secret or address reached the output`);
      assert.ok(!/@example\.test/.test(everything), `${name}: an address reached the output`);
      await check({ code, lines, file: file === "" ? null : JSON.parse(file), stub });
      results.push(`PASS ${name}`);
    } finally {
      await stub.close();
    }
  };
  const status = (file, id) => file.hypotheses.find((item) => item.id === id)?.status;
  try {
    await run(
      "send without a key is refused",
      [],
      { ...env, RESEND_API_KEY: "" },
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests.length, 0);
      },
    );
    await run(
      "send without a recipient is refused",
      [],
      { ...env, RESEND_SPIKE_TO: " " },
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests.length, 0);
      },
    );
    await run(
      "send without --confirm prints the plan and sends nothing",
      [],
      env,
      ({ code, lines, stub }) => {
        assert.equal(code, 2);
        assert.ok(lines.some((line) => line.includes("ONE test mail")));
        assert.equal(stub.state.requests.length, 0);
      },
    );
    await run(
      "a malformed sender is refused",
      ["--confirm"],
      { ...env, RESEND_SPIKE_FROM: "not an address" },
      ({ code, stub }) => {
        assert.equal(code, 2);
        assert.equal(stub.state.requests.length, 0);
      },
    );
    await run("an unknown flag is a usage error", ["--key", key], env, ({ code, stub }) => {
      assert.equal(code, 2);
      assert.equal(stub.state.requests.length, 0);
    });
    await run(
      "keyless never sends the key",
      ["--stage", "keyless"],
      env,
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.equal(stub.state.requests.length, 3);
        assert.equal(stub.state.accepted, 0);
        for (const request of stub.state.requests)
          assert.ok(!String(request.headers.authorization ?? "").includes(key));
        assert.equal(status(file, "R8a"), "CONFIRMED");
        assert.equal(status(file, "R9"), "CONFIRMED");
        assert.equal(status(file, "R1"), "NOT TESTED");
      },
    );
    await run(
      "send delivers exactly one mail and checks R4 to R6",
      ["--confirm"],
      env,
      ({ code, file, stub }) => {
        assert.equal(code, 0);
        assert.equal(stub.state.accepted, 1, "one mail only");
        assert.equal(stub.state.requests.length, 8);
        const mail = stub.state.requests.find(
          (request) => request.raw.includes("S1 test") && !request.raw.includes("changed"),
        );
        const body = JSON.parse(mail.raw);
        assert.deepEqual(Object.keys(body).sort(), [
          "from",
          "html",
          "reply_to",
          "subject",
          "tags",
          "text",
          "to",
        ]);
        assert.equal(body.from, '"Selftest Shop" <sender.selftest@example.test>');
        assert.equal(mail.headers["user-agent"], USER_AGENT);
        for (const id of ["R1", "R2", "R4a", "R4b", "R4c", "R5", "R6", "R8a", "R9"])
          assert.equal(status(file, id), "CONFIRMED", id);
        assert.equal(status(file, "R3"), "MANUAL");
        assert.equal(
          file.hypotheses.find((item) => item.id === "R8b").fact.includes("validation_error"),
          true,
        );
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
      // Unexpected bug: the class only (a message may carry the key or an address).
      console.error(`unexpected error: ${error instanceof Error ? error.name : "error"}`);
      process.exitCode = 1;
    },
  );
}
