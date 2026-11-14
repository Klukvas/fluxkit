import {
  Catch,
  Global,
  HttpException,
  Module,
  type ArgumentsHost,
  type ExceptionFilter,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  FEATURE_DATABASE,
  LOCALE_CONFIG,
  MEDIA_PORT,
  ProblemException,
  type FieldError,
  type LocaleConfig,
} from "@fluxkit/api-kit";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import { BlogFeatureModule } from "../index.js";
import { TestMediaPort } from "./media-port.js";

export const MEDIA_BASE_URL = "https://media.example.test/media";

export const TEST_LOCALES: LocaleConfig = Object.freeze({
  defaultLocale: "uk",
  locales: Object.freeze(["uk", "en"]),
});

/** The problem body the specs read: the members the API's problem filter writes. */
export interface ProblemBody {
  status: number;
  code: string;
  detail: string;
  errors?: (FieldError & Record<string, unknown>)[];
  rule?: string;
  field?: string;
}

interface JsonResponse {
  status(code: number): JsonResponse;
  setHeader(name: string, value: string): unknown;
  send(body: string): unknown;
}

/**
 * TEST ONLY: answers a `ProblemException` with the members of the API's problem filter (`apps/api/src/common/
 * problem.filter.ts`, which a feature cannot import), and any other Nest HTTP error with its status, so the specs read
 * feature errors the way a client of the real API does. The real filter is proven with the core fixture feature.
 */
@Catch(HttpException)
class TestProblemFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status = exception.getStatus();
    const body =
      exception instanceof ProblemException
        ? {
            status,
            code: exception.code,
            detail: exception.detail,
            ...(exception.errors === undefined ? {} : { errors: exception.errors }),
            ...exception.extensions,
            ...exception.members,
          }
        : { status, code: status === 404 ? "not_found" : "http_error", detail: exception.message };
    response.status(status).setHeader("content-type", "application/problem+json");
    response.send(JSON.stringify(body));
  }
}

export interface BlogApp {
  readonly app: INestApplication;
  readonly baseUrl: string;
}

/**
 * TEST ONLY: the blog module alone, with the three host tokens the API provides globally (ADR 0049): the scratch database
 * as `FEATURE_DATABASE`, `TestMediaPort` as `MEDIA_PORT` and the locales as `LOCALE_CONFIG`. Without the API's admin guard:
 * `permissions.spec.ts` checks what each route declares; the guard itself is a core spec.
 */
export async function startBlogApp(
  pool: pg.Pool,
  locale: LocaleConfig = TEST_LOCALES,
): Promise<BlogApp> {
  const db = drizzle(pool);

  @Global()
  @Module({
    providers: [
      { provide: FEATURE_DATABASE, useValue: db },
      { provide: MEDIA_PORT, useValue: new TestMediaPort(db, MEDIA_BASE_URL) },
      { provide: LOCALE_CONFIG, useValue: locale },
    ],
    exports: [FEATURE_DATABASE, MEDIA_PORT, LOCALE_CONFIG],
  })
  class TestHostModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestHostModule, BlogFeatureModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalFilters(new TestProblemFilter());
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as { port: number };
  return { app, baseUrl: `http://127.0.0.1:${String(port)}` };
}

export interface CallResult<T> {
  status: number;
  headers: Headers;
  body: T;
}

export async function call<T = ProblemBody>(
  app: BlogApp,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<CallResult<T>> {
  const response = await fetch(`${app.baseUrl}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: (text === "" ? undefined : JSON.parse(text)) as T,
  };
}
