import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locales } from "@fluxkit/ui";
import { afterEach, describe, expect, it } from "vitest";
import {
  coreFirstSegments,
  featureSlicePages,
  featureSliceProblems,
  layoutProblems,
  pageGateProblems,
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
const onlyLayoutAndPage =
  "only layout.tsx (at the slice's root) and page.tsx route in a slice; anything else would run without the gate (private files go in _feature/)";
const gateFirst = (entry: string) => `${entry} must start with await requireFeature("notebook");`;

describe("feature slice route rules (plan 2026-11-13-blog.md, E5)", () => {
  it("accepts the fixture slice and lists its page", () => {
    expect(featureSliceProblems(fixtureLocaleRoot, options)).toEqual([]);
    expect(featureSlicePages(fixtureLocaleRoot)).toEqual([
      join("(feature-notebook)", "notebook", "page.tsx"),
    ]);
  });

  it("refuses a slice without layout, manifest or messages, a loading view inside it (a stray route file) or above it", () => {
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
      `${join("(feature-notebook)", "notebook", "loading.tsx")}: ${onlyLayoutAndPage}`,
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

  it("refuses every route file but the root layout and the pages (they would answer with the feature off)", () => {
    const files = [
      join("notebook", "feed", "route.ts"),
      join("notebook", "opengraph-image.tsx"),
      join("notebook", "sitemap.ts"),
      join("notebook", "default.tsx"),
      join("notebook", "template.tsx"),
      join("notebook", "error.tsx"),
      join("notebook", "not-found.tsx"),
      join("notebook", "layout.tsx"),
      join("notebook", "page.ts"),
      join("notebook", "view.tsx"),
    ];
    const localeRoot = sliceCopy("(feature-notebook)", (slice) => {
      for (const file of files) {
        mkdirSync(join(slice, file, ".."), { recursive: true });
        writeFileSync(join(slice, file), "export default function X() { return null; }\n");
      }
      mkdirSync(join(slice, "notebook", "@aside"));
      mkdirSync(join(slice, "notebook", "(.)photo"));
      // A private folder never routes: anything may live there.
      writeFileSync(join(slice, "_feature", "route.ts"), "export const x = 1;\n");
    });
    const problems = featureSliceProblems(localeRoot, options);
    for (const file of files) {
      expect(problems, file).toContain(`${join("(feature-notebook)", file)}: ${onlyLayoutAndPage}`);
    }
    for (const folder of ["@aside", "(.)photo"]) {
      expect(problems, folder).toContain(
        `${join("(feature-notebook)", "notebook", folder)}: parallel and intercepting routes are refused in a slice (they would render without the gate)`,
      );
    }
    expect(
      problems.some((problem) => problem.startsWith(join("(feature-notebook)", "_feature"))),
    ).toBe(false);
    // `page.ts` is a page Next routes: refused as a file and still checked as a page.
    expect(problems).toContain(
      `${join("(feature-notebook)", "notebook", "page.ts")}: default must be an async function starting with await requireFeature("notebook");`,
    );
  });

  it("refuses a layout that is anything but the (site) re-export", () => {
    expect(layoutProblems('export { default } from "../(site)/layout";\n')).toEqual([]);
    for (const source of [
      'export { default } from "./my-layout";',
      'export { default as Layout, default } from "../(site)/layout";',
      'import Site from "../(site)/layout";\nexport default Site;',
      'export { default } from "../(site)/layout";\nexport const revalidate = 0;',
      "export default async function Layout() { await read(); return null; }",
    ]) {
      expect(layoutProblems(source), source).toHaveLength(1);
    }
  });

  it("accepts the gated page and requires await requireFeature(<its name>) first in the page and generateMetadata", () => {
    const source = readFileSync(fixturePage, "utf8");
    expect(pageGateProblems(source, "notebook")).toEqual([]);
    expect(pageGateProblems(source, "blog")).toEqual([
      'generateMetadata must start with await requireFeature("blog");',
      'default must start with await requireFeature("blog");',
    ]);
    // A read before the gate.
    expect(
      pageGateProblems(
        source.replace(
          'NotebookPageProps) {\n  await requireFeature("notebook");',
          'NotebookPageProps) {\n  await read();\n  await requireFeature("notebook");',
        ),
        "notebook",
      ),
    ).toEqual([gateFirst("default")]);
    // generateMetadata without the gate.
    expect(
      pageGateProblems(
        source.replace(
          'Promise<Metadata> {\n  await requireFeature("notebook");',
          "Promise<Metadata> {",
        ),
        "notebook",
      ),
    ).toEqual([gateFirst("generateMetadata")]);
  });

  it("refuses every way past the gate: re-exports, export lists, arrow entries, generateStaticParams, other exports", () => {
    const page =
      'export default async function Page() {\n  await requireFeature("notebook");\n  return null;\n}\n';
    const cases: [string, string][] = [
      [
        'export { generateMetadata } from "../x/meta";',
        "`export { ... }` and `export ... from` are refused: declare each entry in the page itself",
      ],
      [
        "async function generateMetadata() { return {}; }\nexport { generateMetadata };",
        "`export { ... }` and `export ... from` are refused: declare each entry in the page itself",
      ],
      [
        'export * from "../x/meta";',
        "`export { ... }` and `export ... from` are refused: declare each entry in the page itself",
      ],
      [
        "export const generateMetadata = async () => ({});",
        "exported value generateMetadata is refused (a page exports only its gated functions and route segment config)",
      ],
      [
        'export async function generateStaticParams() { return fetch("http://api/x"); }',
        "exported function generateStaticParams is refused (a page exports only the page, generateMetadata and generateViewport)",
      ],
      [
        "export function generateMetadata() { return {}; }",
        'generateMetadata must be an async function starting with await requireFeature("notebook");',
      ],
      [
        "export const revalidate = compute();",
        "route segment config revalidate must be a plain literal",
      ],
      ["export class Thing {}", "an exported class or enum is refused in a page"],
    ];
    for (const [addition, problem] of cases) {
      expect(pageGateProblems(`${page}${addition}\n`, "notebook"), addition).toEqual([problem]);
    }
    expect(
      pageGateProblems("const Page = async () => null;\nexport default Page;\n", "notebook"),
    ).toEqual([
      "`export default <expression>` is refused: write `export default async function`",
      "no `export default async function`: a page is one",
    ]);
    expect(pageGateProblems("", "notebook")).toEqual([
      "no `export default async function`: a page is one",
    ]);
    // Allowed besides the gated entries: plain route segment config, type exports and private helpers.
    expect(
      pageGateProblems(
        `${page}export const revalidate = 60;\nexport const dynamic = "force-dynamic";\nexport type Props = { a: string };\nfunction helper() { return 1; }\n`,
        "notebook",
      ),
    ).toEqual([]);
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
