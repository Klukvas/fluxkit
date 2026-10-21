import type { AdminMe, AdminResult } from "@fluxkit/api-client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSignalHub } from "../lib/session-signals";
import type { SessionEvent } from "./session-model";
import { createSessionSync } from "./session-sync";

const owner: AdminMe = {
  user: { id: "u1", email: "u1@example.com", role: "owner", isActive: true, lastLoginAt: null },
  permissions: ["users.manage"],
};

/** The sync on a real signal hub, with `GET /admin/auth/me` answered by hand. */
function harness() {
  const events: SessionEvent[] = [];
  const reads: ((result: AdminResult<AdminMe>) => void)[] = [];
  const sync = createSessionSync(
    () =>
      new Promise((answer) => {
        reads.push(answer);
      }),
    (event) => events.push(event),
  );
  const hub = createSignalHub();
  hub.subscribe(sync.onSignal);
  return { sync, hub, events, reads };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("createSessionSync (step 13 review, G14)", () => {
  it("reads me again after a 403 and applies the answer (a role changed meanwhile)", async () => {
    const { hub, events, reads } = harness();
    hub.emit("forbidden");
    expect(reads).toHaveLength(1);
    reads[0]?.({ ok: true, status: 200, data: owner });
    await settle();
    expect(events).toEqual([{ type: "meLoaded", me: owner }]);
  });

  it("reads me once for several 403s while a read runs, and again after it settled", async () => {
    const { hub, reads } = harness();
    hub.emit("forbidden");
    hub.emit("forbidden");
    expect(reads).toHaveLength(1);
    reads[0]?.({ ok: true, status: 200, data: owner });
    await settle();
    hub.emit("forbidden");
    expect(reads).toHaveLength(2);
  });

  it("ends the session on a 401 without reading me, and on a 401 answer of the read", async () => {
    const { hub, events, reads, sync } = harness();
    hub.emit("unauthorized");
    expect(reads).toHaveLength(0);
    expect(events).toEqual([{ type: "unauthorized" }]);
    sync.reloadMe();
    reads[0]?.({
      ok: false,
      status: 401,
      problem: { type: "about:blank", title: "t", detail: "d", status: 401, code: "unauthorized" },
      retryAfter: null,
    });
    await settle();
    expect(events).toEqual([{ type: "unauthorized" }, { type: "meUnauthorized" }]);
  });
});

describe("the session provider uses the tested sync (source guard)", () => {
  it("subscribes the sync to the signal hub of every request and reloads me through it", () => {
    const provider = readFileSync(join(import.meta.dirname, "session-context.tsx"), "utf8");
    expect(provider).toContain("createSessionSync(() => adminClient.getMe(), dispatch)");
    expect(provider).toContain("useEffect(() => sessionSignals.subscribe(sync.onSignal), [sync]);");
    expect(provider).toContain("const reloadMe = sync.reloadMe;");
  });
});
