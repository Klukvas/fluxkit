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
    include: ["src/**/*.spec.ts"],
    // Every spec file runs behind the no-network guard: any fetch to a host other than 127.0.0.1 fails the suite.
    setupFiles: ["src/test-support/no-network.ts"],
  },
});
