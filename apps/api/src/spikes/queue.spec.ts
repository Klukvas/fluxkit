import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { requireEnv } from "../test/env.js";

// Spike: confirms BullMQ works against the Redis server we will run (Redis 8 in CI, see docs/dependencies.md).
describe("BullMQ spike", () => {
  const connection = new Redis(requireEnv("REDIS_URL"), { maxRetriesPerRequest: null });
  const queueName = `fluxkit-spike-${Date.now()}`;
  const queue = new Queue(queueName, { connection });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    connection.disconnect();
  });

  it("processes a job end to end", async () => {
    let resolveProcessed: (text: string) => void = () => undefined;
    const processed = new Promise<string>((resolve) => {
      resolveProcessed = resolve;
    });
    const worker = new Worker<{ text: string }>(
      queueName,
      async (job) => {
        resolveProcessed(job.data.text);
      },
      { connection },
    );
    try {
      await queue.add("ping", { text: "pong" });
      expect(await processed).toBe("pong");
    } finally {
      await worker.close();
    }
  });
});
