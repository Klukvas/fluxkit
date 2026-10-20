import { PERMISSIONS, ROLES } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { messagesForArea } from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { USER_ACTIONS } from "./user-actions";
import { permissionLabelKey, roleLabelKey, statusLabelKey } from "./user-view";

/** Message keys the users area builds from data (the messages spec only sees literal keys). */
const BUILT_KEYS = [
  ...ROLES.map((role) => roleLabelKey(role)),
  ...PERMISSIONS.map((permission) => permissionLabelKey(permission)),
  statusLabelKey(true),
  statusLabelKey(false),
  ...USER_ACTIONS.map((action) => `user.notice.done.${action}`),
  "user.notice.done.resetPasswordSelf",
  ...USER_ACTIONS.map((action) => `user.notice.refused.${action}`),
  ...[
    "now_deactivated",
    "still_active",
    "now_active",
    "still_deactivated",
    "password_unknown",
    "unreadable",
    "roleChanged",
    "roleUnchanged",
  ].map((state) => `user.notice.unknown.${state}`),
  ...["losesUsersArea", "signedOutCannotSignIn", "signedOutSignInAgain"].map(
    (consequence) => `user.self.${consequence}`,
  ),
  ...["last_owner_cannot_be_demoted", "last_owner_cannot_be_deactivated"].map(
    (rule) => `user.refusal.${rule}`,
  ),
  ...["found", "absent", "notChecked", "unreadable"].map((kind) => `user.create.unknown.${kind}`),
];

describe("users messages built from data", () => {
  it("exist in uk and en within the files the area loads", async () => {
    for (const locale of ["uk", "en"] as const) {
      const messages = await messagesForArea(locale, MESSAGE_FILES);
      for (const key of BUILT_KEYS) expect(key in messages, `${locale}: ${key}`).toBe(true);
    }
  });

  it("loads only its own file", () => {
    expect(MESSAGE_FILES).toEqual(["users"]);
  });
});
