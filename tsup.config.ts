import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli/index.ts",
    "src/cli/installers/postinstall-skill-sync.ts",
    "src/skills/skill-loader.ts"
  ],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  noExternal: ["yjs"]
});
