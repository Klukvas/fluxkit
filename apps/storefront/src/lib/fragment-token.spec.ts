import { describe, expect, it, vi } from "vitest";
import { takeFragmentToken, type FragmentWindow } from "./fragment-token";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

function fakeWindow(hash: string, pathname = "/en/account/reset-password", search = "") {
  const replaceState = vi.fn();
  const win: FragmentWindow = {
    location: { hash, pathname, search },
    history: { state: { marker: "next-router-state" }, replaceState },
  };
  return { win, replaceState };
}

describe("takeFragmentToken", () => {
  it("returns the token of #t= and removes the fragment from the address bar, keeping path, query and history state", () => {
    const { win, replaceState } = fakeWindow(`#t=${TOKEN}`, "/en/account/reset-password", "?a=1");
    expect(takeFragmentToken(win)).toEqual({ kind: "token", token: TOKEN });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(
      { marker: "next-router-state" },
      "",
      "/en/account/reset-password?a=1",
    );
  });

  it("scrubs a malformed fragment too (nothing of it may stay in the address bar) and reports it", () => {
    for (const hash of [
      "#t=short",
      "#t=",
      "#x=1",
      `#t=${TOKEN}&t=${TOKEN}`,
      "#t=a b c d e f g h i j k l",
    ]) {
      const { win, replaceState } = fakeWindow(hash);
      expect(takeFragmentToken(win), hash).toEqual({ kind: "malformed" });
      expect(replaceState, hash).toHaveBeenCalledTimes(1);
      expect(String(replaceState.mock.calls[0]?.[2]), hash).not.toContain("#");
    }
  });

  it("does nothing without a fragment (no history entry is touched)", () => {
    for (const hash of ["", "#"]) {
      const { win, replaceState } = fakeWindow(hash);
      expect(takeFragmentToken(win)).toEqual({ kind: "none" });
      expect(replaceState).not.toHaveBeenCalled();
    }
  });

  it("never puts the token into the URL it writes back", () => {
    const { win, replaceState } = fakeWindow(`#t=${TOKEN}`);
    takeFragmentToken(win);
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain(TOKEN);
  });
});
