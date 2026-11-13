import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locales } from "@fluxkit/ui";
import { afterEach, describe, expect, it } from "vitest";
import {
  coreFirstSegments,
  featureSlicePages,
  featureSliceProblems,
  gatesEveryEntry,
} from "./slice-rules";

const fixtureLocaleRoot = join(import.meta.dirname, "fixtures", "app", "[locale]");
const fixtureSlice = join(fixtureLocaleRoot, "(feature-notebook)");
const fixturePage = join(fixtureSlice, "notebook", "page.tsx");
const realLocaleRoot = join(import.meta.dirname, "..", "app", "[locale]");
const reserved = new Set(["about", "catalog", "account"]);

const scratch: string[] = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A scratch `app/[locale]` holding a copy of the fixture slice under `group`, changed by `edit` (paths inside the slice). */
function sliceCopy(group: string, edit: (slice: string) => void = () => undefined): string {
  const appDir = mkdtempSync(join(tmpdir(), "storefront-slice-rules-"));
  scratch.push(appDir);
  const localeRoot = join(appDir, "[locale]");
  cpSync(fixtureSlice, join(localeRoot, group), { recursive: true });
  edit(join(localeRoot, group));
  return localeRoot;
}

const options = { locales, reserved };

describe("feature slice route rules (plan 2026-11-13-blog.md, E5)", () => {
  it("accepts the fixture slice and lists its page", () => {
    expect(featureSliceProblems(fixtureLocaleRoot, options)).toEqual([]);
    expect(featureSlicePages(fixtureLocaleRoot)).toEqual([
      join("(feature-notebook)", "notebook", "page.tsx"),
    ]);
  });

  it("refuses a slice without layout, manifest or messages, and a loading view inside or above it", () => {
    const localeRoot = sliceCopy("(feature-notebook)", (slice) => {
      rmSync(join(slice, "layout.tsx"));
      rmSync(join(slice, "_feature", "feature.ts"));
      rmSync(join(slice, "_feature", "messages", "en.json"));
      writeFileSync(
        join(slice, "notebook", "loading.tsx"),
        "export default function L() { return null; }\n",
      );
    });
    writeFileSync(
      join(localeRoot, "loading.tsx"),
      "export default function L() { return null; }\n",
    );
    expect(featureSliceProblems(localeRoot, options)).toEqual([
      "(feature-notebook): no layout.tsx",
      "(feature-notebook): no manifest _feature/feature.ts",
      "(feature-notebook): no _feature/messages/en.json",
      `(feature-notebook): a loading view at ${join("(feature-notebook)", "notebook", "loading.tsx")} hides a 404`,
      "(feature-notebook): a loading view at . hides a 404",
    ]);
  });

  it("refuses a page whose path segment is a shop page slug or a path the storefront owns, or is dynamic", () => {
    const reservedPath = sliceCopy("(feature-notebook)", (slice) => {
      cpSync(join(slice, "notebook"), join(slice, "about"), { recursive: true });
    });
    expect(featureSliceProblems(reservedPath, options)).toEqual([
      `${join("(feature-notebook)", "about", "page.tsx")}: the path segment "about" is a shop page slug or a path the storefront owns`,
    ]);
    const dynamic = sliceCopy("(feature-notebook)", (slice) => {
      cpSync(join(slice, "notebook"), join(slice, "[slug]"), { recursive: true });
    });
    expect(featureSliceProblems(dynamic, options)).toEqual([
      `${join("(feature-notebook)", "[slug]", "page.tsx")}: a slice's pages start with a static path segment of their own`,
    ]);
  });

  it("refuses a malformed slice name", () => {
    expect(featureSliceProblems(sliceCopy("(feature-Notebook)"), options)).toEqual([
      '(feature-Notebook): a slice is "(feature-<name>)" with <name> a feature name',
    ]);
  });

  it("requires await requireFeature(<its name>) as the first statement of the page and of generateMetadata", () => {
    const source = readFileSync(fixturePage, "utf8");
    expect(gatesEveryEntry(source, "notebook")).toBe(true);
    expect(gatesEveryEntry(source, "blog")).toBe(false);
    // A read before the gate.
    expect(
      gatesEveryEntry(
        source.replace(
          'export default async function NotebookPage(props: NotebookPageProps) {\n  await requireFeature("notebook");',
          'export default async function NotebookPage(props: NotebookPageProps) {\n  await read();\n  await requireFeature("notebook");',
        ),
        "notebook",
      ),
    ).toBe(false);
    // generateMetadata without the gate.
    expect(
      gatesEveryEntry(
        source.replace(
          'Promise<Metadata> {\n  await requireFeature("notebook");',
          "Promise<Metadata> {",
        ),
        "notebook",
      ),
    ).toBe(false);
    // An entry the check cannot read is refused, not skipped.
    expect(
      gatesEveryEntry(`${source}\nexport const generateMetadata = () => ({});\n`, "notebook"),
    ).toBe(false);
    expect(gatesEveryEntry("export default function Page() { return null; }", "notebook")).toBe(
      false,
    );
    expect(gatesEveryEntry("", "notebook")).toBe(false);
  });

  it("names the static first path segments of the app's own pages (the reserved list of the real check)", () => {
    const segments = coreFirstSegments(realLocaleRoot);
    for (const segment of [
      "catalog",
      "c",
      "p",
      "search",
      "account",
      "cart",
      "checkout",
      "legal",
      "order",
      "payment",
    ]) {
      expect(segments.has(segment), segment).toBe(true);
    }
    expect(
      [...segments].some((segment) => segment.startsWith("[") || segment.startsWith("(")),
    ).toBe(false);
  });

  it("checks a scratch slice's own page directory as written (no shared state between copies)", () => {
    const localeRoot = sliceCopy("(feature-notebook)", (slice) => {
      mkdirSync(join(slice, "notebook", "[slug]"));
      writeFileSync(
        join(slice, "notebook", "[slug]", "page.tsx"),
        readFileSync(fixturePage, "utf8"),
      );
    });
    expect(featureSliceProblems(localeRoot, options)).toEqual([]);
    expect(featureSlicePages(localeRoot)).toHaveLength(2);
  });
});
