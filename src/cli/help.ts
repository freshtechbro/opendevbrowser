import onboardingMetadata from "./onboarding-metadata.json";
import type { CliCommand } from "./args";
import { CLI_COMMANDS, VALID_FLAGS } from "./args";
import {
  CLI_COMMAND_HELP_DETAILS,
  PUBLIC_CLI_COMMAND_GROUPS,
  TOOL_SURFACE_ENTRIES
} from "../public-surface/generated-manifest";
import { listCommands } from "./commands/registry";

type HelpFlag = (typeof VALID_FLAGS)[number];

interface CommandGroup {
  title: string;
  summary: string;
  commands: readonly CliCommand[];
}

export type CommandHelpDetail = typeof CLI_COMMAND_HELP_DETAILS[CliCommand];

interface FlagEntry {
  flag: HelpFlag;
  alias?: string;
  description: string;
  example?: string;
}

interface FlagGroup {
  title: string;
  summary: string;
  flags: readonly FlagEntry[];
}

interface ReferenceEntry {
  label: string;
  description: string;
}

interface DetailRow {
  label: string;
  value: string;
}

interface FormattableRow {
  label: string;
  description: string;
  details?: readonly DetailRow[];
}

const LABEL_WIDTH = 42;
const DETAIL_LABEL_WIDTH = 9;
const COMMAND_SET = new Set<string>(CLI_COMMANDS);
const FLAG_SET = new Set<string>(VALID_FLAGS);
const TOOL_COUNT = TOOL_SURFACE_ENTRIES.length;

const formatFlags = (flags: readonly HelpFlag[]): string => (flags.length > 0 ? flags.join(", ") : "none");

export const HELP_COMMAND_GROUPS: readonly CommandGroup[] = PUBLIC_CLI_COMMAND_GROUPS.map((group) => ({
  title: group.title,
  summary: group.summary,
  commands: group.commands.map((command) => command.name) as CliCommand[]
}));

export const COMMAND_HELP_DETAILS: Record<CliCommand, CommandHelpDetail> = CLI_COMMAND_HELP_DETAILS as Record<CliCommand, CommandHelpDetail>;

export const HELP_FLAG_GROUPS: readonly FlagGroup[] = [
  {
    title: "Install / Global Flags",
    summary: "Control install scope, prompting, and bundled skill setup.",
    flags: [
      { flag: "--global", alias: "-g", description: "Install into ~/.config/opencode/opencode.json.", example: "npx opendevbrowser --global --with-config" },
      { flag: "--local", alias: "-l", description: "Install into ./opencode.json for this project.", example: "npx opendevbrowser --local --skills-local" },
      { flag: "--update", alias: "-u", description: "Alias for the update command." },
      { flag: "--uninstall", description: "Alias for the uninstall command." },
      { flag: "--with-config", description: "Also create opendevbrowser.jsonc defaults.", example: "npx opendevbrowser --global --with-config" },
      { flag: "--full", alias: "-f", description: "Install config and pre-extract extension assets.", example: "npx opendevbrowser --full" },
      { flag: "--no-prompt", description: "Run non-interactively using defaults." },
      { flag: "--no-interactive", description: "Alias of --no-prompt." },
      { flag: "--quiet", description: "Suppress non-error text output." },
      { flag: "--skills-global", description: "Install bundled skills into global agent directories." },
      { flag: "--skills-local", description: "Install bundled skills into local project agent directories." },
      { flag: "--no-skills", description: "Skip bundled skill installation." }
    ]
  },
  {
    title: "Help / Output Flags",
    summary: "Inspect help or version and control output transport.",
    flags: [
      { flag: "--help", alias: "-h", description: "Show CLI help output.", example: "npx opendevbrowser --help" },
      { flag: "--version", alias: "-v", description: "Show CLI version.", example: "npx opendevbrowser --version" },
      { flag: "--output-format", description: "Output mode: text, json, or stream-json.", example: "opendevbrowser status --daemon --output-format json" },
      { flag: "--transport", description: "Transport selector for transport-aware commands. `status` uses relay/native; `annotate` uses auto/direct/relay.", example: "opendevbrowser status --session-id s1 --transport native" }
    ]
  },
  {
    title: "Daemon / Session / Launch Flags",
    summary: "Control daemon binding, browser connect, and launch behavior. If ext=on but handshake=off, reopen the extension popup and click Connect again to re-establish a clean daemon-extension handshake.",
    flags: [
      { flag: "--port", description: "Daemon or relay port override.", example: "opendevbrowser serve --port 8788" },
      { flag: "--token", description: "Relay or daemon auth token override.", example: "opendevbrowser serve --token local-dev-token" },
      { flag: "--stop", description: "Stop a running daemon.", example: "opendevbrowser serve --stop" },
      { flag: "--daemon", description: "Target daemon status mode where supported.", example: "opendevbrowser status --daemon --output-format json" },
      { flag: "--script", description: "Path to a run-script JSON file.", example: "opendevbrowser run --script ./workflow.json" },
      { flag: "--session-id", description: "Target an existing browser or daemon session.", example: "opendevbrowser snapshot --session-id s1" },
      { flag: "--close-browser", description: "Close the managed browser on disconnect." },
      { flag: "--ws-endpoint", description: "Connect using an explicit CDP WebSocket endpoint.", example: "opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/..." },
      { flag: "--host", description: "CDP host for host/port connect mode.", example: "opendevbrowser connect --host 127.0.0.1 --cdp-port 9222" },
      { flag: "--cdp-port", description: "CDP port for host/port connect mode." },
      { flag: "--headless", description: "Launch a managed browser in headless mode.", example: "opendevbrowser launch --no-extension --headless" },
      { flag: "--profile", description: "Use a named browser profile directory." },
      { flag: "--persist-profile", description: "Keep the generated profile directory after exit. `run` uses a temporary profile by default unless this flag is enabled." },
      { flag: "--chrome-path", description: "Use a specific Chrome, Chromium, or CfT binary." },
      { flag: "--start-url", description: "Open this URL immediately after launch or connect." },
      { flag: "--flag", description: "Pass one or more extra Chrome CLI flags." },
      { flag: "--no-extension", description: "Force managed mode without extension relay." },
      { flag: "--extension-only", description: "Fail unless the extension relay websocket is connected and the daemon-extension handshake is complete." },
      { flag: "--extension-legacy", description: "Use the legacy /cdp relay mode instead of /ops." },
      { flag: "--wait-for-extension", description: "Wait for a clean daemon-extension handshake before returning." },
      { flag: "--wait-timeout-ms", description: "Handshake wait timeout in milliseconds." }
    ]
  },
  {
    title: "Navigation / Interaction / Diagnostics Flags",
    summary: "Command-specific flags for page actions, reads, and diagnostics.",
    flags: [
      { flag: "--url", description: "Target URL for navigation, connect, or workflow commands.", example: "opendevbrowser goto --session-id s1 --url https://example.com" },
      { flag: "--wait-until", description: "Navigation wait strategy such as load or domcontentloaded." },
      { flag: "--timeout-ms", description: "Operation timeout in milliseconds.", example: "opendevbrowser canvas --timeout-ms 120000 --command canvas.session.open ..." },
      { flag: "--ref", description: "Snapshot ref id for element-targeted commands.", example: "opendevbrowser click --session-id s1 --ref r12" },
      { flag: "--state", description: "Wait state selector for wait-style commands." },
      { flag: "--until", description: "Wait condition selector for wait-style commands." },
      { flag: "--mode", description: "Mode selector for commands that accept variants." },
      { flag: "--max-chars", description: "Maximum text characters to return for DOM reads." },
      { flag: "--cursor", description: "Cursor token for paginated list commands." },
      { flag: "--text", description: "Text payload for type and related commands." },
      { flag: "--clear", description: "Clear the existing input value before typing." },
      { flag: "--submit", description: "Submit the form or input after typing." },
      { flag: "--values", description: "CSV values for select commands." },
      { flag: "--files", description: "CSV file paths for upload commands." },
      { flag: "--dy", description: "Vertical scroll delta for scroll commands." },
      { flag: "--key", description: "Keyboard key for the press command." },
      { flag: "--attr", description: "DOM attribute name for dom-attr." },
      { flag: "--x", description: "Viewport x coordinate for pointer commands." },
      { flag: "--y", description: "Viewport y coordinate for pointer commands." },
      { flag: "--from-x", description: "Pointer drag start x coordinate." },
      { flag: "--from-y", description: "Pointer drag start y coordinate." },
      { flag: "--to-x", description: "Pointer drag end x coordinate." },
      { flag: "--to-y", description: "Pointer drag end y coordinate." },
      { flag: "--steps", description: "Interpolation step count for pointer move or drag commands." },
      { flag: "--button", description: "Pointer button selector for pointer down or up." },
      { flag: "--click-count", description: "Associated click count for pointer down or up." },
      { flag: "--name", description: "Named page identifier for page commands." },
      { flag: "--target-id", description: "Browser target id for target commands.", example: "opendevbrowser target-use --session-id s1 --target-id page-2" },
      { flag: "--tab-id", description: "Browser tab id override for extension and annotation commands." },
      { flag: "--include-urls", description: "Include page URLs in list output where supported." },
      { flag: "--path", description: "Filesystem path for command output or artifacts.", example: "opendevbrowser screenshot --session-id s1 --path ./shot.png" },
      { flag: "--full-page", description: "Capture the full scrollable page instead of the current viewport." },
      { flag: "--action", description: "Dialog action: status, accept, or dismiss." },
      { flag: "--prompt-text", description: "Prompt text to submit when accepting a prompt dialog." },
      { flag: "--since-seq", description: "Poll from a sequence id across diagnostics streams." },
      { flag: "--max", description: "Maximum number of records or items to return." },
      { flag: "--since-console-seq", description: "Console sequence cursor for debug-trace snapshots." },
      { flag: "--since-network-seq", description: "Network sequence cursor for debug-trace snapshots." },
      { flag: "--since-exception-seq", description: "Exception sequence cursor for debug-trace snapshots." },
      { flag: "--request-id", description: "Attach or lookup a request id for correlated output." },
      { flag: "--cookies", description: "Inline cookie payload for cookie-import." },
      { flag: "--cookies-file", description: "File path containing cookies for cookie-import." },
      { flag: "--strict", description: "Fail cookie import on invalid entries." },
      { flag: "--screenshot-mode", description: "Annotation screenshot mode: visible, full, or none." },
      { flag: "--debug", description: "Enable debug-level annotation capture extras." },
      { flag: "--context", description: "Free-form annotation context for reviewers or agents." },
      { flag: "--stored", description: "Return the last stored annotation payload instead of starting a new capture." }
    ]
  },
  {
    title: "Macro / Provider / Power Flags",
    summary: "Workflow filters, provider selectors, and unsafe RPC or /canvas options.",
    flags: [
      { flag: "--expression", description: "Macro expression to resolve or execute.", example: "opendevbrowser macro-resolve --expression '@web.search(\"openai\")'" },
      { flag: "--default-provider", description: "Provider fallback for shorthand macro expressions." },
      { flag: "--include-catalog", description: "Include macro catalog metadata in the response." },
      { flag: "--command", description: "Canvas command name for the canvas CLI command.", example: "opendevbrowser canvas --command canvas.session.open --params '{...}'" },
      { flag: "--execute", description: "Execute a resolved macro action after planning." },
      { flag: "--params", description: "Inline JSON params for canvas or rpc commands." },
      { flag: "--params-file", description: "Path to a JSON params file for canvas or rpc commands.", example: "opendevbrowser canvas --command canvas.plan.set --params-file ./plan.json" },
      { flag: "--unsafe-internal", description: "Required safety gate for the rpc command." },
      { flag: "--topic", description: "Research topic input." },
      { flag: "--days", description: "Lookback window in days for research commands." },
      { flag: "--from", description: "Start date boundary for research commands." },
      { flag: "--to", description: "End date boundary for research commands." },
      { flag: "--source-selection", description: "Research source-family selector." },
      { flag: "--sources", description: "Explicit source selectors within a source family." },
      { flag: "--include-engagement", description: "Include engagement metrics in research output." },
      { flag: "--limit-per-source", description: "Per-source result cap for research runs." },
      { flag: "--query", description: "Shopping query input." },
      { flag: "--providers", description: "Comma-separated provider ids for shopping or artifact commands." },
      { flag: "--budget", description: "Budget filter for shopping workflows." },
      { flag: "--region", description: "Region or country hint for provider selection." },
      { flag: "--sort", description: "Sort mode for shopping results." },
      { flag: "--product-url", description: "Target product URL for product-video workflows." },
      { flag: "--product-name", description: "Product name override for product-video workflows." },
      { flag: "--provider-hint", description: "Provider hint override for product workflows." },
      { flag: "--include-screenshots", description: "Include screenshots in product presentation output, or prefer screenshots when fetching stored annotations." },
      { flag: "--include-all-images", description: "Include all discovered product images." },
      { flag: "--include-copy", description: "Include product marketing copy metadata." },
      { flag: "--use-cookies", description: "Enable or disable provider cookie injection for workflow runs; a bare flag means true.", example: "opendevbrowser shopping run --query 'usb hub' --use-cookies" },
      { flag: "--browser-mode", description: "Shopping browser-fallback preference: auto, extension, or managed. Use extension to require the connected relay when browser recovery is needed.", example: "opendevbrowser shopping run --query 'macbook pro m4 32gb ram' --browser-mode extension" },
      { flag: "--challenge-automation-mode", description: "Per-run challenge automation mode for workflow runs and macro-resolve execute: off, browser, or browser_with_helper. Precedence is run > session > config, and the helper remains browser-scoped only.", example: "opendevbrowser macro-resolve --expression '@community.search(\"openai\")' --execute --challenge-automation-mode browser_with_helper" },
      { flag: "--cookie-policy-override", description: "Per-run workflow cookie policy override: off, auto, or required.", example: "opendevbrowser research run --topic 'agent workflows' --cookie-policy-override required" },
      { flag: "--cookie-policy", description: "Alias of --cookie-policy-override." },
      { flag: "--output-dir", description: "Directory where generated artifacts are written." },
      { flag: "--ttl-hours", description: "Artifact cache time-to-live in hours." },
      { flag: "--expired-only", description: "List only expired artifacts in artifacts commands." }
    ]
  }
];

export const HELP_TOOL_ENTRIES = TOOL_SURFACE_ENTRIES;

export const HELP_ONBOARDING_ENTRIES: readonly FormattableRow[] = [
  {
    label: "prompting_guide",
    description: "Load local best-practice guidance before low-level browser commands.",
    details: [{ label: "tool:", value: onboardingMetadata.quickStartCommands.promptingGuide }]
  },
  {
    label: "skill_load",
    description: `Load ${onboardingMetadata.skillName} ${onboardingMetadata.skillTopic} directly when you want the canonical quick-start section.`,
    details: [{ label: "tool:", value: onboardingMetadata.quickStartCommands.skillLoad }]
  },
  {
    label: "skill_list",
    description: "Inspect bundled and discovered skill packs when you need a different local lane.",
    details: [{ label: "tool:", value: onboardingMetadata.quickStartCommands.skillList }]
  },
  {
    label: "happy_path",
    description: "After guidance, verify a minimal managed happy path before widening into multi-step automation.",
    details: [{ label: "cli:", value: onboardingMetadata.quickStartCommands.happyPath }]
  },
  {
    label: "docs",
    description: "Use the first-run checklist and canonical skill runbook for proof and deeper operating details.",
    details: [{
      label: "paths:",
      value: `${onboardingMetadata.referencePaths.onboardingDoc}, ${onboardingMetadata.referencePaths.skillDoc}`
    }]
  }
];

export const HELP_REFERENCE_ENTRIES: readonly ReferenceEntry[] = [
  { label: "src/cli/onboarding-metadata.json", description: "Canonical first-contact onboarding metadata shared by help, nudges, and proof lanes." },
  { label: "src/public-surface/source.ts", description: "Authoritative command, usage, flag, and tool surface metadata." },
  { label: "src/public-surface/generated-manifest.ts", description: "Checked-in generated public-surface snapshot consumed by help and parity tests." },
  { label: "src/public-surface/generated-manifest.json", description: "Checked-in generated public-surface snapshot consumed by inventory scripts." },
  { label: "src/cli/args.ts", description: "CLI argument parsing backed by the public-surface source." },
  { label: "src/cli/help.ts", description: "Human-facing CLI formatting layered on the public-surface source." },
  { label: "src/tools/index.ts", description: "Code-level tool registry." },
  { label: "docs/CLI.md", description: "Detailed CLI guide and release-gate runbooks." },
  { label: onboardingMetadata.referencePaths.onboardingDoc, description: "First-run checklist for help-led onboarding and happy-path proof." },
  { label: onboardingMetadata.referencePaths.skillDoc, description: "Canonical bundled best-practices runbook and quick-start guidance." },
  { label: "docs/SURFACE_REFERENCE.md", description: "Canonical CLI, tool, and relay channel inventory." },
  { label: "opendevbrowser --help", description: "Primary full help invocation for quick discovery." },
  { label: "opendevbrowser help", description: "Alias that prints the same full help inventory." }
];

function formatRows(rows: readonly FormattableRow[]): string {
  return rows
    .map((row) => {
      const lines = [`  ${row.label.padEnd(LABEL_WIDTH)} ${row.description}`];
      for (const detail of row.details ?? []) {
        lines.push(`    ${detail.label.padEnd(DETAIL_LABEL_WIDTH)} ${detail.value}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function getCommandDescriptions(): Map<string, string> {
  const descriptions = new Map<string, string>();
  for (const definition of listCommands()) {
    descriptions.set(definition.name, definition.description);
  }
  return descriptions;
}

function assertCommandCoverage(commandDescriptions: Map<string, string>): void {
  const seen = new Set<string>();

  for (const group of HELP_COMMAND_GROUPS) {
    for (const command of group.commands) {
      const detail = COMMAND_HELP_DETAILS[command];
      if (!COMMAND_SET.has(command)) {
        throw new Error(`Help references unknown CLI command: ${command}`);
      }
      if (!commandDescriptions.has(command)) {
        throw new Error(`Help references unregistered CLI command: ${command}`);
      }
      if (seen.has(command)) {
        throw new Error(`Help command appears multiple times: ${command}`);
      }
      if (!detail || !detail.usage.trim()) {
        throw new Error(`Missing command help metadata: ${command}`);
      }
      for (const flag of detail.flags) {
        if (!FLAG_SET.has(flag)) {
          throw new Error(`Command help metadata references unknown flag ${flag} for ${command}`);
        }
      }
      seen.add(command);
    }
  }

  if (seen.size !== CLI_COMMANDS.length) {
    const missing = CLI_COMMANDS.filter((command) => !seen.has(command));
    throw new Error(`Help command coverage mismatch; missing: ${missing.join(", ")}`);
  }
}

function assertFlagCoverage(): void {
  const seen = new Set<string>();

  for (const group of HELP_FLAG_GROUPS) {
    for (const entry of group.flags) {
      if (!FLAG_SET.has(entry.flag)) {
        throw new Error(`Help references unknown CLI flag: ${entry.flag}`);
      }
      if (seen.has(entry.flag)) {
        throw new Error(`Help flag appears multiple times: ${entry.flag}`);
      }
      seen.add(entry.flag);
    }
  }

  if (seen.size !== VALID_FLAGS.length) {
    const missing = VALID_FLAGS.filter((flag) => !seen.has(flag));
    throw new Error(`Help flag coverage mismatch; missing: ${missing.join(", ")}`);
  }
}

function assertToolCoverage(): void {
  const seen = new Set<string>();

  for (const entry of HELP_TOOL_ENTRIES) {
    if (!entry.name.startsWith("opendevbrowser_")) {
      throw new Error(`Invalid tool name in help inventory: ${entry.name}`);
    }
    if (!entry.description.trim()) {
      throw new Error(`Help tool is missing a description: ${entry.name}`);
    }
    if (seen.has(entry.name)) {
      throw new Error(`Help tool appears multiple times: ${entry.name}`);
    }
    if (entry.cliEquivalent && !COMMAND_SET.has(entry.cliEquivalent)) {
      throw new Error(`Tool metadata references unknown CLI command: ${entry.cliEquivalent}`);
    }
    seen.add(entry.name);
  }

  if (HELP_TOOL_ENTRIES.length !== TOOL_COUNT) {
    throw new Error(`Help tool inventory must list ${TOOL_COUNT} tools; got ${HELP_TOOL_ENTRIES.length}`);
  }
}

function formatCommandGroups(commandDescriptions: Map<string, string>): string {
  return HELP_COMMAND_GROUPS
    .map((group) => {
      const rows: FormattableRow[] = group.commands.map((command) => {
        const detail = COMMAND_HELP_DETAILS[command];
        return {
          label: command,
          description: commandDescriptions.get(command) ?? "Missing command description.",
          details: [
            { label: "usage:", value: detail.usage },
            { label: "flags:", value: formatFlags(detail.flags) }
          ]
        };
      });
      return `${group.title}: ${group.summary}\n${formatRows(rows)}`;
    })
    .join("\n\n");
}

function formatFlagGroups(): string {
  return HELP_FLAG_GROUPS
    .map((group) => {
      const rows: FormattableRow[] = group.flags.map((entry) => ({
        label: entry.alias ? `${entry.flag} (${entry.alias})` : entry.flag,
        description: entry.description,
        details: entry.example ? [{ label: "example:", value: entry.example }] : []
      }));
      return `${group.title}: ${group.summary}\n${formatRows(rows)}`;
    })
    .join("\n\n");
}

function formatToolEntries(): string {
  return formatRows(HELP_TOOL_ENTRIES.map((entry) => ({
    label: entry.name,
    description: entry.description,
    details: entry.cliEquivalent
      ? [{ label: "cli:", value: entry.cliEquivalent }]
      : [{ label: "scope:", value: "tool-only" }]
  })));
}

function formatOnboardingEntries(): string {
  return formatRows(HELP_ONBOARDING_ENTRIES);
}

function formatReferenceEntries(): string {
  return formatRows(HELP_REFERENCE_ENTRIES.map((entry) => ({
    label: entry.label,
    description: entry.description
  })));
}

export function getHelpText(): string {
  const commandDescriptions = getCommandDescriptions();
  assertCommandCoverage(commandDescriptions);
  assertFlagCoverage();
  assertToolCoverage();

  return [
    "OpenDevBrowser CLI",
    "",
    "Usage:",
    "  npx opendevbrowser <command> [options]",
    "",
    `${onboardingMetadata.sectionTitle}:`,
    `  ${onboardingMetadata.sectionSummary}`,
    formatOnboardingEntries(),
    "",
    `Command Inventory (all ${CLI_COMMANDS.length} commands):`,
    formatCommandGroups(commandDescriptions),
    "",
    "Flag Inventory (all supported flags):",
    formatFlagGroups(),
    "",
    `Tool Inventory (all ${TOOL_COUNT} opendevbrowser_* tools):`,
    formatToolEntries(),
    "",
    "Reference Pointers:",
    formatReferenceEntries()
  ].join("\n");
}
