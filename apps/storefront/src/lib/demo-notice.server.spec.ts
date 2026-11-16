import { afterEach, describe, expect, it, vi } from "vitest";
import { demoNoticeEnabled } from "./demo-notice.server";

const request = vi.hoisted(() => ({ connection: vi.fn(async () => {}) }));
vi.mock("next/server", () => ({ connection: request.connection }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("runtime demo deployment flag", () => {
  it("waits for the request and reads the current environment on each call", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:3000");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("STOREFRONT_DEMO_NOTICE", "false");
    let connect: () => void = () => {
      throw new Error("connection not started");
    };
    request.connection.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          connect = resolve;
        }),
    );
    const reading = demoNoticeEnabled();
    expect(request.connection).toHaveBeenCalledOnce();
    // If env parsing moves before connection(), this request would return false.
    vi.stubEnv("STOREFRONT_DEMO_NOTICE", "true");
    connect();
    expect(await reading).toBe(true);
    vi.stubEnv("STOREFRONT_DEMO_NOTICE", "false");
    expect(await demoNoticeEnabled()).toBe(false);
    expect(request.connection).toHaveBeenCalledTimes(2);
  });
});
