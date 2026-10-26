import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * TEST ONLY. A local stand-in for Resend's `POST /emails` on 127.0.0.1, shaped after the documented facts of the email
 * plan, section 2 (R1, R2, R4 to R9; nothing was observed live: no key was available). Every key, address, name and id
 * here is INVENTED. It records every request (method, path, headers, raw body) so specs can pin the exact request, models
 * Resend's idempotency (R4: the same key with the same body replays the first answer; with another body `409
 * invalid_idempotent_request`; while the first is in flight `409 concurrent_idempotent_requests`), and a spec can
 * replace any answer. Its error bodies are `{statusCode, name, message}` (R9, LIKELY) and their messages ECHO the
 * recipient and a fragment of the key on purpose, so the secrets spec can prove the plugin never keeps them.
 *
 * Where the documents are silent the stub is stricter than Resend is known to be, so a sloppy request fails here first
 * (marked "stub rule"): it refuses unknown body members and a `to` that is not an array of one to 50 strings.
 */

export const STUB_API_KEY = "re_StubKey_0123456789abcdefGHIJKLmnop";

/** Invented personal data of the fixtures: specs assert it never reaches a log or a result. */
export const STUB_PERSONAL = Object.freeze({
  recipient: "yaryna.vyhadanenko@example.com",
  owner: "owner.test@example.com",
  refused: "refused@example.com",
  replyTo: "help.desk@mail.example",
  subject: "Замовлення 7K3M-9QX2 для Ярини Вигаданенко",
});

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  /** The URL as received (path and query). */
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: string;
  /** The parsed JSON body, or `undefined` when it was not JSON. */
  readonly body: unknown;
}

export interface StubAnswer {
  readonly status: number;
  readonly json?: unknown;
  /** A raw body instead of JSON (with `headers` for its content type). */
  readonly body?: Buffer | string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Never answers (the caller's signal must end the call). */
  readonly hang?: boolean;
  readonly delayMs?: number;
  /** Sends the body in two chunks without a content-length (the size cap must count while reading). */
  readonly chunked?: boolean;
  /** Called when the answer is written (the stub's idempotency record completes then). */
  readonly onSent?: () => void;
}

export type Override = (request: RecordedRequest) => StubAnswer | undefined;

/** The members of the send body the stub accepts (R2, R3 as assumed); anything else is refused (stub rule). */
const KNOWN_MEMBERS = new Set(["from", "to", "subject", "html", "text", "reply_to", "tags"]);

interface KeyRecord {
  readonly fingerprint: string;
  /** `undefined` while the first request with this key is still in flight. */
  answer: StubAnswer | undefined;
}

export interface AcceptedEmail {
  readonly id: string;
  readonly idempotencyKey: string | null;
  readonly body: Record<string, unknown>;
}

export interface StubResend {
  /** `http://127.0.0.1:<port>/emails` */
  readonly endpoint: string;
  readonly requests: readonly RecordedRequest[];
  /** Mails the stub accepted (a replay adds nothing). */
  readonly accepted: readonly AcceptedEmail[];
  /** Replaces the default answer while set (return `undefined` to fall through). */
  override(next: Override | undefined): void;
  /** Delay of every default success (to hold a key in flight). */
  setLatency(ms: number): void;
  /** Testing mode (R8): only this address may receive mail, others are `403 validation_error`. */
  setTestingModeOwner(address: string | undefined): void;
  close(): Promise<void>;
}

function error(status: number, name: string, message: string): StubAnswer {
  return { status, json: { statusCode: status, name, message } };
}

/** The address inside `"Name" <address>` or the bare address. */
export function addressOf(mailbox: unknown): string {
  if (typeof mailbox !== "string") {
    return "";
  }
  const match = /<([^<>]+)>$/.exec(mailbox);
  return match?.[1] ?? mailbox;
}

export async function startStubResend(): Promise<StubResend> {
  const requests: RecordedRequest[] = [];
  const accepted: AcceptedEmail[] = [];
  const keys = new Map<string, KeyRecord>();
  let override: Override | undefined;
  let latencyMs = 0;
  let testingModeOwner: string | undefined;

  const defaultAnswer = (request: RecordedRequest): StubAnswer => {
    if (request.path !== "/emails") {
      return error(404, "not_found", "The requested endpoint does not exist.");
    }
    if (request.method !== "POST") {
      return error(405, "method_not_allowed", "Method not allowed.");
    }
    const agent = request.headers["user-agent"];
    if (typeof agent !== "string" || agent.trim() === "") {
      // R6: "error code 1010", a plain-text answer.
      return { status: 403, body: "error code: 1010", headers: { "content-type": "text/plain" } };
    }
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || authorization === "") {
      return error(401, "missing_api_key", "Missing API key in the authorization header.");
    }
    if (authorization !== `Bearer ${STUB_API_KEY}`) {
      // Echoes a fragment of what was sent, as an unhelpful service might.
      return error(401, "validation_error", `API key is invalid: ${authorization.slice(0, 24)}`);
    }
    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || !contentType.includes("application/json")) {
      return error(400, "validation_error", "Body must be JSON.");
    }
    const key = request.headers["idempotency-key"];
    if (typeof key === "string" && (key.length < 1 || key.length > 256)) {
      return error(400, "invalid_idempotency_key", "The key must be between 1-256 chars.");
    }
    const body = request.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return error(400, "validation_error", "Invalid JSON body.");
    }
    const fields = body as Record<string, unknown>;
    for (const member of Object.keys(fields)) {
      if (!KNOWN_MEMBERS.has(member)) {
        return error(422, "invalid_parameter", `Unknown parameter: ${member}`); // stub rule
      }
    }
    for (const required of ["from", "to", "subject"]) {
      if (fields[required] === undefined) {
        return error(422, "missing_required_field", `Missing \`${required}\` field.`);
      }
    }
    const to = fields.to;
    if (
      !Array.isArray(to) ||
      to.length < 1 ||
      to.length > 50 ||
      to.some((item) => typeof item !== "string")
    ) {
      return error(422, "invalid_parameter", "Invalid `to` field."); // stub rule: an array of strings
    }
    const recipient = addressOf(to[0]);
    if (recipient.split("@")[0] === "refused") {
      return error(422, "invalid_parameter", `Invalid \`to\` field: ${recipient}`);
    }
    if (testingModeOwner !== undefined && recipient !== testingModeOwner) {
      return error(
        403,
        "validation_error",
        `You can only send testing emails to your own email address (${testingModeOwner}). Not ${recipient}.`,
      );
    }
    const fingerprint = createHash("sha256").update(request.rawBody).digest("hex");
    if (typeof key === "string") {
      const known = keys.get(key);
      if (known !== undefined) {
        if (known.fingerprint !== fingerprint) {
          return error(
            409,
            "invalid_idempotent_request",
            "Same idempotency key used with a different request payload.",
          );
        }
        if (known.answer === undefined) {
          return error(
            409,
            "concurrent_idempotent_requests",
            "Same idempotency key used while original request is still in progress.",
          );
        }
        return known.answer;
      }
    }
    const id = `00000000-0000-4000-8000-${String(accepted.length + 1).padStart(12, "0")}`;
    accepted.push({ id, idempotencyKey: typeof key === "string" ? key : null, body: fields });
    const answer: StubAnswer = { status: 200, json: { id } };
    if (typeof key === "string") {
      const record: KeyRecord = { fingerprint, answer: undefined };
      keys.set(key, record);
      if (latencyMs > 0) {
        return {
          ...answer,
          delayMs: latencyMs,
          onSent: () => {
            record.answer = answer;
          },
        };
      }
      record.answer = answer;
    }
    return latencyMs > 0 ? { ...answer, delayMs: latencyMs } : answer;
  };

  const server = createServer((incoming: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      try {
        body = rawBody === "" ? undefined : (JSON.parse(rawBody) as unknown);
      } catch {
        body = undefined;
      }
      const recorded: RecordedRequest = {
        method: incoming.method ?? "GET",
        path: url.pathname,
        url: incoming.url ?? "/",
        headers: { ...incoming.headers },
        rawBody,
        body,
      };
      requests.push(recorded);
      const answer = override?.(recorded) ?? defaultAnswer(recorded);
      if (answer.hang === true) {
        return;
      }
      const send = () => {
        answer.onSent?.();
        if (response.destroyed) return;
        if (answer.body !== undefined) {
          const bytes = Buffer.from(answer.body);
          if (answer.chunked === true) {
            response.writeHead(answer.status, { ...answer.headers });
            const half = Math.floor(bytes.length / 2);
            response.write(bytes.subarray(0, half));
            response.end(bytes.subarray(half));
            return;
          }
          response.writeHead(answer.status, {
            "content-length": String(bytes.length),
            ...answer.headers,
          });
          response.end(bytes);
          return;
        }
        response.writeHead(answer.status, {
          "content-type": "application/json",
          ...answer.headers,
        });
        response.end(answer.json === undefined ? "" : JSON.stringify(answer.json));
      };
      if ((answer.delayMs ?? 0) > 0) setTimeout(send, answer.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${String(port)}/emails`,
    requests,
    accepted,
    override: (next) => {
      override = next;
    },
    setLatency: (ms) => {
      latencyMs = ms;
    },
    setTestingModeOwner: (address) => {
      testingModeOwner = address;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

/** A logger that keeps every line (`warn ...`). */
export function captureLogger(): { warn(message: string): void; readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    warn: (message: string) => {
      lines.push(`warn ${message}`);
    },
  };
}
