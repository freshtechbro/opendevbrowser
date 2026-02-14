import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parse as parseJsonc, modify, applyEdits } from "jsonc-parser";
import { generateSecureToken } from "./utils/crypto";
import { writeFileAtomic } from "./utils/fs";

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
  promptInjectionGuard?: {
    enabled: boolean;
  };
};

export type DevtoolsConfig = {
  showFullUrls: boolean;
  showFullConsole: boolean;
};

export type ExportConfig = {
  maxNodes: number;
  inlineStyles: boolean;
};

export type BlockerArtifactCapsConfig = {
  maxNetworkEvents: number;
  maxConsoleEvents: number;
  maxExceptionEvents: number;
  maxHosts: number;
  maxTextLength: number;
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

export type FingerprintTier1Config = {
  enabled: boolean;
  warnOnly: boolean;
  locale?: string;
  timezone?: string;
  languages: string[];
  requireProxy: boolean;
  geolocation?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  geolocationRequired: boolean;
};

export type FingerprintTier2Config = {
  enabled: boolean;
  mode: "deterministic" | "adaptive";
  continuousSignals: boolean;
  rotationIntervalMs: number;
  challengePatterns: string[];
  maxChallengeEvents: number;
  scorePenalty: number;
  scoreRecovery: number;
  rotationHealthThreshold: number;
};

export type FingerprintTier3CanaryConfig = {
  windowSize: number;
  minSamples: number;
  promoteThreshold: number;
  rollbackThreshold: number;
};

export type FingerprintTier3Config = {
  enabled: boolean;
  continuousSignals: boolean;
  fallbackTier: "tier1" | "tier2";
  canary: FingerprintTier3CanaryConfig;
};

export type FingerprintConfig = {
  tier1: FingerprintTier1Config;
  tier2: FingerprintTier2Config;
  tier3: FingerprintTier3Config;
};

export type ProvidersTierConfig = {
  default: "A" | "B" | "C";
  enableHybrid: boolean;
  enableRestrictedSafe: boolean;
  hybridRiskThreshold: number;
  restrictedSafeRecoveryIntervalMs: number;
};

export type ProvidersAdaptiveConcurrencyConfig = {
  enabled: boolean;
  maxGlobal: number;
  maxPerDomain: number;
};

export type ProvidersCrawlerConfig = {
  workerThreads: number;
  queueMax: number;
};

export type ProvidersConfig = {
  tiers: ProvidersTierConfig;
  adaptiveConcurrency: ProvidersAdaptiveConcurrencyConfig;
  crawler: ProvidersCrawlerConfig;
};

export type CanaryConfig = {
  targets: {
    enabled: boolean;
  };
};

export type OpenDevBrowserConfig = {
  headless: boolean;
  profile: string;
  snapshot: SnapshotConfig;
  security: SecurityConfig;
  blockerDetectionThreshold: number;
  blockerResolutionTimeoutMs: number;
  blockerArtifactCaps: BlockerArtifactCapsConfig;
  providers?: ProvidersConfig;
  devtools: DevtoolsConfig;
  fingerprint: FingerprintConfig;
  canary?: CanaryConfig;
  export: ExportConfig;
  skills: SkillsConfig;
  continuity: ContinuityConfig;
  relayPort: number;
  relayToken: string | false;
  nativeExtensionId?: string;
  daemonPort: number;
  daemonToken: string;
  chromePath?: string;
  flags: string[];
  checkForUpdates: boolean;
  persistProfile: boolean;
  skillPaths: string[];
};

const DEFAULT_RELAY_PORT = 8787;
const DEFAULT_DAEMON_PORT = 8788;

function buildDefaultConfigJsonc(relayToken: string, daemonToken: string): string {
  return `{
  // Set relayToken to false to disable extension pairing.
  "relayPort": ${DEFAULT_RELAY_PORT},
  "relayToken": "${relayToken}",
  // Optional: extension ID for native host auto-install.
  // "nativeExtensionId": "abcdefghijklmnopabcdefghijklmnop",
  "daemonPort": ${DEFAULT_DAEMON_PORT},
  "daemonToken": "${daemonToken}"
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
  allowUnsafeExport: z.boolean().default(false),
  promptInjectionGuard: z.object({
    enabled: z.boolean().default(true)
  }).default({})
});

const providersSchema = z.object({
  tiers: z.object({
    default: z.enum(["A", "B", "C"]).default("A"),
    enableHybrid: z.boolean().default(false),
    enableRestrictedSafe: z.boolean().default(false),
    hybridRiskThreshold: z.number().min(0).max(1).default(0.6),
    restrictedSafeRecoveryIntervalMs: z.number().int().min(0).max(86_400_000).default(60000)
  }).default({}),
  adaptiveConcurrency: z.object({
    enabled: z.boolean().default(false),
    maxGlobal: z.number().int().min(1).max(512).default(8),
    maxPerDomain: z.number().int().min(1).max(256).default(4)
  }).default({}),
  crawler: z.object({
    workerThreads: z.number().int().min(1).max(64).default(4),
    queueMax: z.number().int().min(1).max(100000).default(2000)
  }).default({})
}).default({});

const canarySchema = z.object({
  targets: z.object({
    enabled: z.boolean().default(false)
  }).default({})
});

const devtoolsSchema = z.object({
  showFullUrls: z.boolean().default(false),
  showFullConsole: z.boolean().default(false)
});

const exportSchema = z.object({
  maxNodes: z.number().int().min(1).max(5000).default(1000),
  inlineStyles: z.boolean().default(true)
});

const blockerArtifactCapsSchema = z.object({
  maxNetworkEvents: z.number().int().min(1).max(500).default(20),
  maxConsoleEvents: z.number().int().min(1).max(500).default(20),
  maxExceptionEvents: z.number().int().min(1).max(200).default(10),
  maxHosts: z.number().int().min(1).max(200).default(10),
  maxTextLength: z.number().int().min(32).max(4096).default(512)
}).default({});

const skillsNudgeSchema = z.object({
  enabled: z.boolean().default(true),
  keywords: z.array(z.string()).default([
    "quick start",
    "getting started",
    "launch",
    "connect",
    "setup"
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

const tier1GeolocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(1).max(10000).default(50)
});

const fingerprintTier1Schema = z.object({
  enabled: z.boolean().default(true),
  warnOnly: z.boolean().default(true),
  locale: z.string().min(2).optional(),
  timezone: z.string().min(2).optional(),
  languages: z.array(z.string().min(2)).default([]),
  requireProxy: z.boolean().default(false),
  geolocation: tier1GeolocationSchema.optional(),
  geolocationRequired: z.boolean().default(false)
}).default({});

const fingerprintTier2Schema = z.object({
  enabled: z.boolean().default(true),
  mode: z.union([z.enum(["deterministic", "adaptive"]), z.literal("off")])
    .default("adaptive")
    .transform((mode) => {
      return mode === "off" ? "deterministic" : mode;
    }),
  continuousSignals: z.boolean().default(true),
  rotationIntervalMs: z.number().int().min(0).max(86_400_000).default(900_000),
  challengePatterns: z.array(z.string().min(1)).default([
    "captcha",
    "challenge",
    "interstitial",
    "cf_chl",
    "bot"
  ]),
  maxChallengeEvents: z.number().int().min(1).max(100).default(20),
  scorePenalty: z.number().int().min(1).max(100).default(20),
  scoreRecovery: z.number().int().min(0).max(100).default(5),
  rotationHealthThreshold: z.number().int().min(0).max(100).default(55)
}).default({});

const fingerprintTier3CanarySchema = z.object({
  windowSize: z.number().int().min(1).max(100).default(10),
  minSamples: z.number().int().min(1).max(100).default(3),
  promoteThreshold: z.number().int().min(0).max(100).default(80),
  rollbackThreshold: z.number().int().min(0).max(100).default(35)
});

const fingerprintTier3Schema = z.object({
  enabled: z.boolean().default(true),
  continuousSignals: z.boolean().default(true),
  fallbackTier: z.enum(["tier1", "tier2"]).default("tier2"),
  canary: fingerprintTier3CanarySchema.default({})
}).default({});

const fingerprintSchema = z.object({
  tier1: fingerprintTier1Schema.default({}),
  tier2: fingerprintTier2Schema.default({}),
  tier3: fingerprintTier3Schema.default({})
}).default({});

const configSchema = z.object({
  headless: z.boolean().default(false),
  profile: z.string().min(1).default("default"),
  snapshot: snapshotSchema.default({}),
  security: securitySchema.default({}),
  blockerDetectionThreshold: z.number().min(0).max(1).default(0.7),
  blockerResolutionTimeoutMs: z.number().int().min(1000).max(86_400_000).default(600_000),
  blockerArtifactCaps: blockerArtifactCapsSchema,
  providers: providersSchema.default({}),
  devtools: devtoolsSchema.default({}),
  fingerprint: fingerprintSchema.default({}),
  canary: canarySchema.default({}),
  export: exportSchema.default({}),
  skills: skillsSchema.default({}),
  continuity: continuitySchema.default({}),
  relayPort: z.number().int().min(0).max(65535).default(DEFAULT_RELAY_PORT),
  relayToken: z.union([z.string(), z.literal(false)]).optional(),
  nativeExtensionId: z.string().optional(),
  daemonPort: z.number().int().min(0).max(65535).default(DEFAULT_DAEMON_PORT),
  daemonToken: z.string().min(1).optional(),
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

function ensureConfigFile(filePath: string): { relayToken: string; daemonToken: string } {
  const relayToken = generateSecureToken();
  const daemonToken = generateSecureToken();
  if (fs.existsSync(filePath)) {
    return { relayToken, daemonToken };
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, buildDefaultConfigJsonc(relayToken, daemonToken), { encoding: "utf-8", mode: 0o600 });
  } catch (error) {
    console.warn(`[opendevbrowser] Warning: Could not create config file at ${filePath}:`, error);
  }
  return { relayToken, daemonToken };
}

function loadConfigFile(filePath: string): {
  raw: unknown;
  content: string;
  generatedRelayToken: string | null;
  generatedDaemonToken: string | null;
  created: boolean;
} {
  if (!fs.existsSync(filePath)) {
    const tokens = ensureConfigFile(filePath);
    const content = buildDefaultConfigJsonc(tokens.relayToken, tokens.daemonToken);
    return {
      raw: {},
      content,
      generatedRelayToken: tokens.relayToken,
      generatedDaemonToken: tokens.daemonToken,
      created: true
    };
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
  return {
    raw: parsed ?? {},
    content,
    generatedRelayToken: null,
    generatedDaemonToken: null,
    created: false
  };
}

export function loadGlobalConfig(): OpenDevBrowserConfig {
  const configPath = getGlobalConfigPath();
  const { raw, content, generatedRelayToken, generatedDaemonToken, created } = loadConfigFile(configPath);
  const parsed = configSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid opendevbrowser config at ${configPath}: ${issues}`);
  }

  const data = parsed.data;
  const relayToken = data.relayToken ?? generatedRelayToken ?? generateSecureToken();
  const daemonToken = data.daemonToken ?? generatedDaemonToken ?? generateSecureToken();

  if (!created) {
    persistDaemonConfigDefaults({
      configPath,
      content,
      raw,
      daemonPort: data.daemonPort,
      daemonToken
    });
  }

  return { ...data, relayToken, daemonToken };
}

export function resolveConfig(config: unknown): OpenDevBrowserConfig {
  if (typeof config === "undefined") {
    return loadGlobalConfig();
  }
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid opendevbrowser config override: ${issues}`);
  }
  const data = parsed.data;
  const relayToken = data.relayToken ?? generateSecureToken();
  const daemonToken = data.daemonToken ?? generateSecureToken();
  return { ...data, relayToken, daemonToken };
}

function persistDaemonConfigDefaults(params: {
  configPath: string;
  content: string;
  raw: unknown;
  daemonPort: number;
  daemonToken: string;
}): void {
  if (!isRecord(params.raw)) {
    return;
  }
  const hasDaemonPort = Object.prototype.hasOwnProperty.call(params.raw, "daemonPort");
  const hasDaemonToken = Object.prototype.hasOwnProperty.call(params.raw, "daemonToken");
  if (hasDaemonPort && hasDaemonToken) {
    return;
  }
  const formattingOptions = { insertSpaces: true, tabSize: 2 };
  let updatedContent = params.content;
  if (!hasDaemonPort) {
    const edits = modify(updatedContent, ["daemonPort"], params.daemonPort, { formattingOptions });
    if (edits.length) {
      updatedContent = applyEdits(updatedContent, edits);
    }
  }
  if (!hasDaemonToken) {
    const edits = modify(updatedContent, ["daemonToken"], params.daemonToken, { formattingOptions });
    if (edits.length) {
      updatedContent = applyEdits(updatedContent, edits);
    }
  }
  if (updatedContent !== params.content) {
    writeFileAtomic(params.configPath, updatedContent, { mode: 0o600 });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

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

export const __test__ = {
  persistDaemonConfigDefaults
};
