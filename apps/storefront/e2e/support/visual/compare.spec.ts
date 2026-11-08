import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  alwaysAbsentSelectors,
  applyExceptions,
  diffSnapshots,
  formatComparison,
} from "./compare.ts";
import { ExceptionsError, ownExceptions, parseExceptions, screenshotMasks } from "./exceptions.ts";
import {
  COMPUTED_PROPERTIES,
  fragment,
  fragmentFileName,
  loadSnapshot,
  mergeFragments,
  type ElementStyles,
  type Snapshot,
} from "./snapshot.ts";

function styles(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...Object.fromEntries(COMPUTED_PROPERTIES.map((property) => [property, "0px"])),
    ...overrides,
  };
}

function snapshot(pages: Record<string, Record<string, Record<string, ElementStyles>>>): Snapshot {
  return mergeFragments(
    Object.entries(pages).flatMap(([page, themes]) =>
      Object.entries(themes).map(([theme, entries]) =>
        fragment(page, theme, `/uk/${page}`, entries),
      ),
    ),
  );
}

const base = () =>
  snapshot({
    home: {
      light: { "main.h1": styles({ "font-size": "30px" }), "feedback.alert": null },
      dark: { "main.h1": styles({ color: "rgb(255, 255, 255)" }), "feedback.alert": null },
    },
    cart: { light: { "button.primary": styles({ "border-top-left-radius": "6px" }) } },
  });

describe("diffSnapshots", () => {
  it("finds nothing when both sides are equal", () => {
    expect(diffSnapshots(base(), base())).toEqual([]);
  });

  it("reports every changed property with page, theme, selector, before and after", () => {
    const after = base();
    (after.pages["cart"]?.["light"]?.["button.primary"] as Record<string, string>)[
      "border-top-left-radius"
    ] = "8px";
    (after.pages["home"]?.["dark"]?.["main.h1"] as Record<string, string>)["font-family"] =
      "Georgia";
    expect(diffSnapshots(base(), after)).toEqual([
      {
        page: "cart",
        theme: "light",
        selector: "button.primary",
        property: "border-top-left-radius",
        before: "6px",
        after: "8px",
      },
      {
        page: "home",
        theme: "dark",
        selector: "main.h1",
        property: "font-family",
        before: "0px",
        after: "Georgia",
      },
    ]);
  });

  it("reports an element found on one side only as a presence difference", () => {
    const after = base();
    (after.pages["home"]?.["light"] as Record<string, ElementStyles>)["feedback.alert"] = styles();
    (after.pages["home"]?.["dark"] as Record<string, ElementStyles>)["main.h1"] = null;
    expect(diffSnapshots(base(), after)).toEqual([
      {
        page: "home",
        theme: "dark",
        selector: "main.h1",
        property: "presence",
        before: "present",
        after: "absent",
      },
      {
        page: "home",
        theme: "light",
        selector: "feedback.alert",
        property: "presence",
        before: "absent",
        after: "present",
      },
    ]);
  });

  it("reports a page or theme recorded on one side only", () => {
    const after = base();
    delete after.pages["cart"];
    expect(diffSnapshots(base(), after)).toEqual([
      {
        page: "cart",
        theme: "light",
        selector: "*",
        property: "*",
        before: "present",
        after: "not recorded",
      },
    ]);
  });

  it("refuses snapshots of different harness versions", () => {
    const after = { ...base(), selectorListVersion: 99 };
    expect(() => diffSnapshots(base(), after)).toThrow(/same harness/);
    const fewer = { ...base(), properties: ["color"] };
    expect(() => diffSnapshots(base(), fewer)).toThrow(/same harness/);
  });
});

describe("parseExceptions", () => {
  const valid = {
    page: "home",
    selector: "home.hero",
    property: "*",
    reason: "B4: neutral demo hero picture",
  };

  it("accepts entries with a reason, an optional theme and the special properties", () => {
    expect(
      parseExceptions([
        valid,
        { ...valid, page: "*", property: "presence" },
        { ...valid, theme: "dark", property: "background-color" },
        { ...valid, property: "screenshot" },
      ]),
    ).toHaveLength(4);
  });

  it.each([
    [{ ...valid, reason: "  " }, /"reason" must be a non-empty string/],
    [{ page: "home", selector: "home.hero", property: "*" }, /"reason"/],
    [{ ...valid, why: "x" }, /unknown field "why"/],
    [{ ...valid, page: "homepage" }, /unknown page "homepage"/],
    [{ ...valid, selector: ".rounded-md" }, /unknown selector/],
    [{ ...valid, property: "border-radius" }, /unknown property "border-radius"/],
    [{ ...valid, theme: "sepia" }, /"theme" must be one of/],
    ["home", /must be an object/],
  ])("rejects %j", (entry, message) => {
    expect(() => parseExceptions([entry])).toThrow(ExceptionsError);
    expect(() => parseExceptions([entry])).toThrow(message);
  });

  it("rejects a non-array and duplicates", () => {
    expect(() => parseExceptions({ exceptions: [] })).toThrow(/JSON array/);
    expect(() => parseExceptions([valid, { ...valid, reason: "again" }])).toThrow(/duplicate/);
  });

  it("gives the screenshot masks of one page and theme", () => {
    const exceptions = parseExceptions([
      { ...valid, property: "screenshot" },
      { ...valid, page: "*", selector: "home.banner-card", property: "screenshot" },
      { ...valid, selector: "card.article", property: "screenshot", theme: "dark" },
      { ...valid, selector: "main.h1", property: "color" },
    ]);
    expect(screenshotMasks(exceptions, "home", "light")).toEqual(["home.hero", "home.banner-card"]);
    expect(screenshotMasks(exceptions, "home", "dark")).toEqual([
      "home.hero",
      "home.banner-card",
      "card.article",
    ]);
    expect(screenshotMasks(exceptions, "catalog", "light")).toEqual(["home.banner-card"]);
  });

  it("keeps only the entries a PR added (an inherited entry declares nothing, even with a new reason)", () => {
    const inherited = parseExceptions([
      { ...valid, reason: "an earlier PR" },
      { ...valid, selector: "main.h1", property: "color", reason: "an earlier PR" },
    ]);
    const current = parseExceptions([
      { ...valid, reason: "reworded by this PR" },
      { ...valid, selector: "main.h1", property: "color", theme: "dark", reason: "this PR" },
      { ...valid, selector: "card.article", property: "screenshot", reason: "this PR" },
    ]);
    expect(ownExceptions(current, inherited).map((entry) => entry.selector)).toEqual([
      "main.h1",
      "card.article",
    ]);
    expect(ownExceptions(current, [])).toHaveLength(3);
  });
});

describe("alwaysAbsentSelectors", () => {
  it("lists selectors that found nothing anywhere on either side", () => {
    const after = base();
    (after.pages["cart"]?.["light"] as Record<string, ElementStyles>)["home.hero"] = null;
    expect(alwaysAbsentSelectors(base(), after)).toEqual(["feedback.alert", "home.hero"]);
    (after.pages["home"]?.["dark"] as Record<string, ElementStyles>)["feedback.alert"] = styles();
    expect(alwaysAbsentSelectors(base(), after)).toEqual(["home.hero"]);
    expect(formatComparison(applyExceptions([], []), ["home.hero"])).toMatch(
      /Warning: selectors absent on every page, theme and side \(they prove nothing\): home\.hero/,
    );
  });
});

describe("applyExceptions and formatComparison", () => {
  const after = () => {
    const changed = base();
    (changed.pages["cart"]?.["light"]?.["button.primary"] as Record<string, string>)[
      "border-top-left-radius"
    ] = "8px";
    (changed.pages["home"]?.["light"]?.["main.h1"] as Record<string, string>)["color"] = "red";
    return changed;
  };

  it("declares only matching differences and lists unused exceptions", () => {
    const comparison = applyExceptions(
      diffSnapshots(base(), after()),
      parseExceptions([
        {
          page: "cart",
          selector: "button.primary",
          property: "border-top-left-radius",
          reason: "T3: control radius",
        },
        { page: "home", theme: "dark", selector: "main.h1", property: "*", reason: "dark only" },
        { page: "home", selector: "home.hero", property: "screenshot", reason: "mask only" },
      ]),
    );
    expect(comparison.declared.map(({ difference }) => difference.page)).toEqual(["cart"]);
    expect(comparison.undeclared).toEqual([
      {
        page: "home",
        theme: "light",
        selector: "main.h1",
        property: "color",
        before: "0px",
        after: "red",
      },
    ]);
    expect(comparison.unused.map((entry) => entry.reason)).toEqual(["dark only"]);
    const text = formatComparison(comparison);
    expect(text).toMatch(/1 UNDECLARED difference/);
    expect(text).toMatch(/home\s+\| light \| main\.h1\s+\| color\s+\| 0px\s+\| red/);
    expect(text).toMatch(/T3: control radius/);
    expect(text).toMatch(/matched nothing \(1/);
  });

  it("says so when nothing differs", () => {
    expect(formatComparison(applyExceptions([], []))).toBe(
      "Computed styles: no undeclared difference.",
    );
  });
});

describe("snapshot files and the command line", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });
  const temp = () => {
    const directory = mkdtempSync(join(tmpdir(), "fluxkit-visual-"));
    directories.push(directory);
    return directory;
  };
  const writeFragments = (directory: string, snap: Snapshot) => {
    for (const [page, themes] of Object.entries(snap.pages)) {
      for (const [theme, entries] of Object.entries(themes)) {
        writeFileSync(
          join(directory, fragmentFileName(page, theme)),
          JSON.stringify(fragment(page, theme, `/uk/${page}`, entries)),
        );
      }
    }
  };
  const cli = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(import.meta.dirname, "compare-cli.ts"), ...args],
      {
        encoding: "utf8",
      },
    );

  it("merges a directory of fragments and refuses two fragments of one page and theme", () => {
    const directory = temp();
    writeFragments(directory, base());
    expect(loadSnapshot(directory)).toEqual(base());
    const one = fragment("home", "light", "/uk", {});
    expect(() => mergeFragments([one, one])).toThrow(/Two fragments/);
  });

  it("exits 0 without differences, 1 with undeclared ones, and honours an exceptions file", () => {
    const before = temp();
    const after = temp();
    const report = temp();
    writeFragments(before, base());
    const changed = base();
    (changed.pages["home"]?.["light"]?.["main.h1"] as Record<string, string>)["font-size"] = "32px";
    writeFragments(after, changed);

    expect(cli(before, before).status).toBe(0);

    const failing = cli(before, after, "--report", report);
    expect(failing.status).toBe(1);
    expect(failing.stdout).toMatch(
      /home\s+\| light \| main\.h1\s+\| font-size\s+\| 30px\s+\| 32px/,
    );
    expect(readFileSync(join(report, "computed-styles.txt"), "utf8")).toMatch(/UNDECLARED/);
    expect(JSON.parse(readFileSync(join(report, "computed-styles.json"), "utf8"))).toHaveProperty(
      "undeclared",
    );

    const exceptions = join(temp(), "exceptions.json");
    writeFileSync(
      exceptions,
      JSON.stringify([
        { page: "home", selector: "main.h1", property: "font-size", reason: "T1: display size" },
      ]),
    );
    const declared = cli(before, after, "--exceptions", exceptions);
    expect(declared.status).toBe(0);
    expect(declared.stdout).toMatch(/Declared differences \(1\)/);
    expect(cli(before, after, "--exceptions", exceptions, "--strict").status).toBe(0);

    // An exception that matches nothing: a warning without --strict, a failure with it (the CI job passes --strict).
    const unused = cli(before, before, "--exceptions", exceptions);
    expect(unused.status).toBe(0);
    expect(unused.stdout).toMatch(/matched nothing \(1/);
    const strict = cli(before, before, "--exceptions", exceptions, "--strict");
    expect(strict.status).toBe(1);
    expect(strict.stdout).toMatch(/--strict: 1 declared exception\(s\) matched nothing/);
    expect(strict.stdout).toMatch(/Warning: selectors absent on every page.*feedback\.alert/);
  });

  it("writes only the exceptions this tree added with --own-exceptions", () => {
    const directory = temp();
    const entry = { page: "home", selector: "main.h1", property: "color", reason: "old" };
    writeFileSync(join(directory, "base.json"), JSON.stringify([entry]));
    writeFileSync(
      join(directory, "current.json"),
      JSON.stringify([entry, { ...entry, property: "font-size", reason: "new" }]),
    );
    const out = join(directory, "own.json");
    const result = cli(
      "--own-exceptions",
      join(directory, "current.json"),
      "--inherited",
      join(directory, "base.json"),
      "--write",
      out,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/1 exception\(s\) added by this tree, 1 inherited/);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual([
      { ...entry, property: "font-size", reason: "new" },
    ]);
    expect(cli("--own-exceptions", join(directory, "current.json"), "--write", out).status).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8"))).toHaveLength(2);
    expect(cli("--own-exceptions", join(directory, "current.json")).status).toBe(2);
  });

  it("exits 2 on bad input", () => {
    const before = temp();
    writeFragments(before, base());
    const exceptions = join(temp(), "exceptions.json");
    writeFileSync(exceptions, JSON.stringify([{ page: "home" }]));
    const bad = cli(before, before, "--exceptions", exceptions);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/"selector" must be a non-empty string/);
    expect(cli(before).status).toBe(2);
    expect(cli(before, join(before, "missing")).status).toBe(2);
    expect(cli(before, before, "--colour").status).toBe(2);
  });

  it("validates an exceptions file on its own with --check-exceptions", () => {
    const file = join(temp(), "exceptions.json");
    writeFileSync(
      file,
      JSON.stringify([{ page: "*", selector: "home.hero", property: "screenshot", reason: "B4" }]),
    );
    const valid = cli("--check-exceptions", file);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toMatch(/1 valid exception/);
    writeFileSync(file, JSON.stringify([{ page: "*", selector: "home.hero", property: "x" }]));
    expect(cli("--check-exceptions", file).status).toBe(2);
    expect(cli("--check-exceptions", file, "extra").status).toBe(2);
  });
});
