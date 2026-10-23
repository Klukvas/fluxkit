import type { AdminMe } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { initialSessionState, sessionReducer, type SessionState } from "./session-model";

const me = (id: string, permissions: AdminMe["permissions"] = ["catalog.read"]): AdminMe => ({
  user: { id, email: `${id}@example.com`, role: "viewer", isActive: true, lastLoginAt: null },
  permissions,
});

const signedIn = (user = me("u1")): SessionState =>
  sessionReducer(initialSessionState, { type: "meLoaded", me: user });

describe("session model", () => {
  it("starts loading and signs in with GET /admin/auth/me", () => {
    expect(initialSessionState.status).toBe("loading");
    const state = signedIn();
    expect(state.status).toBe("signedIn");
    expect(state.me?.user.id).toBe("u1");
    expect(state.redirect).toBeNull();
  });

  it("shows sign-in when the first me answers 401", () => {
    const state = sessionReducer(initialSessionState, { type: "meUnauthorized" });
    expect(state.status).toBe("signedOut");
    expect(state.me).toBeNull();
  });

  it("keeps a failed first load retryable instead of pretending to be signed out", () => {
    const failed = sessionReducer(initialSessionState, {
      type: "meFailed",
      failure: { kind: "network" },
    });
    expect(failed.status).toBe("failed");
    expect(sessionReducer(failed, { type: "retry" }).status).toBe("loading");
  });

  it("turns any 401 while signed in into the re-sign-in state, keeping the user and the page", () => {
    const before = signedIn();
    const expired = sessionReducer(before, { type: "unauthorized" });
    expect(expired.status).toBe("expired");
    expect(expired.me).toBe(before.me);
    expect(expired.generation).toBe(before.generation);
    expect(expired.redirect).toBeNull();
    // A reload of me that answers 401 does the same.
    expect(sessionReducer(before, { type: "meUnauthorized" }).status).toBe("expired");
  });

  it("does not open the dialog for a 401 while signed out or loading", () => {
    const out = sessionReducer(initialSessionState, { type: "meUnauthorized" });
    expect(sessionReducer(out, { type: "unauthorized" }).status).toBe("signedOut");
    expect(sessionReducer(initialSessionState, { type: "unauthorized" }).status).toBe("loading");
  });

  it("continues on the same page when the same user signs in again", () => {
    const expired = sessionReducer(signedIn(), { type: "unauthorized" });
    const again = sessionReducer(expired, { type: "meLoaded", me: me("u1", ["orders.read"]) });
    expect(again.status).toBe("signedIn");
    expect(again.generation).toBe(expired.generation);
    expect(again.redirect).toBeNull();
    expect(again.me?.permissions).toEqual(["orders.read"]);
  });

  it("drops all state and goes to the start page when a different user signs in", () => {
    const expired = sessionReducer(signedIn(), { type: "unauthorized" });
    const other = sessionReducer(expired, { type: "meLoaded", me: me("u2") });
    expect(other.status).toBe("signedIn");
    expect(other.me?.user.id).toBe("u2");
    expect(other.generation).toBe(expired.generation + 1);
    expect(other.redirect?.to).toBe("/");
  });

  it("also resets when a reload of me (after a 403) shows another user", () => {
    const state = sessionReducer(signedIn(), { type: "meLoaded", me: me("u2") });
    expect(state.redirect?.to).toBe("/");
  });

  it("keeps the page when a background reload of me fails", () => {
    const before = signedIn();
    const after = sessionReducer(before, { type: "meFailed", failure: { kind: "timeout" } });
    expect(after).toBe(before);
  });

  it("drops everything on sign-out and goes to the sign-in page", () => {
    const before = signedIn();
    const out = sessionReducer(before, { type: "signedOut" });
    expect(out.status).toBe("signedOut");
    expect(out.me).toBeNull();
    expect(out.generation).toBe(before.generation + 1);
    expect(out.redirect?.to).toBe("/login");
    const next = sessionReducer(out, { type: "signedOut" });
    expect(next.redirect?.id).not.toBe(out.redirect?.id);
  });
});
