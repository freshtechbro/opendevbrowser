import type { CliCommand } from "./args";
import { CLI_COMMANDS, VALID_FLAGS } from "./args";
import { listCommands } from "./commands/registry";

type HelpFlag = (typeof VALID_FLAGS)[number];

interface CommandGroup {
  title: string;
  summary: string;
  commands: readonly CliCommand[];
}

interface FlagEntry {
  flag: HelpFlag;
  alias?: string;
  description: string;
}

interface FlagGroup {
  title: string;
  summary: string;
  flags: readonly FlagEntry[];
}

interface ToolEntry {
  name: string;
  description: string;
}

interface ReferenceEntry {
  label: string;
  description: string;
}

const LABEL_WIDTH = 42;
const EXPECTED_TOOL_COUNT = 48;
const COMMAND_SET = new Set<string>(CLI_COMMANDS);
const FLAG_SET = new Set<string>(VALID_FLAGS);

export const HELP_COMMAND_GROUPS: readonly CommandGroup[] = [
  {
    title: "Install & Lifecycle",
    summary: "Install, remove, and inspect CLI basics.",
    commands: ["install", "update", "uninstall", "help", "version"]
  },
  {
    title: "Daemon & Runtime",
    summary: "Run daemon services and single-process scripts.",
    commands: ["serve", "daemon", "native", "run"]
  },
  {
    title: "Session Lifecycle",
    summary: "Launch/connect sessions and manage browser state.",
    commands: ["launch", "connect", "disconnect", "status", "cookie-import", "cookie-list"]
  },
  {
    title: "Provider Workflows",
    summary: "Run research/shopping/media workflows and macro plans.",
    commands: ["research", "shopping", "product-video", "artifacts", "macro-resolve"]
  },
  {
    title: "Navigation",
    summary: "Move through pages and capture fresh refs.",
    commands: ["goto", "wait", "snapshot"]
  },
  {
    title: "Interaction",
    summary: "Perform ref-based interactions in the active page.",
    commands: ["click", "hover", "press", "check", "uncheck", "type", "select", "scroll", "scroll-into-view"]
  },
  {
    title: "Targets & Pages",
    summary: "Manage tabs/targets and named pages.",
    commands: ["targets-list", "target-use", "target-new", "target-close", "page", "pages", "page-close"]
  },
  {
    title: "DOM & Export",
    summary: "Read DOM state and export page/component code.",
    commands: ["dom-html", "dom-text", "dom-attr", "dom-value", "dom-visible", "dom-enabled", "dom-checked", "clone-page", "clone-component"]
  },
  {
    title: "Diagnostics & Annotation",
    summary: "Collect runtime diagnostics and annotation payloads.",
    commands: ["perf", "screenshot", "console-poll", "network-poll", "debug-trace-snapshot", "annotate"]
  },
  {
    title: "Power",
    summary: "Unsafe internal command passthrough.",
    commands: ["rpc"]
  }
];

export const HELP_FLAG_GROUPS: readonly FlagGroup[] = [
  {
    title: "Install/Global Flags",
    summary: "Control installation scope and setup behavior.",
    flags: [
      { flag: "--global", alias: "-g", description: "Install into ~/.config/opencode/opencode.json." },
      { flag: "--local", alias: "-l", description: "Install into ./opencode.json for this project." },
      { flag: "--update", alias: "-u", description: "Alias for the update command." },
      { flag: "--uninstall", description: "Alias for the uninstall command." },
      { flag: "--with-config", description: "Also create opendevbrowser.jsonc defaults." },
      { flag: "--full", alias: "-f", description: "Install config and pre-extract extension assets." },
      { flag: "--no-prompt", description: "Run non-interactively using defaults." },
      { flag: "--no-interactive", description: "Alias of --no-prompt." },
      { flag: "--quiet", description: "Suppress non-error text output." },
      { flag: "--skills-global", description: "Install bundled skills into global agent directories." },
      { flag: "--skills-local", description: "Install bundled skills into local project agent directories." },
      { flag: "--no-skills", description: "Skip bundled skill installation." }
    ]
  },
  {
    title: "Help/Output Flags",
    summary: "Inspect help/version and control output transport.",
    flags: [
      { flag: "--help", alias: "-h", description: "Show CLI help output." },
      { flag: "--version", alias: "-v", description: "Show CLI version." },
      { flag: "--output-format", description: "Output mode: text, json, stream-json." },
      { flag: "--transport", description: "Annotation transport: relay (default) or native." }
    ]
  },
  {
    title: "Daemon/Session/Launch Flags",
    summary: "Control daemon binding, connect, and launch behavior.",
    flags: [
      { flag: "--port", description: "Daemon or relay port override." },
      { flag: "--token", description: "Relay/daemon auth token override." },
      { flag: "--stop", description: "Stop a running daemon." },
      { flag: "--daemon", description: "Target daemon status mode where supported." },
      { flag: "--script", description: "Path to a run-script JSON file." },
      { flag: "--session-id", description: "Target an existing daemon session." },
      { flag: "--close-browser", description: "Close managed browser on disconnect." },
      { flag: "--ws-endpoint", description: "Connect using explicit CDP WebSocket endpoint." },
      { flag: "--host", description: "CDP host for host/port connect mode." },
      { flag: "--cdp-port", description: "CDP port for host/port connect mode." },
      { flag: "--headless", description: "Launch managed browser in headless mode." },
      { flag: "--profile", description: "Use a named browser profile directory." },
      { flag: "--persist-profile", description: "Keep generated profile directory after exit." },
      { flag: "--chrome-path", description: "Use a specific Chrome/Chromium binary." },
      { flag: "--start-url", description: "Open this URL immediately after launch." },
      { flag: "--flag", description: "Pass one or more extra Chrome CLI flags." },
      { flag: "--no-extension", description: "Force managed mode without extension relay." },
      { flag: "--extension-only", description: "Fail unless extension relay is connected." },
      { flag: "--extension-legacy", description: "Use legacy /cdp relay mode instead of /ops." },
      { flag: "--wait-for-extension", description: "Wait for extension handshake before returning." },
      { flag: "--wait-timeout-ms", description: "Handshake wait timeout in milliseconds." }
    ]
  },
  {
    title: "Navigation/Interaction/Diagnostics Flags",
    summary: "Command-specific flags for page actions and diagnostics.",
    flags: [
      { flag: "--url", description: "Target URL for navigation, connect, or workflow commands." },
      { flag: "--wait-until", description: "Navigation wait strategy (load, domcontentloaded, etc.)." },
      { flag: "--timeout-ms", description: "Operation timeout in milliseconds (for example goto, wait, screenshot, annotate, rpc, and macro-resolve)." },
      { flag: "--ref", description: "Snapshot ref id for element-targeted commands." },
      { flag: "--state", description: "Wait state selector for wait-style commands." },
      { flag: "--until", description: "Wait condition selector for wait-style commands." },
      { flag: "--mode", description: "Mode selector for commands that accept variants." },
      { flag: "--max-chars", description: "Maximum text characters to return for DOM reads." },
      { flag: "--cursor", description: "Cursor token for paginated list commands." },
      { flag: "--text", description: "Text payload for type and related commands." },
      { flag: "--clear", description: "Clear existing input value before typing." },
      { flag: "--submit", description: "Submit form/input after typing." },
      { flag: "--values", description: "CSV values for select commands." },
      { flag: "--dy", description: "Vertical scroll delta for scroll commands." },
      { flag: "--key", description: "Keyboard key for press command." },
      { flag: "--attr", description: "DOM attribute name for dom-attr command." },
      { flag: "--name", description: "Named page identifier for page commands." },
      { flag: "--target-id", description: "Browser target id for target commands." },
      { flag: "--tab-id", description: "Browser tab id override for extension/annotation commands." },
      { flag: "--include-urls", description: "Include page URLs in list output where supported." },
      { flag: "--path", description: "Filesystem path for command output/artifacts." },
      { flag: "--since-seq", description: "Poll from sequence id across diagnostics streams." },
      { flag: "--max", description: "Maximum number of records/items to return." },
      { flag: "--since-console-seq", description: "Console sequence cursor for debug trace snapshots." },
      { flag: "--since-network-seq", description: "Network sequence cursor for debug trace snapshots." },
      { flag: "--since-exception-seq", description: "Exception sequence cursor for debug trace snapshots." },
      { flag: "--request-id", description: "Attach/lookup request id for correlateable output." },
      { flag: "--cookies", description: "Inline cookie payload for cookie-import command." },
      { flag: "--cookies-file", description: "File path containing cookies for cookie-import." },
      { flag: "--strict", description: "Fail cookie import on invalid entries." },
      { flag: "--screenshot-mode", description: "Annotation screenshot mode: crop, full, or none." },
      { flag: "--debug", description: "Enable debug-level annotation capture extras." },
      { flag: "--context", description: "Free-form annotation context for reviewers/agents." }
    ]
  },
  {
    title: "Macro/Provider/Power Flags",
    summary: "Workflow filters, provider selectors, and unsafe RPC options.",
    flags: [
      { flag: "--expression", description: "Macro expression to resolve/execute." },
      { flag: "--default-provider", description: "Provider fallback for shorthand macro expressions." },
      { flag: "--include-catalog", description: "Include macro catalog metadata in response." },
      { flag: "--execute", description: "Execute resolved macro action after planning (pair with --timeout-ms on slow runs)." },
      { flag: "--params", description: "Inline JSON params for rpc command." },
      { flag: "--params-file", description: "Path to JSON params file for rpc command." },
      { flag: "--unsafe-internal", description: "Required safety gate for rpc command." },
      { flag: "--topic", description: "Research topic input." },
      { flag: "--days", description: "Lookback window in days for research commands." },
      { flag: "--from", description: "Start date boundary for research commands." },
      { flag: "--to", description: "End date boundary for research commands." },
      { flag: "--source-selection", description: "Research source-family selector." },
      { flag: "--sources", description: "Explicit source selectors within a source family." },
      { flag: "--include-engagement", description: "Include engagement metrics in research output." },
      { flag: "--limit-per-source", description: "Per-source result cap for research runs." },
      { flag: "--query", description: "Shopping query input." },
      { flag: "--providers", description: "Comma-separated provider ids for shopping/artifacts." },
      { flag: "--budget", description: "Budget filter for shopping workflows." },
      { flag: "--region", description: "Region/country hint for provider selection." },
      { flag: "--sort", description: "Sort mode for shopping results." },
      { flag: "--product-url", description: "Target product URL for product-video/artifacts workflows." },
      { flag: "--product-name", description: "Product name override for media workflows." },
      { flag: "--provider-hint", description: "Provider hint override for product workflows." },
      { flag: "--include-screenshots", description: "Include screenshots in product presentation output." },
      { flag: "--include-all-images", description: "Include all discovered product images." },
      { flag: "--include-copy", description: "Include product marketing copy metadata." },
      { flag: "--output-dir", description: "Directory where generated artifacts are written." },
      { flag: "--ttl-hours", description: "Artifact cache time-to-live in hours." },
      { flag: "--expired-only", description: "List only expired artifacts in artifacts commands." }
    ]
  }
];

export const HELP_TOOL_ENTRIES: readonly ToolEntry[] = [
  { name: "opendevbrowser_launch", description: "Launch a managed browser session." },
  { name: "opendevbrowser_connect", description: "Connect to an existing browser session." },
  { name: "opendevbrowser_disconnect", description: "Disconnect a managed or connected session." },
  { name: "opendevbrowser_status", description: "Inspect session and relay status." },
  { name: "opendevbrowser_targets_list", description: "List available page targets/tabs." },
  { name: "opendevbrowser_target_use", description: "Switch active target by id." },
  { name: "opendevbrowser_target_new", description: "Create a new target/tab." },
  { name: "opendevbrowser_target_close", description: "Close target/tab by id." },
  { name: "opendevbrowser_page", description: "Open or focus a named page." },
  { name: "opendevbrowser_list", description: "List named pages in the session." },
  { name: "opendevbrowser_close", description: "Close a named page." },
  { name: "opendevbrowser_goto", description: "Navigate to a URL." },
  { name: "opendevbrowser_wait", description: "Wait for load/ref/state conditions." },
  { name: "opendevbrowser_snapshot", description: "Capture AX-tree refs for actions." },
  { name: "opendevbrowser_click", description: "Click an element by ref." },
  { name: "opendevbrowser_hover", description: "Hover an element by ref." },
  { name: "opendevbrowser_press", description: "Send a keyboard key." },
  { name: "opendevbrowser_check", description: "Check checkbox/radio by ref." },
  { name: "opendevbrowser_uncheck", description: "Uncheck checkbox/radio by ref." },
  { name: "opendevbrowser_type", description: "Type text into an input by ref." },
  { name: "opendevbrowser_select", description: "Set select values by ref." },
  { name: "opendevbrowser_scroll", description: "Scroll page or element." },
  { name: "opendevbrowser_scroll_into_view", description: "Scroll target element into view." },
  { name: "opendevbrowser_dom_get_html", description: "Get HTML for page or ref." },
  { name: "opendevbrowser_dom_get_text", description: "Get text for page or ref." },
  { name: "opendevbrowser_get_attr", description: "Read a DOM attribute by ref." },
  { name: "opendevbrowser_get_value", description: "Read form/control value by ref." },
  { name: "opendevbrowser_is_visible", description: "Check ref visibility." },
  { name: "opendevbrowser_is_enabled", description: "Check ref enabled state." },
  { name: "opendevbrowser_is_checked", description: "Check ref checked state." },
  { name: "opendevbrowser_run", description: "Execute multi-action automation scripts." },
  { name: "opendevbrowser_prompting_guide", description: "Return best-practice prompting guidance." },
  { name: "opendevbrowser_console_poll", description: "Poll redacted console events." },
  { name: "opendevbrowser_network_poll", description: "Poll redacted network events." },
  { name: "opendevbrowser_debug_trace_snapshot", description: "Capture page + console + network diagnostics." },
  { name: "opendevbrowser_cookie_import", description: "Import validated cookies into session." },
  { name: "opendevbrowser_cookie_list", description: "List cookies in session with optional URL filters." },
  { name: "opendevbrowser_macro_resolve", description: "Resolve/execute provider macro expressions." },
  { name: "opendevbrowser_research_run", description: "Run research workflow directly." },
  { name: "opendevbrowser_shopping_run", description: "Run shopping workflow directly." },
  { name: "opendevbrowser_product_video_run", description: "Run product-video asset workflow directly." },
  { name: "opendevbrowser_clone_page", description: "Export active page into React code." },
  { name: "opendevbrowser_clone_component", description: "Export component by ref into React code." },
  { name: "opendevbrowser_perf", description: "Collect browser performance metrics." },
  { name: "opendevbrowser_screenshot", description: "Capture page screenshot." },
  { name: "opendevbrowser_annotate", description: "Capture interactive annotations." },
  { name: "opendevbrowser_skill_list", description: "List available skill packs." },
  { name: "opendevbrowser_skill_load", description: "Load a specific skill pack." }
];

const HELP_REFERENCE_ENTRIES: readonly ReferenceEntry[] = [
  { label: "docs/CLI.md", description: "Full command docs, flag matrix, and examples." },
  { label: "docs/SURFACE_REFERENCE.md", description: "Canonical CLI/tool/channel inventory matrix." },
  { label: "src/tools/index.ts", description: "Code-level tool registry (source of truth)." },
  { label: "opendevbrowser --help", description: "Always safe first command for quick discovery." }
];

function formatRows(rows: readonly { label: string; description: string }[]): string {
  return rows
    .map((row) => `  ${row.label.padEnd(LABEL_WIDTH)} ${row.description}`)
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
      if (!COMMAND_SET.has(command)) {
        throw new Error(`Help references unknown CLI command: ${command}`);
      }
      if (!commandDescriptions.has(command)) {
        throw new Error(`Help references unregistered CLI command: ${command}`);
      }
      if (seen.has(command)) {
        throw new Error(`Help command appears multiple times: ${command}`);
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
  if (HELP_TOOL_ENTRIES.length !== EXPECTED_TOOL_COUNT) {
    throw new Error(`Help tool inventory must list ${EXPECTED_TOOL_COUNT} tools; got ${HELP_TOOL_ENTRIES.length}`);
  }

  const seen = new Set<string>();
  for (const entry of HELP_TOOL_ENTRIES) {
    if (seen.has(entry.name)) {
      throw new Error(`Help tool appears multiple times: ${entry.name}`);
    }
    if (!entry.name.startsWith("opendevbrowser_")) {
      throw new Error(`Invalid tool name in help inventory: ${entry.name}`);
    }
    seen.add(entry.name);
  }
}

function formatCommandGroups(commandDescriptions: Map<string, string>): string {
  return HELP_COMMAND_GROUPS
    .map((group) => {
      const rows = group.commands.map((command) => ({
        label: command,
        description: commandDescriptions.get(command) ?? "Missing command description."
      }));
      return `${group.title}: ${group.summary}\n${formatRows(rows)}`;
    })
    .join("\n\n");
}

function formatFlagGroups(): string {
  return HELP_FLAG_GROUPS
    .map((group) => {
      const rows = group.flags.map((entry) => ({
        label: entry.alias ? `${entry.flag} (${entry.alias})` : entry.flag,
        description: entry.description
      }));
      return `${group.title}: ${group.summary}\n${formatRows(rows)}`;
    })
    .join("\n\n");
}

function formatToolEntries(): string {
  return formatRows(HELP_TOOL_ENTRIES.map((entry) => ({
    label: entry.name,
    description: entry.description
  })));
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
    `Command Inventory (all ${CLI_COMMANDS.length} commands):`,
    formatCommandGroups(commandDescriptions),
    "",
    "Flag Inventory (all supported flags):",
    formatFlagGroups(),
    "",
    `Tool Inventory (all ${EXPECTED_TOOL_COUNT} opendevbrowser_* tools):`,
    formatToolEntries(),
    "",
    "Reference Pointers:",
    formatReferenceEntries()
  ].join("\n");
}
