import { defineConfig } from "vitest/config";

// Coverage runs can deadlock under TERM=dumb in non-interactive shells.
// Force a color-capable TERM so vitest coverage startup remains deterministic.
if (!process.env.TERM || process.env.TERM === "dumb") {
  process.env.TERM = "xterm-256color";
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
