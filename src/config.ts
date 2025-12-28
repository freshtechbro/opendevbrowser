import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type SnapshotConfig = {
  maxChars: number;
  maxNodes: number;
};

export type SecurityConfig = {
  allowRawCDP: boolean;
  allowNonLocalCdp: boolean;
  allowUnsafeExport: boolean;
};

export type DevtoolsConfig = {
  showFullUrls: boolean;
  showFullConsole: boolean;
};

export type ExportConfig = {
  maxNodes: number;
  inlineStyles: boolean;
};

export type OpenDevBrowserConfig = {
  headless: boolean;
  profile: string;
  snapshot: SnapshotConfig;
  security: SecurityConfig;
  devtools: DevtoolsConfig;
  export: ExportConfig;
  relayPort: number;
  relayToken?: string;
  chromePath?: string;
  flags: string[];
  persistProfile: boolean;
};

const snapshotSchema = z.object({
  maxChars: z.number().int().min(500).max(200000).default(16000),
  maxNodes: z.number().int().min(50).max(5000).default(1000)
});

const securitySchema = z.object({
  allowRawCDP: z.boolean().default(false),
  allowNonLocalCdp: z.boolean().default(false),
  allowUnsafeExport: z.boolean().default(false)
});

const devtoolsSchema = z.object({
  showFullUrls: z.boolean().default(false),
  showFullConsole: z.boolean().default(false)
});

const exportSchema = z.object({
  maxNodes: z.number().int().min(1).max(5000).default(1000),
  inlineStyles: z.boolean().default(true)
});

const configSchema = z.object({
  headless: z.boolean().default(false),
  profile: z.string().min(1).default("default"),
  snapshot: snapshotSchema.default({}),
  security: securitySchema.default({}),
  devtools: devtoolsSchema.default({}),
  export: exportSchema.default({}),
  relayPort: z.number().int().min(0).max(65535).default(8787),
  relayToken: z.string().optional(),
  chromePath: z.string().min(1).optional(),
  flags: z.array(z.string()).default([]),
  persistProfile: z.boolean().default(true)
});

const CONFIG_FILE_NAME = "opendevbrowser.jsonc";

function getGlobalConfigPath(): string {
  const configDir = process.env.OPENCODE_CONFIG_DIR
    || path.join(os.homedir(), ".config", "opencode");
  return path.join(configDir, CONFIG_FILE_NAME);
}

function stripJsonComments(content: string): string {
  return content
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function loadConfigFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const stripped = stripJsonComments(content);
  try {
    return JSON.parse(stripped);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Invalid JSON in opendevbrowser config at ${filePath}: ${message}`);
  }
}

export function loadGlobalConfig(): OpenDevBrowserConfig {
  const configPath = getGlobalConfigPath();
  const raw = loadConfigFile(configPath);
  const parsed = configSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid opendevbrowser config at ${configPath}: ${issues}`);
  }

  return parsed.data;
}

export function resolveConfig(_config: unknown): OpenDevBrowserConfig {
  return loadGlobalConfig();
}

export class ConfigStore {
  private current: OpenDevBrowserConfig;

  constructor(initial: OpenDevBrowserConfig) {
    this.current = initial;
  }

  get(): OpenDevBrowserConfig {
    return this.current;
  }

  set(next: OpenDevBrowserConfig): void {
    this.current = next;
  }
}
