import { Agent, get, type Server } from "node:http";
import { Module, type OnModuleDestroy, type OnApplicationShutdown } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { describe, expect, it, vi } from "vitest";
import { DrainingExpressAdapter } from "./draining-express-adapter.js";

function deferred() {
  let resolve: () => void = () => {
    throw new Error("deferred not initialized");
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function request(url: string, agent?: Agent): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get(url, { agent: agent ?? false }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    }).on("error", reject);
  });
}

describe("HTTP drain before Nest lifecycle teardown", () => {
  it.each(["close", "SIGTERM"])(
    "finishes an in-flight request before hooks on %s",
    async (mode) => {
      const arrived = deferred();
      const release = deferred();
      const stopped = deferred();
      let destroyed = false;
      let finished = false;
      @Module({})
      class TestModule implements OnModuleDestroy, OnApplicationShutdown {
        onModuleDestroy(): void {
          expect(finished).toBe(true);
          destroyed = true;
        }
        onApplicationShutdown(): void {
          stopped.resolve();
        }
      }
      const app = await NestFactory.create<NestExpressApplication>(
        TestModule,
        new DrainingExpressAdapter(),
        { logger: false },
      );
      app.use("/idle", (_req: unknown, res: { end: () => void }) => res.end());
      app.use("/drain", async (_req: unknown, res: { end: (body: string) => void }) => {
        arrived.resolve();
        await release.promise;
        expect(destroyed).toBe(false);
        finished = true;
        res.end("ok");
      });
      await app.listen(0, "127.0.0.1");
      const server: Server = app.getHttpServer();
      const url = await app.getUrl();
      const idle = new Agent({ keepAlive: true });
      const kill = vi.spyOn(process, "kill").mockReturnValue(true);
      let closing: Promise<void> | undefined;
      try {
        await request(`${url}/idle`, idle);
        const inFlight = request(`${url}/drain`);
        await arrived.promise;
        if (mode === "SIGTERM") {
          app.enableShutdownHooks(["SIGTERM"]);
          process.emit("SIGTERM", "SIGTERM");
        } else {
          closing = app.close();
        }
        // Nest awaits initialization before beforeClose; wait until close() has stopped the listener.
        await vi.waitFor(() => expect(server.listening).toBe(false));
        expect(destroyed).toBe(false);
        await expect(request(`${url}/drain`)).rejects.toMatchObject({ code: "ECONNREFUSED" });
        release.resolve();
        expect(await inFlight).toBe(200);
        await stopped.promise;
        await closing;
        expect(destroyed).toBe(true);
        if (mode === "SIGTERM") {
          await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM"));
        }
      } finally {
        release.resolve();
        idle.destroy();
        await app.close();
        kill.mockRestore();
      }
    },
  );

  it("closes even while a keep-alive client keeps sending requests (a proxy under load)", async () => {
    @Module({})
    class TestModule {}
    const app = await NestFactory.create<NestExpressApplication>(
      TestModule,
      new DrainingExpressAdapter(),
      { logger: false },
    );
    app.use("/busy", (_req: unknown, res: { end: (body: string) => void }) => {
      setTimeout(() => res.end("ok"), 10);
    });
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    const busy = new Agent({ keepAlive: true, maxSockets: 1 });
    let sending = true;
    let answered = 0;
    let closeAnswers = 0;
    const loop = (async () => {
      while (sending) {
        await new Promise<void>((resolve) => {
          get(`${url}/busy`, { agent: busy }, (response) => {
            if (response.headers.connection === "close") closeAnswers += 1;
            response.resume();
            response.on("end", () => {
              answered += 1;
              resolve();
            });
          }).on("error", () => {
            // The listener is closed: a new connection is refused, which ends the loop.
            sending = false;
            resolve();
          });
        });
      }
    })();
    try {
      await vi.waitFor(() => expect(answered).toBeGreaterThan(3), { timeout: 5000 });
      const started = Date.now();
      await app.close();
      // Without the Connection: close answers, close() waits until the client stops (here: never; Docker would SIGKILL).
      expect(Date.now() - started).toBeLessThan(5000);
      // The loop ends at the refused connection that follows the last answer.
      await loop;
      expect(closeAnswers).toBeGreaterThan(0);
    } finally {
      sending = false;
      await loop;
      busy.destroy();
    }
  });
});
