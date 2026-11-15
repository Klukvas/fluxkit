import type { OnModuleInit, OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";

/** One connection per API process, created only for shared windows. Never buffers requests during reconnect. */
export class RedisClient implements OnModuleInit, OnApplicationShutdown {
  readonly client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, {
      lazyConnect: false,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      commandTimeout: 3000,
      maxRetriesPerRequest: 0,
    });
    // Transport errors may contain credentials or addresses. The store reports only its fixed error code.
    this.client.on("error", () => undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        const ready = (): void => {
          cleanup();
          resolve();
        };
        const failed = (): void => {
          cleanup();
          reject(new Error("rate_limit_redis_boot_unavailable"));
        };
        const timer = setTimeout(failed, 3000);
        const cleanup = (): void => {
          clearTimeout(timer);
          this.client.off("ready", ready);
          this.client.off("error", failed);
        };
        if (this.client.status === "ready") {
          cleanup();
          resolve();
          return;
        }
        this.client.once("ready", ready);
        this.client.once("error", failed);
      });
      await this.client.ping();
    } catch {
      this.client.disconnect();
      throw new Error("rate_limit_redis_boot_unavailable");
    }
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
