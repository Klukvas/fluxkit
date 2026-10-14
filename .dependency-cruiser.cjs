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
