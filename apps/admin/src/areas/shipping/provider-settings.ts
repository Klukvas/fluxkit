import type { JsonObject, ProblemDetails } from "@fluxkit/api-client";
import { issue } from "../catalog-dictionaries/form-rules";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { describeShippingReason } from "./shipping-errors";

/**
 * The non-secret profile of a carrier (sender data, a default parcel; `docs/api/shipping.md`, "Shipping providers") is a
 * bounded JSON object the admin edits as text. The API validates its shape and refuses credential-like keys; the checks
 * here are only what is true of any JSON object, so a typo is caught before a request. API keys are never entered here:
 * they are environment variables of the server.
 */

/** The API's bound on the profile as JSON (`too_large`): 16 KiB. */
export const SETTINGS_MAX_BYTES = 16 * 1024;

export function settingsToText(settings: JsonObject): string {
  return JSON.stringify(settings, null, 2);
}

export type SettingsParse =
  { ok: true; settings: JsonObject } | { ok: false; issue: MessageDescriptor };

export function parseSettingsText(text: string): SettingsParse {
  if (text.trim() === "") return { ok: false, issue: issue("errors.reason.required") };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // Only a malformed text is expected here; the engine's own message is English and is never shown.
    if (error instanceof SyntaxError)
      return { ok: false, issue: issue("ship.settings.invalidJson") };
    throw error;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, issue: issue("ship.reason.not_an_object") };
  }
  if (new TextEncoder().encode(JSON.stringify(parsed)).length > SETTINGS_MAX_BYTES) {
    return { ok: false, issue: issue("ship.reason.too_large") };
  }
  return { ok: true, settings: parsed as JsonObject };
}

export interface SettingsIssue {
  /** The path the API names (`settings.sender.apiKey`), shown as data. */
  path: string;
  descriptor: MessageDescriptor;
}

/** The most issues listed at once (the API can report one per key of a large object). */
export const MAX_LISTED_ISSUES = 20;

/** The `errors[]` of a refused save, each with its friendly reason; at most `MAX_LISTED_ISSUES`. */
export function settingsIssuesFromProblem(problem: ProblemDetails): SettingsIssue[] {
  return (problem.errors ?? []).slice(0, MAX_LISTED_ISSUES).map((error) => ({
    path: error.path,
    descriptor: describeShippingReason(error.code),
  }));
}
