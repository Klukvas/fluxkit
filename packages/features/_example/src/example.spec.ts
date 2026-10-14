import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExampleFeatureModule } from "./index.js";

// Feature-owned test: runs against the feature module alone, so it disappears together with the feature folder.
describe("example feature", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ExampleFeatureModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    const { port } = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /example/ping responds ok", async () => {
    const response = await fetch(`${baseUrl}/example/ping`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ feature: "example", ok: true });
  });
});
