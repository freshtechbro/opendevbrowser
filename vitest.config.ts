import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/relay/protocol.ts", "src/index.ts", "src/tools/deps.ts", "src/extension-extractor.ts", "src/cli/**", "src/skills/types.ts", "src/tools/skill_list.ts", "src/tools/skill_load.ts", "extension/**"],
      thresholds: {
        lines: 97,
        functions: 97,
        branches: 97,
        statements: 97
      }
    }
  }
});
