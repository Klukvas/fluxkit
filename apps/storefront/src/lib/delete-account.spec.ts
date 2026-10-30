import { NetworkError, type ProblemDetails, type StoreFailure } from "@fluxkit/api-client";
import { describe, expect, it, vi } from "vitest";
import { runAccountDeletion, type AccountDeletionEffects } from "./delete-account";

/**
 * The deletion flow of the "Your data" page without a browser (privacy UI review F3, F5). The API client is the external
 * boundary and is stubbed; everything the flow decides is the code under test.
 */

function refusal(
  status: number,
  extra: Record<string, unknown> = {},
  retryAfter: string | null = null,
): StoreFailure {
  return {
    ok: false,
    status,
    retryAfter,
    problem: {
      type: "about:blank",
      title: "t",
      status,
      code: "validation_failed",
      detail: "SECRET-ENGLISH-DETAIL",
      ...extra,
    } as ProblemDetails,
  };
}

function effects(): AccountDeletionEffects {
  return {
    setBlocked: vi.fn(),
    setLimited: vi.fn(),
    clearPassword: vi.fn(),
    clearAll: vi.fn(),
    sessionEnded: vi.fn(),
    leave: vi.fn(),
  };
}

function setup(answer: () => Promise<unknown>, typed = "DELETE") {
  const deleteAccount = vi.fn(answer);
  const hooks = effects();
  const run = () =>
    runAccountDeletion({
      values: { password: "a long password 123", confirmWord: typed },
      expectedWord: "DELETE",
      client: { deleteAccount } as never,
      effects: hooks,
      callOptions: undefined,
    });
  return { deleteAccount, hooks, run };
}

describe("the typed word", () => {
  it("sends nothing and keeps the password for a WRONG word, and sends the deletion for the RIGHT one", async () => {
    const wrong = setup(() => Promise.resolve({ ok: true, status: 204, data: undefined }), "KEEP");
    const failure = await wrong.run();
    expect(wrong.deleteAccount).not.toHaveBeenCalled();
    expect(failure?.fieldErrors).toEqual([
      {
        path: "confirmWord",
        code: "invalid",
        messageKey: "account.data.delete.wordMismatch",
      },
    ]);
    expect(wrong.hooks.leave).not.toHaveBeenCalled();
    expect(wrong.hooks.clearPassword).not.toHaveBeenCalled();

    const right = setup(() => Promise.resolve({ ok: true, status: 204, data: undefined }));
    expect(await right.run()).toBeNull();
    expect(right.deleteAccount).toHaveBeenCalledTimes(1);
    expect(right.deleteAccount).toHaveBeenCalledWith(
      { password: "a long password 123", confirm: true },
      undefined,
    );
  });

  it("accepts the word in another case and with spaces around it, like the form says", async () => {
    const { deleteAccount, run } = setup(
      () => Promise.resolve({ ok: true, status: 204, data: undefined }),
      "  delete ",
    );
    await run();
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });
});

describe("after the deletion succeeded", () => {
  it("clears both fields and leaves for the confirmation page", async () => {
    const { hooks, run } = setup(() => Promise.resolve({ ok: true, status: 204, data: undefined }));
    expect(await run()).toBeNull();
    expect(hooks.clearAll).toHaveBeenCalledTimes(1);
    expect(hooks.leave).toHaveBeenCalledTimes(1);
  });
});

describe("the password leaves the form after every failed answer (privacy UI review F3)", () => {
  const wrongPassword = () => Promise.resolve(refusal(400, { code: "validation_failed" }));
  const signedOut = () => Promise.resolve(refusal(401, { code: "unauthorized" }));
  const blockedAnswer = () =>
    Promise.resolve(
      refusal(409, { code: "rule_violation", rule: "erasure_blocked", reasons: ["open_order"] }),
    );
  const limitedAnswer = () => Promise.resolve(refusal(429, { code: "too_many_requests" }, "120"));
  const serverError = () => Promise.resolve(refusal(500, { code: "internal_error" }));
  const lostAnswer = () =>
    Promise.reject(new NetworkError("down", { cause: new TypeError("x"), aborted: false }));
  const answers: [string, () => Promise<unknown>][] = [
    ["a wrong password (400)", wrongPassword],
    ["a signed-out session (401)", signedOut],
    ["blockers (409 erasure_blocked)", blockedAnswer],
    ["the daily limit (429)", limitedAnswer],
    ["a server error (500)", serverError],
    ["a lost answer (the call throws)", lostAnswer],
  ];

  for (const [name, answer] of answers) {
    it(`clears the password and leaves the page alone after ${name}`, async () => {
      const { hooks, run } = setup(answer);
      const failure = await run();
      expect(failure, name).not.toBeNull();
      expect(hooks.clearPassword, name).toHaveBeenCalledTimes(1);
      expect(hooks.clearAll, name).not.toHaveBeenCalled();
      expect(hooks.leave, name).not.toHaveBeenCalled();
    });
  }

  it("shows the blockers, and the wait of a limit, and ends a signed-out session", async () => {
    const blocked = setup(blockedAnswer);
    expect((await blocked.run())?.messageKey).toBe("account.data.blocked.title");
    expect(blocked.hooks.setBlocked).toHaveBeenLastCalledWith(["open_order"]);

    const limited = setup(limitedAnswer);
    expect((await limited.run())?.messageKey).toBe("account.data.delete.limited");
    expect(limited.hooks.setLimited).toHaveBeenLastCalledWith({ unit: "minutes", count: 2 });

    const ended = setup(signedOut);
    expect((await ended.run())?.messageKey).toBe("account.gate.redirecting");
    expect(ended.hooks.sessionEnded).toHaveBeenCalledTimes(1);
  });

  it("resets the blockers and the limit before every attempt", async () => {
    const { hooks, run } = setup(blockedAnswer);
    await run();
    expect(hooks.setBlocked).toHaveBeenNthCalledWith(1, null);
    expect(hooks.setLimited).toHaveBeenNthCalledWith(1, undefined);
  });
});
