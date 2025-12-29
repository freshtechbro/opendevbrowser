import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parse as parseJsonc, modify, applyEdits } from "jsonc-parser";

const PLUGIN_NAME = "opendevbrowser";
const SCHEMA_URL = "https://opencode.ai/config.json";

export interface OpenCodeConfig {
  $schema?: string;
  plugin?: string[];
  [key: string]: unknown;
}

export function getGlobalConfigPath(): string {
  const configDir = process.env.OPENCODE_CONFIG_DIR
    || path.join(os.homedir(), ".config", "opencode");
  return path.join(configDir, "opencode.json");
}

export function getLocalConfigPath(): string {
  return path.join(process.cwd(), "opencode.json");
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function readConfig(configPath: string): { content: string; config: OpenCodeConfig } {
  if (!fs.existsSync(configPath)) {
    return { content: "", config: {} };
  }

  const content = fs.readFileSync(configPath, "utf-8");
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const firstError = errors[0];
    throw new Error(`Invalid JSONC at ${configPath}: parse error at offset ${firstError?.offset ?? 0}`);
  }

  return { content, config: (parsed ?? {}) as OpenCodeConfig };
}

export function writeConfig(configPath: string, config: OpenCodeConfig): void {
  ensureDir(path.dirname(configPath));
  const content = JSON.stringify(config, null, 2) + "\n";
  fs.writeFileSync(configPath, content, "utf-8");
}

export function addPlugin(config: OpenCodeConfig, pluginName: string = PLUGIN_NAME): OpenCodeConfig {
  const result = { ...config };

  if (!result.$schema) {
    result.$schema = SCHEMA_URL;
  }

  if (!result.plugin) {
    result.plugin = [pluginName];
  } else if (!result.plugin.includes(pluginName)) {
    result.plugin = [...result.plugin, pluginName];
  }

  return result;
}

export function removePlugin(config: OpenCodeConfig, pluginName: string = PLUGIN_NAME): OpenCodeConfig {
  const result = { ...config };

  if (result.plugin) {
    result.plugin = result.plugin.filter((p) => p !== pluginName);
    if (result.plugin.length === 0) {
      delete result.plugin;
    }
  }

  return result;
}

export function hasPlugin(config: OpenCodeConfig, pluginName: string = PLUGIN_NAME): boolean {
  return config.plugin?.includes(pluginName) ?? false;
}

export function createConfigWithPlugin(pluginName: string = PLUGIN_NAME): OpenCodeConfig {
  return {
    $schema: SCHEMA_URL,
    plugin: [pluginName]
  };
}

export function updateConfigContent(content: string, pluginName: string = PLUGIN_NAME): string {
  if (!content.trim()) {
    return JSON.stringify(createConfigWithPlugin(pluginName), null, 2) + "\n";
  }

  const parsed = parseJsonc(content, [], { allowTrailingComma: true }) as OpenCodeConfig ?? {};

  if (parsed.plugin?.includes(pluginName)) {
    return content;
  }

  let result = content;

  if (!parsed.$schema) {
    const edits = modify(result, ["$schema"], SCHEMA_URL, { formattingOptions: { tabSize: 2, insertSpaces: true } });
    result = applyEdits(result, edits);
  }

  const newPlugins = parsed.plugin ? [...parsed.plugin, pluginName] : [pluginName];
  const edits = modify(result, ["plugin"], newPlugins, { formattingOptions: { tabSize: 2, insertSpaces: true } });
  result = applyEdits(result, edits);

  return result;
}

export function removePluginFromContent(content: string, pluginName: string = PLUGIN_NAME): string {
  if (!content.trim()) {
    return content;
  }

  const parsed = parseJsonc(content, [], { allowTrailingComma: true }) as OpenCodeConfig ?? {};

  if (!parsed.plugin?.includes(pluginName)) {
    return content;
  }

  const newPlugins = parsed.plugin.filter((p) => p !== pluginName);
  const edits = modify(content, ["plugin"], newPlugins.length > 0 ? newPlugins : undefined, {
    formattingOptions: { tabSize: 2, insertSpaces: true }
  });

  return applyEdits(content, edits);
}
