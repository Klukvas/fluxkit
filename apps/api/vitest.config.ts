import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: "node",
    // HTTP specs commit data to one shared database and migrations.spec drops it: one spec file at a time.
    fileParallelism: false,
    include: ["src/**/*.spec.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
