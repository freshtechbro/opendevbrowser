import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/relay/protocol.ts", "src/index.ts", "src/tools/deps.ts", "src/extension-extractor.ts", "extension/**"],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95
      }
    }
  }
});
