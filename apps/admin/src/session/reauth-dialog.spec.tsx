import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sentinelTranslator } from "../test-helpers";
import { ReauthDialogView } from "./reauth-dialog";

describe("re-sign-in dialog (step 13 review, G12)", () => {
  it("cannot be dismissed with Escape: not dismissible, and its close handler changes nothing", () => {
    const signOuts: string[] = [];
    const dialog = ReauthDialogView({
      t: sentinelTranslator(),
      onSignOut: () => signOuts.push("out"),
      children: null,
    });
    const props = dialog.props as { open: boolean; dismissible: boolean; onClose: () => void };
    expect(props.open).toBe(true);
    // `Dialog` calls onClose for Escape only when dismissible; here it re-opens itself instead (packages/ui dialog.tsx).
    expect(props.dismissible).toBe(false);
    expect(props.onClose()).toBeUndefined();
    expect(signOuts).toEqual([]);
  });
});

describe("the shell's re-sign-in dialog is the tested view (source guard)", () => {
  it("renders ReauthDialogView", () => {
    const source = readFileSync(join(import.meta.dirname, "reauth-dialog.tsx"), "utf8");
    const dialog = source.slice(source.indexOf("export function ReauthDialog()"));
    expect(dialog).toContain("<ReauthDialogView");
    expect(dialog).not.toContain("<Dialog");
  });
});
