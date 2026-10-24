import { InvalidResponseError } from "./errors.js";
import type { ProblemDetails } from "./types.js";

/** What the parser needs to know about an operation. */
export interface OperationResponseSpec {
  /** The success statuses the OpenAPI document lists for the operation. */
  successStatuses: readonly number[];
  /** `METHOD /path/template`, used in error messages. Never include a filled URL or a body. */
  context: string;
  /** `pdf`: a success carries `application/pdf` and is handed out as a `Blob` (the shipment label). Default `json`. */
  responseKind?: "json" | "pdf";
}

export interface StoreSuccess<T> {
  ok: true;
  /** The exact status, for example 201 for a new order and 200 for a replay. */
  status: number;
  /** `undefined` for 204. */
  data: T;
}

export interface StoreFailure {
  ok: false;
  status: number;
  problem: ProblemDetails;
  /** Raw `Retry-After` header (seconds) of a 429 or 503, `null` when absent. */
  retryAfter: string | null;
}

/** Either the documented success, or a problem the API answered on purpose. Anything else is thrown. */
export type StoreResult<T> = StoreSuccess<T> | StoreFailure;

function mediaType(response: Response): string {
  return (response.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

async function readJson(response: Response, spec: OperationResponseSpec): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new InvalidResponseError(`${spec.context}: the response body is not valid JSON.`, {
      status: response.status,
      cause,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProblem(value: unknown): value is ProblemDetails {
  if (!isRecord(value)) return false;
  const stringsOk = (["type", "title", "code", "detail"] as const).every(
    (key) => typeof value[key] === "string",
  );
  const errorsOk =
    value.errors === undefined ||
    (Array.isArray(value.errors) &&
      value.errors.every(
        (entry: unknown) =>
          isRecord(entry) && typeof entry.path === "string" && typeof entry.code === "string",
      ));
  const cartOk =
    value.cart === undefined || (isRecord(value.cart) && Array.isArray(value.cart.lines));
  return stringsOk && typeof value.status === "number" && errorsOk && cartOk;
}

/**
 * Turns a `fetch` response into a documented result. The documented success statuses give `{ ok: true }`; a 4xx or 5xx
 * with `application/problem+json` gives `{ ok: false, problem }`. Everything else (a proxy's HTML error page, a wrong
 * content type, invalid JSON, a status the document does not list, a redirect) throws `InvalidResponseError`: there is
 * no silent fallback. The body is never put in a message.
 */
export async function parseResponse<T>(
  spec: OperationResponseSpec,
  response: Response,
): Promise<StoreResult<T>> {
  const { status } = response;

  if (spec.successStatuses.includes(status)) {
    if (status === 204) return { ok: true, status, data: undefined as T };
    if (spec.responseKind === "pdf") {
      // The one file answer: anything but a PDF (an HTML error page of a proxy) is not handed out as the file.
      if (mediaType(response) !== "application/pdf") {
        throw new InvalidResponseError(`${spec.context}: status ${status} without a PDF body.`, {
          status,
        });
      }
      return { ok: true, status, data: (await response.blob()) as T };
    }
    if (mediaType(response) !== "application/json") {
      throw new InvalidResponseError(`${spec.context}: status ${status} without a JSON body.`, {
        status,
      });
    }
    const data = await readJson(response, spec);
    if (!isRecord(data)) {
      throw new InvalidResponseError(`${spec.context}: the JSON body is not an object.`, {
        status,
      });
    }
    return { ok: true, status, data: data as T };
  }

  if (status >= 400 && status <= 599) {
    if (mediaType(response) !== "application/problem+json") {
      throw new InvalidResponseError(
        `${spec.context}: error status ${status} without a problem body.`,
        {
          status,
        },
      );
    }
    const problem = await readJson(response, spec);
    if (!isProblem(problem)) {
      throw new InvalidResponseError(`${spec.context}: the problem body is malformed.`, { status });
    }
    return { ok: false, status, problem, retryAfter: response.headers.get("Retry-After") };
  }

  throw new InvalidResponseError(`${spec.context}: unexpected status ${status}.`, { status });
}
