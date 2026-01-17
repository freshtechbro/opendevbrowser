import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parse as parseJsonc } from "jsonc-parser";
import { generateSecureToken } from "./utils/crypto";

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

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

export type SkillsNudgeConfig = {
  enabled: boolean;
  keywords: string[];
  maxAgeMs: number;
};

export type SkillsConfig = {
  nudge: SkillsNudgeConfig;
};

export type ContinuityNudgeConfig = {
  enabled: boolean;
  keywords: string[];
  maxAgeMs: number;
};

export type ContinuityConfig = {
  enabled: boolean;
  filePath: string;
  nudge: ContinuityNudgeConfig;
};

export type OpenDevBrowserConfig = {
  headless: boolean;
  profile: string;
  snapshot: SnapshotConfig;
  security: SecurityConfig;
  devtools: DevtoolsConfig;
  export: ExportConfig;
  skills: SkillsConfig;
  continuity: ContinuityConfig;
  relayPort: number;
  relayToken: string | false;
  chromePath?: string;
  flags: string[];
  checkForUpdates: boolean;
  persistProfile: boolean;
  skillPaths: string[];
};

const DEFAULT_RELAY_PORT = 8787;

function buildDefaultConfigJsonc(token: string): string {
  return `{
  // Set relayToken to false to disable extension pairing.
  "relayPort": ${DEFAULT_RELAY_PORT},
  "relayToken": "${token}"
}
`;
}

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

const skillsNudgeSchema = z.object({
  enabled: z.boolean().default(true),
  keywords: z.array(z.string()).default([
    "login",
    "sign in",
    "sign-in",
    "auth",
    "authentication",
    "mfa",
    "form",
    "submit",
    "validation",
    "extract",
    "scrape",
    "scraping",
    "table",
    "pagination",
    "crawl"
  ]),
  maxAgeMs: z.number().int().min(1000).max(600000).default(60000)
});

const skillsSchema = z.object({
  nudge: skillsNudgeSchema.default({})
}).default({});

const continuityNudgeSchema = z.object({
  enabled: z.boolean().default(true),
  keywords: z.array(z.string()).default([
    "plan",
    "multi-step",
    "multi step",
    "long-running",
    "long running",
    "refactor",
    "migration",
    "rollout",
    "release",
    "upgrade",
    "investigate",
    "follow-up",
    "continue"
  ]),
  maxAgeMs: z.number().int().min(1000).max(600000).default(60000)
});

const continuitySchema = z.object({
  enabled: z.boolean().default(true),
  filePath: z.string().min(1).default("opendevbrowser_continuity.md"),
  nudge: continuityNudgeSchema.default({})
}).default({});

const configSchema = z.object({
  headless: z.boolean().default(false),
  profile: z.string().min(1).default("default"),
  snapshot: snapshotSchema.default({}),
  security: securitySchema.default({}),
  devtools: devtoolsSchema.default({}),
  export: exportSchema.default({}),
  skills: skillsSchema.default({}),
  continuity: continuitySchema.default({}),
  relayPort: z.number().int().min(0).max(65535).default(DEFAULT_RELAY_PORT),
  relayToken: z.union([z.string(), z.literal(false)]).optional(),
  chromePath: z.string().min(1).optional().refine(
    (val) => val === undefined || isExecutable(val),
    { message: "chromePath must point to an executable file" }
  ),
  flags: z.array(z.string()).default([]),
  checkForUpdates: z.boolean().default(false),
  persistProfile: z.boolean().default(true),
  skillPaths: z.array(z.string()).default([])
});

const CONFIG_FILE_NAME = "opendevbrowser.jsonc";

function getGlobalConfigPath(): string {
  const configDir = process.env.OPENCODE_CONFIG_DIR
    || path.join(os.homedir(), ".config", "opencode");
  return path.join(configDir, CONFIG_FILE_NAME);
}

function ensureConfigFile(filePath: string): string {
  const token = generateSecureToken();
  if (fs.existsSync(filePath)) {
    return token;
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, buildDefaultConfigJsonc(token), { encoding: "utf-8", mode: 0o600 });
  } catch (error) {
    console.warn(`[opendevbrowser] Warning: Could not create config file at ${filePath}:`, error);
  }
  return token;
}

function loadConfigFile(filePath: string): { raw: unknown; generatedToken: string | null } {
  if (!fs.existsSync(filePath)) {
    const token = ensureConfigFile(filePath);
    return { raw: {}, generatedToken: token };
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const firstError = errors[0];
    if (!firstError) {
      throw new Error(`Invalid JSONC in opendevbrowser config at ${filePath}: parse error`);
    }
    throw new Error(`Invalid JSONC in opendevbrowser config at ${filePath}: parse error at offset ${firstError.offset}`);
  }
  return { raw: parsed ?? {}, generatedToken: null };
}

export function loadGlobalConfig(): OpenDevBrowserConfig {
  const configPath = getGlobalConfigPath();
  const { raw, generatedToken } = loadConfigFile(configPath);
  const parsed = configSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid opendevbrowser config at ${configPath}: ${issues}`);
  }

  const data = parsed.data;
  const relayToken = data.relayToken ?? generatedToken ?? generateSecureToken();

  return { ...data, relayToken };
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
