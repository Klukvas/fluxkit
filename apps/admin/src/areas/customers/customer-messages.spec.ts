import { describe, expect, it } from "vitest";
import { messagesForArea } from "../../test-helpers";
import { CUSTOMER_ACTIONS } from "./customer-actions";
import { MESSAGE_FILES } from "./index";

/** Message keys the customers area builds from data (the messages spec only sees literal keys). */
const BUILT_KEYS = [
  ...["active", "deactivated"].map((status) => `customer.status.${status}`),
  ...["locked", "notLocked"].map((state) => `customer.lock.${state}`),
  ...CUSTOMER_ACTIONS.map((action) => `customer.action.${action}`),
  ...CUSTOMER_ACTIONS.map((action) => `customer.action.${action}Hint`),
  ...CUSTOMER_ACTIONS.map((action) => `customer.notice.done.${action}`),
  ...CUSTOMER_ACTIONS.map((action) => `customer.notice.refused.${action}`),
  ...[
    "now_deactivated",
    "still_active",
    "now_active",
    "still_deactivated",
    "not_locked",
    "still_locked",
    "unreadable",
  ].map((state) => `customer.notice.unknown.${state}`),
];

describe("customers messages built from data", () => {
  it("exist in uk and en within the files the area loads", async () => {
    for (const locale of ["uk", "en"] as const) {
      const messages = await messagesForArea(locale, MESSAGE_FILES);
      for (const key of BUILT_KEYS) expect(key in messages, `${locale}: ${key}`).toBe(true);
    }
  });

  it("loads only its own file", () => {
    expect(MESSAGE_FILES).toEqual(["customers"]);
  });
});
