/** Module boundary rules. See AGENTS.md sections 2.1 and 18. */
module.exports = {
  forbidden: [
    {
      name: "core-must-not-import-features",
      comment:
        "Core must never import optional feature modules; features plug in via extension points.",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "^packages/features/" },
    },
    {
      name: "core-must-not-import-providers",
      comment:
        "Core must never import payment, shipping or email provider plugins (ADR 0029 decision 2, ADR 0031 decision 2); " +
        "providers implement core ports and are loaded by the API. Matches a resolved path under packages/providers and " +
        "an unresolved bare @fluxkit/provider-* name (core does not install provider packages), so it covers every kind " +
        "of provider package, email included (@fluxkit/provider-resend, @fluxkit/provider-fake-email).",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { path: "(^packages/providers/|(^|/node_modules/)@fluxkit/provider-)" },
    },
    {
      name: "apps-must-not-import-providers",
      comment:
        "Applications never import a provider package statically (ADR 0029 decision 8): apps/api discovers and imports " +
        "enabled providers dynamically (SHIPPING_PROVIDERS_ENABLED), so deleting a provider folder never breaks a build. " +
        "Matches a resolved path under packages/providers and an unresolved bare @fluxkit/provider-* name.",
      severity: "error",
      from: { path: "^apps/" },
      to: { path: "(^packages/providers/|(^|/node_modules/)@fluxkit/provider-)" },
    },
    {
      name: "core-must-not-import-node-builtins",
      comment:
        "Core is pure and runtime-neutral: no Node built-in (fs, crypto, net, ...), so no I/O and no Node types. " +
        "Crypto, randomness and the clock are ports or parameters the API supplies (ADR 0023, 0028, 0031).",
      severity: "error",
      from: { path: "^packages/core/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "core-must-not-import-infrastructure",
      comment:
        "Core domain logic stays pure: no framework, ORM, database, cache, queue or search client. " +
        "The pattern matches both a resolved node_modules path and an unresolved bare import " +
        "(core does not install these packages, so dependency-cruiser reports them by name).",
      severity: "error",
      from: { path: "^packages/core/" },
      to: {
        path: "(^|/node_modules/)(@nestjs/[^/]+|drizzle-orm|drizzle-kit|pg|ioredis|bullmq|meilisearch)(/|$)",
      },
    },
    {
      name: "features-must-not-import-each-other",
      comment: "Features are independent so that any one can be removed.",
      severity: "error",
      from: { path: "^packages/features/([^/]+)/" },
      to: { path: "^packages/features/", pathNot: "^packages/features/$1/" },
    },
    {
      name: "packages-must-not-import-apps",
      comment: "Shared packages must not depend on applications.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-must-not-import-each-other",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "no-deep-imports-into-packages",
      comment: "Import packages only through their public entry point (src/index.ts).",
      severity: "error",
      from: {
        path: "^(apps|packages)/([^/]+)/",
        pathNot: "^packages/features/([^/]+)/|^packages/providers/([^/]+)/",
      },
      to: { path: "^packages/(?!features/|providers/)([^/]+)/src/(?!index\\.ts$)", pathNot: "^$1" },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)dist/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
