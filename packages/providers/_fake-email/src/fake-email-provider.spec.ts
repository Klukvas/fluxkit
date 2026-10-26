import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkEmailProviderContract,
  EMAIL_PROVIDER_FAILURE_REASONS,
  EMAIL_PROVIDER_METADATA,
  type EmailProviderFailure,
  type EmailProviderResult,
  type EmailSent,
  type OutgoingEmail,
} from "@fluxkit/core";
import {
  FAKE_EMAIL_PROVIDER_CODE,
  FakeEmailProvider,
  parseFakeEmailCaptureFile,
  providerModule,
} from "./index.js";

const message: OutgoingEmail = {
  from: { address: "shop@mail.example", displayName: "Fluxkit Demo Shop" },
  to: { address: "buyer@example.com", displayName: null },
  subject: "Your order",
  html: "<p>Thank you</p>",
  text: "Thank you",
  tags: { category: "order" },
};
const KEY = "00000000-0000-4000-8000-000000000001";

function live() {
  return new AbortController().signal;
}

function aborted() {
  const controller = new AbortController();
  controller.abort(new Error("timeout"));
  return controller.signal;
}

function failureOf(result: EmailProviderResult<EmailSent>): EmailProviderFailure {
  if (result.ok) {
    throw new Error("expected a failure");
  }
  return result;
}

describe("FakeEmailProvider", () => {
  let fake: FakeEmailProvider;

  beforeEach(() => {
    fake = new FakeEmailProvider();
  });

  it("is a Nest provider marked for discovery with code fake", async () => {
    expect(Reflect.getMetadata(EMAIL_PROVIDER_METADATA, FakeEmailProvider)).toEqual({
      code: "fake",
    });
    const moduleRef = await Test.createTestingModule({ imports: [providerModule] }).compile();
    const instance = moduleRef.get(FakeEmailProvider);
    expect(instance.code).toBe(FAKE_EMAIL_PROVIDER_CODE);
    expect(instance.capabilities).toEqual({ idempotencyKeys: true, maxRecipients: 1 });
  });

  it("keeps the core email provider contract", async () => {
    const violations = await checkEmailProviderContract(fake, {
      message,
      refusedMessage: { ...message, to: { address: "refused@example.com", displayName: null } },
      observed: () => fake.requests(),
      liveSignal: live,
      abortedSignal: aborted,
    });
    expect(violations).toEqual([]);
  });

  describe("sending", () => {
    it("captures an accepted mail in the mailbox and answers a numbered id", async () => {
      const first = await fake.send(message, { idempotencyKey: KEY }, live());
      expect(first).toEqual({ ok: true, value: { providerMessageId: "fake-email-000001" } });
      const second = await fake.send(
        { ...message, subject: "Another" },
        { idempotencyKey: "key-2" },
        live(),
      );
      expect(second).toEqual({ ok: true, value: { providerMessageId: "fake-email-000002" } });
      expect(fake.mailbox().map((mail) => [mail.providerMessageId, mail.idempotencyKey])).toEqual([
        ["fake-email-000001", KEY],
        ["fake-email-000002", "key-2"],
      ]);
      expect(fake.mailbox()[0]?.message.to.address).toBe("buyer@example.com");
    });

    it("deduplicates by idempotency key: the same body replays the first answer, a new mail is not captured", async () => {
      await fake.send(message, { idempotencyKey: KEY }, live());
      const replay = await fake.send(message, { idempotencyKey: KEY }, live());
      expect(replay).toEqual({ ok: true, value: { providerMessageId: "fake-email-000001" } });
      expect(fake.mailbox()).toHaveLength(1);
      expect(fake.requests()).toHaveLength(2);
    });

    it("refuses another body under a used key as idempotency_conflict, like Resend", async () => {
      await fake.send(message, { idempotencyKey: KEY }, live());
      const result = failureOf(
        await fake.send({ ...message, subject: "Changed" }, { idempotencyKey: KEY }, live()),
      );
      expect(result.reason).toBe("idempotency_conflict");
      expect(result.providerCodes).toEqual(["invalid_idempotent_request"]);
      expect(fake.mailbox()).toHaveLength(1);
    });

    it("refuses a recipient whose local part is refused, with codes only", async () => {
      const result = failureOf(
        await fake.send(
          { ...message, to: { address: "refused@example.com", displayName: null } },
          { idempotencyKey: KEY },
          live(),
        ),
      );
      expect(result).toMatchObject({ reason: "rejected", providerCodes: ["recipient_refused"] });
      expect(fake.mailbox()).toEqual([]);
    });

    it("answers not_sent and makes no request for an aborted signal or an invalid message", async () => {
      const abortedResult = failureOf(await fake.send(message, { idempotencyKey: KEY }, aborted()));
      expect(abortedResult.reason).toBe("not_sent");
      const invalid = failureOf(
        await fake.send(
          { ...message, to: { address: "a@example.com,b@example.com", displayName: null } },
          { idempotencyKey: KEY },
          live(),
        ),
      );
      expect(invalid.reason).toBe("not_sent");
      expect(fake.requests()).toEqual([]);
      expect(fake.mailbox()).toEqual([]);
    });

    it("never puts a message text or an address into a failure", async () => {
      fake.failNext({ reason: "rejected", providerCodes: ["validation_error"] });
      const result = failureOf(await fake.send(message, { idempotencyKey: KEY }, live()));
      expect(JSON.stringify(result)).not.toContain("buyer@example.com");
    });
  });

  describe("failNext", () => {
    it.each(EMAIL_PROVIDER_FAILURE_REASONS)(
      "fails the next send with reason %s",
      async (reason) => {
        fake.failNext({ reason, providerCodes: ["planned"] });
        const result = failureOf(await fake.send(message, { idempotencyKey: KEY }, live()));
        expect(result).toMatchObject({ reason, providerCodes: ["planned"] });
        expect(fake.mailbox()).toEqual([]);
        // One failure only: the next send is accepted.
        expect((await fake.send(message, { idempotencyKey: KEY }, live())).ok).toBe(true);
      },
    );

    it("defaults to unavailable and counts down `times`", async () => {
      fake.failNext({ times: 2 });
      for (const index of [1, 2]) {
        const result = failureOf(
          await fake.send(message, { idempotencyKey: `key-${String(index)}` }, live()),
        );
        expect(result.reason).toBe("unavailable");
      }
      expect((await fake.send(message, { idempotencyKey: "key-3" }, live())).ok).toBe(true);
    });

    it("carries retry-after and the quota period", async () => {
      fake.failNext({ reason: "rate_limited", retryAfterSeconds: 7 });
      expect(failureOf(await fake.send(message, { idempotencyKey: KEY }, live()))).toMatchObject({
        reason: "rate_limited",
        retryAfterSeconds: 7,
      });
      fake.failNext({
        reason: "quota_exceeded",
        quotaPeriod: "daily",
        providerCodes: ["daily_quota_exceeded"],
      });
      expect(failureOf(await fake.send(message, { idempotencyKey: KEY }, live()))).toMatchObject({
        reason: "quota_exceeded",
        quotaPeriod: "daily",
      });
    });

    it("afterEffect accepts the mail but loses the answer; the retry with the same key delivers no second copy", async () => {
      fake.failNext({ afterEffect: true });
      const lost = failureOf(await fake.send(message, { idempotencyKey: KEY }, live()));
      expect(lost.reason).toBe("unavailable");
      expect(fake.mailbox()).toHaveLength(1);
      const retry = await fake.send(message, { idempotencyKey: KEY }, live());
      expect(retry).toEqual({ ok: true, value: { providerMessageId: "fake-email-000001" } });
      expect(fake.mailbox()).toHaveLength(1);
    });

    it("hang never answers until the signal fires, then rejects with its reason", async () => {
      fake.failNext({ hang: true });
      const controller = new AbortController();
      const pending = fake.send(message, { idempotencyKey: KEY }, controller.signal);
      controller.abort(new Error("send timed out"));
      await expect(pending).rejects.toThrow("send timed out");
      expect(fake.mailbox()).toEqual([]);
    });

    it("rejects a bad description at once, so a test cannot plan a failure the port forbids", () => {
      expect(() => fake.failNext({ times: 0 })).toThrow(RangeError);
      expect(() => fake.failNext({ reason: "exploded" as never })).toThrow(/Unknown email failure/);
      expect(() => fake.failNext({ providerCodes: ["a message with spaces"] })).toThrow(RangeError);
      expect(() => fake.failNext({ quotaPeriod: "daily" })).toThrow(RangeError);
      expect(() => fake.failNext({ retryAfterSeconds: -1 })).toThrow(RangeError);
    });
  });

  it("reset forgets the mailbox, the requests, the keys and a planned failure, and restarts the numbering", async () => {
    await fake.send(message, { idempotencyKey: KEY }, live());
    fake.failNext({});
    fake.reset();
    expect(fake.mailbox()).toEqual([]);
    expect(fake.requests()).toEqual([]);
    const again = await fake.send({ ...message, subject: "New" }, { idempotencyKey: KEY }, live());
    expect(again).toEqual({ ok: true, value: { providerMessageId: "fake-email-000001" } });
  });
});

describe("FAKE_EMAIL_CAPTURE_FILE", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fluxkit-fake-email-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is optional: unset and blank mean no file", () => {
    expect(parseFakeEmailCaptureFile({})).toBeUndefined();
    expect(parseFakeEmailCaptureFile({ FAKE_EMAIL_CAPTURE_FILE: "  " })).toBeUndefined();
  });

  it("must be an absolute path, and the error never echoes it", () => {
    expect(parseFakeEmailCaptureFile({ FAKE_EMAIL_CAPTURE_FILE: "/tmp/mails.jsonl" })).toBe(
      "/tmp/mails.jsonl",
    );
    for (const bad of ["relative/mails.jsonl", "/tmp/a\0b"]) {
      let error: Error | undefined;
      try {
        parseFakeEmailCaptureFile({ FAKE_EMAIL_CAPTURE_FILE: bad });
      } catch (caught) {
        error = caught as Error;
      }
      expect(error?.message).toBe("FAKE_EMAIL_CAPTURE_FILE must be an absolute file path.");
    }
  });

  it("appends every accepted mail as one JSON line, a replay adds none", async () => {
    const file = join(dir, "mails.jsonl");
    const fake = new FakeEmailProvider({ captureFile: file });
    await fake.send(message, { idempotencyKey: KEY }, live());
    await fake.send(message, { idempotencyKey: KEY }, live());
    await fake.send({ ...message, subject: "Second" }, { idempotencyKey: "key-2" }, live());
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      providerMessageId: "fake-email-000001",
      idempotencyKey: KEY,
      subject: "Your order",
      to: { address: "buyer@example.com" },
    });
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ subject: "Second" });
  });

  it("the module reads the variable when it builds the provider", async () => {
    const file = join(dir, "module.jsonl");
    process.env.FAKE_EMAIL_CAPTURE_FILE = file;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [providerModule] }).compile();
      await moduleRef.get(FakeEmailProvider).send(message, { idempotencyKey: KEY }, live());
    } finally {
      delete process.env.FAKE_EMAIL_CAPTURE_FILE;
    }
    expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(1);
  });
});
