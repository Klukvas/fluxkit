import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpException, Logger, type ArgumentsHost } from "@nestjs/common";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tooManyRequests } from "../../common/problem.js";
import { emailWebhookRawBody } from "./email-webhook-raw-body.js";
import {
  EmailWebhookExceptionFilter,
  emailWebhookBodyErrorHandler,
} from "./email-webhook-exception.filter.js";

function answer(exception: unknown) {
  const captured = {
    status: 0,
    contentType: "",
    body: {} as unknown,
    headers: {} as Record<string, string>,
  };
  const response = {
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
      return response;
    },
    status(status: number) {
      captured.status = status;
      return response;
    },
    type(contentType: string) {
      captured.contentType = contentType;
      return response;
    },
    json(body: unknown) {
      captured.body = body;
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: "POST", path: "/webhooks/email/brevo" }),
    }),
  } as unknown as ArgumentsHost;
  new EmailWebhookExceptionFilter().catch(exception, host);
  return captured;
}
function middlewareAnswer(exception: unknown) {
  let normalized: unknown;
  emailWebhookBodyErrorHandler(exception, {} as Request, {} as Response, (error?: unknown) => {
    normalized = error;
  });
  return answer(normalized);
}

afterEach(() => vi.restoreAllMocks());

describe("email webhook error boundary", () => {
  it("turns every server HttpException and unexpected failure into a bounded, value-free 429 problem", () => {
    const logs = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    for (const failure of [
      new Error("address@example.test secret-sentinel"),
      "secret-sentinel",
      ...Array.from(
        { length: 100 },
        (_, index) => new HttpException("secret-sentinel", 500 + index),
      ),
    ]) {
      const result = answer(failure);
      expect(result).toMatchObject({
        status: 429,
        contentType: "application/problem+json",
        headers: { "Retry-After": "5" },
        body: { status: 429, code: "too_many_requests" },
      });
      expect(JSON.stringify(result)).not.toContain("secret-sentinel");
    }
    expect(
      logs.mock.calls.every((call) => call.length === 1 && call[0] === "email_webhook_unavailable"),
    ).toBe(true);
  });

  it.each([400, 401, 404, 413, 429])("preserves intentional HTTP %s", (status) => {
    expect(answer(new HttpException("private value", status)).status).toBe(status);
  });

  it("keeps the intentional rate-limit Retry-After header", () => {
    for (const run of [answer, middlewareAnswer]) {
      expect(run(tooManyRequests("Slow down.", 60))).toMatchObject({
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }
  });

  it("keeps body-reader client errors and converts unexpected/server middleware errors before the global filter", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    for (const status of [400, 413]) {
      expect(middlewareAnswer(Object.assign(new Error("private bytes"), { status })).status).toBe(
        status,
      );
    }
    for (const failure of [
      new Error("private bytes"),
      Object.assign(new Error("private bytes"), { status: 503 }),
    ]) {
      expect(middlewareAnswer(failure)).toMatchObject({
        status: 429,
        headers: { "Retry-After": "5" },
      });
    }
  });

  it("forwards an asynchronous raw-body assembly failure to the retry boundary", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const request = Object.assign(new PassThrough(), { method: "POST", headers: {} });
    const completed = new Promise<unknown>((resolve) => {
      emailWebhookRawBody()(request as unknown as IncomingMessage, {} as ServerResponse, resolve);
    });
    vi.spyOn(Buffer, "concat").mockImplementationOnce(() => {
      throw new Error("private bytes");
    });
    request.end(Buffer.from("{}"));
    const failure = await completed;
    expect(failure).toBeInstanceOf(Error);
    expect(middlewareAnswer(failure)).toMatchObject({
      status: 429,
      headers: { "Retry-After": "5" },
    });
  });
});
