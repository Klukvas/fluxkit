import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** TEST ONLY. Invented key/people/IDs. TODO(fluxkit): not live-verified — B1/B2/B4 remote behaviour.
 * This model rejects duplicate UUIDs for 30 minutes; it does not establish that inline sends do so remotely.
 */
export const STUB_API_KEY = "Invented_StubKey_0123456789abcdefGHIJKLmnop";
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
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: string;
  readonly body: unknown;
}
export interface StubAnswer {
  readonly status: number;
  readonly json?: unknown;
  readonly body?: Buffer | string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly hang?: boolean;
  readonly delayMs?: number;
  readonly chunked?: boolean;
  readonly onSent?: () => void;
}
export type Override = (request: RecordedRequest) => StubAnswer | undefined;
export interface AcceptedEmail {
  readonly id: string;
  readonly idempotencyKey: string | null;
  readonly body: Record<string, unknown>;
}
export interface StubBrevo {
  readonly endpoint: string;
  readonly requests: readonly RecordedRequest[];
  readonly accepted: readonly AcceptedEmail[];
  override(next: Override | undefined): void;
  setLatency(ms: number): void;
  advance(ms: number): void;
  setIdempotency(enabled: boolean): void;
  loseNextResponse(): void;
  close(): Promise<void>;
}
export function addressOf(mailbox: unknown): string {
  return typeof mailbox === "object" &&
    mailbox !== null &&
    "email" in mailbox &&
    typeof mailbox.email === "string"
    ? mailbox.email
    : "";
}
function error(status: number, code: string, message: string): StubAnswer {
  return { status, json: { code, message } };
}
export async function startStubBrevo(): Promise<StubBrevo> {
  const requests: RecordedRequest[] = [];
  const accepted: AcceptedEmail[] = [];
  const keys = new Map<string, number>();
  let override: Override | undefined;
  let latencyMs = 0;
  let now = 0;
  let deduplicates = true;
  let loseResponse = false;
  const defaultAnswer = (request: RecordedRequest): StubAnswer => {
    if (request.path !== "/v3/smtp/email")
      return error(404, "document_not_found", "Missing endpoint");
    if (request.method !== "POST") return error(405, "method_not_allowed", "POST required");
    if (request.headers["api-key"] !== STUB_API_KEY)
      return error(401, "unauthorized", `Invalid key ${String(request.headers["api-key"])}`);
    if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body))
      return error(400, "invalid_parameter", "Invalid body");
    const body = request.body as Record<string, unknown>;
    const allowed = [
      "sender",
      "to",
      "subject",
      "htmlContent",
      "textContent",
      "replyTo",
      "tags",
      "headers",
    ];
    if (Object.keys(body).some((key) => !allowed.includes(key)))
      return error(400, "invalid_parameter", "Unexpected field");
    if (!Array.isArray(body.to) || body.to.length !== 1)
      return error(400, "invalid_parameter", "One recipient required");
    if (addressOf(body.to[0]) === STUB_PERSONAL.refused)
      return error(400, "invalid_parameter", `Invalid recipient ${STUB_PERSONAL.refused}`);
    const key = (body.headers as { idempotencyKey?: string } | undefined)?.idempotencyKey;
    if (typeof key !== "string") return error(400, "missing_parameter", "UUID required");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
      return error(400, "invalid_parameter", "UUID required");
    if (
      addressOf(body.sender) === "" ||
      typeof body.subject !== "string" ||
      typeof body.htmlContent !== "string" ||
      typeof body.textContent !== "string"
    )
      return error(400, "missing_parameter", "Inline fields required");
    const previous = keys.get(key);
    if (deduplicates && previous !== undefined && now - previous < 1800_000)
      return error(400, "duplicate_parameter", "Duplicate UUID");
    keys.set(key, now);
    const id = `<${String(accepted.length + 1)}.Stub+ID@smtp-relay.mailin.fr>`;
    accepted.push({ id, idempotencyKey: key, body });
    if (loseResponse) {
      loseResponse = false;
      return { status: 201, hang: true };
    }
    return {
      status: 201,
      json: { messageId: id },
      ...(latencyMs > 0 ? { delayMs: latencyMs } : {}),
    };
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
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${String(port)}/v3/smtp/email`,
    requests,
    accepted,
    override: (next) => {
      override = next;
    },
    setLatency: (ms) => {
      latencyMs = ms;
    },
    advance: (ms) => {
      now += ms;
    },
    setIdempotency: (enabled) => {
      deduplicates = enabled;
    },
    loseNextResponse: () => {
      loseResponse = true;
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
