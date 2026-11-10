// Docs check (AGENTS.md section 18): code changes that need documentation must come with it.
// Usage: node scripts/check-docs.mjs --base origin/main (or --self-test: only the rule's own cases)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// Storefront layout and branding config files that are public contracts (plan docs/plans/2026-11-08-design-changeability.md,
// principle 7). Most do not exist yet: the rule applies from the PR that adds one, and a change that touches none passes.
// The fork-facing files of the product card registry (`docs/contracts/card-registry.md`, PR-F) are contract files too, and
// so are those of the home sections (`docs/contracts/home-sections.md`, PR-G2): `config/home.ts` (its section types), the
// fork-owned registry and its types; and so are those of the UI slots (`docs/contracts/slots.md`, PR-H): the fork-owned
// `config/slots.tsx` and `lib/slots.ts` (slot names, view models, registry type).
const contractConfig =
  /^apps\/storefront\/src\/(config\/(brand|catalog|header|footer|slots|custom-sections|home)|components\/cards\/(custom|types)|lib\/(custom-sections|slots))\.tsx?$/;

// The config files among them that a client fork fills itself (`docs/customization.md`): editing their VALUES changes no
// template contract, so in a fork they do not need a change under docs/contracts/. The files that define the contract (the
// types, the slot names) keep the rule in a fork too.
const forkFilledConfig =
  /^apps\/storefront\/src\/(config\/(brand|catalog|header|footer|slots|custom-sections|home)|components\/cards\/custom)\.tsx?$/;

// A client fork creates this file at the repository root (`docs/customization.md`, "Before you start"; `docs/contracts/README.md`).
// The template itself never contains it: `apps/storefront/src/fork-marker.upstream.spec.ts` fails if it does.
const forkMarker = ".fluxkit-fork";
const forkMarkerSpec = "apps/storefront/src/fork-marker.upstream.spec.ts";

/**
 * Whether the contract rule runs in fork mode, and the problems of the marker itself. Fork mode follows the marker in the BASE
 * ref only: a PR that adds the marker cannot relax its own check (a fork lands the marker in a commit or PR of its own first).
 * Fails closed when the tree holds both the marker and the upstream-only spec that refuses it (half of step 0 done).
 */
function forkMode({ markerInBase, markerInTree, upstreamSpecInTree }) {
  const problems =
    markerInTree && upstreamSpecInTree
      ? [
          `Both ${forkMarker} and ${forkMarkerSpec} exist. In a client fork, delete ${forkMarkerSpec} (docs/customization.md, step 0); in the template, delete ${forkMarker} (the template never contains it).`,
        ]
      : [];
  return { fork: markerInBase, problems };
}

/** The real repository state `forkMode` reads: the marker in `base` (via `gitRun`) and the marker and the spec on disk. */
function readForkState(base, gitRun, exists) {
  let markerInBase = true;
  try {
    gitRun("cat-file", "-e", `${base}:${forkMarker}`);
  } catch {
    markerInBase = false;
  }
  return {
    markerInBase,
    markerInTree: exists(forkMarker),
    upstreamSpecInTree: exists(forkMarkerSpec),
  };
}

/**
 * The problem when a contract config file changed (added, edited, renamed or deleted) without a change under docs/contracts/.
 * `fork`: the repository is a client fork (the marker exists), so the fork's own config files are left out.
 */
function contractConfigProblem(paths, { fork }) {
  const relevant = fork ? paths.filter((path) => !forkFilledConfig.test(path)) : paths;
  if (!relevant.some((path) => contractConfig.test(path))) return null;
  if (paths.some((path) => path.startsWith("docs/contracts/"))) return null;
  return "A storefront contract file (apps/storefront/src/config/{brand,catalog,header,footer,slots,custom-sections,home}.ts(x), apps/storefront/src/components/cards/{custom,types}.ts(x) or apps/storefront/src/lib/{custom-sections,slots}.ts(x)) changed but nothing under docs/contracts/ did. A client fork filling its own config files creates the marker .fluxkit-fork at the repository root (docs/customization.md, step 0).";
}

/** Parses `git diff --name-status`; a rename or copy lists the old and the new path: `path` is the new one, `paths` both. */
function parseNameStatus(output) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status[0], path: rest[rest.length - 1], paths: rest };
    });
}

const changedPaths = (entries) => entries.flatMap((entry) => entry.paths);

// The rule's own cases, run on every call before the diff is read (and alone with --self-test): a broken rule fails loudly.
// `nameStatus` cases go through the parser, so a rename away from (or onto) a contract file is covered too.
const selfTestCases = [
  {
    nameStatus: "R100\tapps/storefront/src/config/brand.ts\tapps/storefront/src/config/branding.ts",
    fails: true,
  },
  {
    nameStatus:
      "R100\tapps/storefront/src/config/brand.ts\tapps/storefront/src/config/branding.ts\nM\tdocs/contracts/branding.md",
    fails: false,
  },
  { nameStatus: "M\tapps/storefront/src/config/home.ts", fails: true },
  {
    nameStatus: "M\tapps/storefront/src/config/home.ts\nM\tdocs/contracts/home-sections.md",
    fails: false,
  },
  { paths: [], fails: false },
  {
    paths: ["apps/storefront/src/config/home.spec.ts", "apps/storefront/src/config/theme.ts"],
    fails: false,
  },
  {
    paths: ["apps/storefront/src/config/catalog.spec.ts", "apps/storefront/src/config/brand.json"],
    fails: false,
  },
  { paths: ["apps/storefront/src/config/brand.ts"], fails: true },
  { paths: ["apps/storefront/src/config/slots.tsx", "docs/files/storefront.md"], fails: true },
  {
    paths: ["apps/storefront/src/config/header.ts", "apps/storefront/src/config/footer.tsx"],
    fails: true,
  },
  {
    paths: ["apps/storefront/src/config/catalog.ts", "docs/contracts/layout-config.md"],
    fails: false,
  },
  { paths: ["apps/storefront/src/config/slots.tsx", "docs/contracts/slots.md"], fails: false },
  { paths: ["apps/admin/src/config/brand.ts", "packages/ui/src/config/footer.ts"], fails: false },
  { paths: ["apps/storefront/src/components/cards/custom.ts"], fails: true },
  {
    paths: ["apps/storefront/src/components/cards/types.ts", "docs/files/storefront.md"],
    fails: true,
  },
  {
    paths: ["apps/storefront/src/components/cards/custom.ts", "docs/contracts/card-registry.md"],
    fails: false,
  },
  {
    paths: [
      "apps/storefront/src/components/cards/grid-card.tsx",
      "apps/storefront/src/components/cards/registry.ts",
      "apps/storefront/src/components/cards/custom.spec.tsx",
    ],
    fails: false,
  },
  { paths: ["apps/storefront/src/config/custom-sections.ts"], fails: true },
  {
    nameStatus: "A\tapps/storefront/src/lib/custom-sections.ts\nM\tdocs/files/storefront.md",
    fails: true,
  },
  {
    paths: [
      "apps/storefront/src/config/custom-sections.ts",
      "apps/storefront/src/lib/custom-sections.ts",
      "docs/contracts/home-sections.md",
    ],
    fails: false,
  },
  {
    paths: [
      "apps/storefront/src/config/custom-sections.spec.ts",
      "apps/storefront/src/lib/custom-sections-model.ts",
      "apps/storefront/src/components/home-sections.tsx",
    ],
    fails: false,
  },
  // The UI slots (`docs/contracts/slots.md`, PR-H): the fork-owned registry and the module with its types and names.
  { paths: ["apps/storefront/src/lib/slots.ts"], fails: true },
  {
    nameStatus:
      "R100\tapps/storefront/src/config/slots.tsx\tapps/storefront/src/config/ui-slots.tsx",
    fails: true,
  },
  {
    paths: [
      "apps/storefront/src/config/slots.tsx",
      "apps/storefront/src/lib/slots.ts",
      "docs/contracts/slots.md",
    ],
    fails: false,
  },
  {
    paths: [
      "apps/storefront/src/lib/slots.spec.tsx",
      "apps/storefront/src/lib/slots-fork-fixture.tsx",
      "apps/storefront/src/config/slots.upstream.spec.ts",
      "apps/storefront/src/components/site-footer.tsx",
    ],
    fails: false,
  },
  // In a fork (the `.fluxkit-fork` marker at the repository root): the fork fills its own config files, which changes no
  // template contract; the files that define the contract (types, slot names) keep the rule.
  {
    paths: [
      "apps/storefront/src/config/brand.ts",
      "apps/storefront/src/config/header.ts",
      "apps/storefront/src/config/footer.ts",
      "apps/storefront/src/config/slots.tsx",
      "apps/storefront/src/config/custom-sections.ts",
      "apps/storefront/src/config/home.ts",
      "apps/storefront/src/config/catalog.ts",
      "apps/storefront/src/components/cards/custom.ts",
    ],
    fork: true,
    fails: false,
  },
  { nameStatus: "A\tapps/storefront/src/components/cards/custom.ts", fork: true, fails: false },
  { paths: ["apps/storefront/src/config/footer.ts"], fork: false, fails: true },
  { paths: ["apps/storefront/src/lib/slots.ts"], fork: true, fails: true },
  {
    paths: [
      "apps/storefront/src/config/slots.tsx",
      "apps/storefront/src/components/cards/types.ts",
    ],
    fork: true,
    fails: true,
  },
  {
    paths: ["apps/storefront/src/lib/custom-sections.ts", "docs/contracts/home-sections.md"],
    fork: true,
    fails: false,
  },
  {
    nameStatus:
      "R100\tapps/storefront/src/config/slots.tsx\tapps/storefront/src/lib/slots.tsx\nM\tapps/storefront/src/config/brand.ts",
    fork: true,
    fails: true,
  },
];
const casePaths = ({ paths, nameStatus }) => paths ?? changedPaths(parseNameStatus(nameStatus));
const selfTestFailures = selfTestCases.filter(
  (testCase) =>
    (contractConfigProblem(casePaths(testCase), { fork: testCase.fork === true }) !== null) !==
    testCase.fails,
);
// The marker's own cases: fork mode only from the base ref; marker plus upstream-only spec in the tree fails.
const forkModeCases = [
  {
    state: { markerInBase: false, markerInTree: false, upstreamSpecInTree: true },
    fork: false,
    problems: 0,
  },
  // The PR that adds the marker (and deletes the spec): its own check stays strict.
  {
    state: { markerInBase: false, markerInTree: true, upstreamSpecInTree: false },
    fork: false,
    problems: 0,
  },
  // An upstream PR that adds the marker and keeps the spec: strict, and refused.
  {
    state: { markerInBase: false, markerInTree: true, upstreamSpecInTree: true },
    fork: false,
    problems: 1,
  },
  {
    state: { markerInBase: true, markerInTree: true, upstreamSpecInTree: false },
    fork: true,
    problems: 0,
  },
  {
    state: { markerInBase: true, markerInTree: true, upstreamSpecInTree: true },
    fork: true,
    problems: 1,
  },
  // A fork PR that deletes the marker again: the base still decides this PR.
  {
    state: { markerInBase: true, markerInTree: false, upstreamSpecInTree: false },
    fork: true,
    problems: 0,
  },
];
const forkModeFailures = forkModeCases.filter(({ state, fork, problems }) => {
  const result = forkMode(state);
  return result.fork !== fork || result.problems.length !== problems;
});
// `readForkState` with a fake git: `cat-file -e` succeeds only when the base has the marker.
const fakeGit =
  (hasMarker) =>
  (...args) => {
    if (args[0] !== "cat-file" || args[2] !== `main:${forkMarker}`) throw new Error(args.join(" "));
    if (!hasMarker) throw new Error("missing");
    return "";
  };
const readStateFailures = [true, false].filter(
  (hasMarker) =>
    readForkState("main", fakeGit(hasMarker), (path) => path === forkMarker).markerInBase !==
    hasMarker,
);
if (selfTestFailures.length > 0 || forkModeFailures.length > 0 || readStateFailures.length > 0) {
  console.error(
    "check:docs self-test failed for: " +
      [
        ...selfTestFailures.map((testCase) => JSON.stringify(casePaths(testCase))),
        ...forkModeFailures.map((testCase) => JSON.stringify(testCase.state)),
        ...readStateFailures.map(
          (hasMarker) => `readForkState(marker in base: ${String(hasMarker)})`,
        ),
      ].join(", "),
  );
  process.exit(1);
}
if (process.argv.includes("--self-test")) {
  console.log(
    `check:docs self-test: ${selfTestCases.length + forkModeCases.length + 2} cases passed`,
  );
  process.exit(0);
}

const baseIndex = process.argv.indexOf("--base");
const base = baseIndex > 0 ? process.argv[baseIndex + 1] : undefined;
if (base === undefined) {
  console.error("check:docs needs --base <ref>");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const changed = parseNameStatus(git("diff", "--name-status", `${base}...HEAD`));

const touched = (predicate) => changed.some((entry) => predicate(entry.path));
const problems = [];

const controllerChanged = changed.some(({ path }) => {
  if (/^apps\/api\/src\/.*\.controller\.ts$/.test(path)) return true;
  if (/^packages\/features\/[^/]+\/src\/.*\.ts$/.test(path) && existsSync(path)) {
    return readFileSync(path, "utf8").includes("@Controller(");
  }
  return false;
});
if (controllerChanged && !touched((path) => path.startsWith("docs/api/"))) {
  problems.push(
    "A controller changed but nothing under docs/api/ did (document the endpoint, and regenerate openapi.json for core routes).",
  );
}

if (
  touched(
    (path) =>
      /^apps\/api\/drizzle\/.*\.sql$/.test(path) || path === "apps/api/src/database/schema.ts",
  ) &&
  !touched((path) => path === "CHANGELOG.md")
) {
  problems.push("The database schema or a migration changed but CHANGELOG.md did not.");
}

const addedPackage = changed.some(
  ({ status, path }) => status === "A" && /^(apps|packages)\/(.+\/)?package\.json$/.test(path),
);
if (addedPackage && !touched((path) => path.startsWith("docs/files/"))) {
  problems.push("A new package was added but nothing under docs/files/ changed.");
}

const tokensPath = "packages/theme/src/tokens.css";
if (touched((path) => path === tokensPath)) {
  const names = (css) =>
    [...css.matchAll(/(--fk-[a-z0-9-]+)\s*:/g)]
      .map((match) => match[1])
      .sort()
      .join(",");
  const before = (() => {
    try {
      return git("show", `${base}:${tokensPath}`);
    } catch {
      return "";
    }
  })();
  if (
    names(before) !== names(readFileSync(tokensPath, "utf8")) &&
    !touched((path) => path === "docs/contracts/theme-tokens.md")
  ) {
    problems.push("Design token names changed but docs/contracts/theme-tokens.md did not.");
  }
}

const quietGit = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const { fork, problems: markerProblems } = forkMode(readForkState(base, quietGit, existsSync));
problems.push(...markerProblems);
if (fork)
  console.log(
    `${forkMarker} found in ${base}: client fork, its own storefront config files need no docs/contracts/ change`,
  );
const contractProblem = contractConfigProblem(changedPaths(changed), { fork });
if (contractProblem !== null) problems.push(contractProblem);

console.log(`changed files: ${changed.length}`);
if (problems.length > 0) {
  console.error("Docs check failed:\n" + problems.map((line) => `  - ${line}`).join("\n"));
  process.exit(1);
}
