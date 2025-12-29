import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_TEMPLATE = `{
  // OpenDevBrowser Plugin Configuration
  // See: https://github.com/anthropics/opendevbrowser#configuration

  "headless": false,
  "profile": "default",
  "persistProfile": true,

  "snapshot": {
    "maxChars": 16000,
    "maxNodes": 1000
  },

  "export": {
    "maxNodes": 1000,
    "inlineStyles": true
  },

  "devtools": {
    "showFullUrls": false,
    "showFullConsole": false
  },

  "security": {
    "allowRawCDP": false,
    "allowNonLocalCdp": false,
    "allowUnsafeExport": false
  },

  "relayPort": 8787,
  "relayToken": "some-test-token",

  "flags": [],

  "checkForUpdates": false
}
`;

export function getPluginConfigPath(mode: "global" | "local"): string {
  if (mode === "global") {
    const configDir = process.env.OPENCODE_CONFIG_DIR
      || path.join(os.homedir(), ".config", "opencode");
    return path.join(configDir, "opendevbrowser.jsonc");
  }
  return path.join(process.cwd(), "opendevbrowser.jsonc");
}

export function createPluginConfig(mode: "global" | "local"): { created: boolean; path: string } {
  const configPath = getPluginConfigPath(mode);

  if (fs.existsSync(configPath)) {
    return { created: false, path: configPath };
  }

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, CONFIG_TEMPLATE, "utf-8");
  return { created: true, path: configPath };
}

export function getConfigTemplate(): string {
  return CONFIG_TEMPLATE;
}
