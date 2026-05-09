export const PUBLIC_SURFACE_MANIFEST_SCHEMA_VERSION = "2026-04-04" as const;

export const VALID_FLAGS = [
  "--global", "--local", "--update", "--uninstall",
  "--help", "--version", "--with-config", "--no-prompt",
  "--no-interactive", "--quiet", "--output-format",
  "--full",
  "--port", "--token", "--stop",
  "--script", "--headless", "--profile", "--persist-profile", "--chrome-path", "--start-url", "--flag",
  "--session-id", "--close-browser", "--ws-endpoint", "--host", "--cdp-port",
  "--url", "--wait-until", "--timeout-ms", "--ref", "--state", "--until", "--mode", "--max-chars", "--cursor",
  "--text", "--clear", "--submit", "--values", "--files", "--dy", "--key", "--attr",
  "--x", "--y", "--from-x", "--from-y", "--to-x", "--to-y", "--steps", "--button", "--click-count",
  "--name", "--target-id", "--window-id", "--tab-id", "--include-urls", "--path", "--screencast-id", "--reason", "--full-page", "--action", "--prompt-text", "--since-seq", "--max", "--interval-ms", "--max-frames",
  "--since-console-seq", "--since-network-seq", "--since-exception-seq", "--request-id",
  "--cookies", "--cookies-file", "--strict",
  "--expression", "--default-provider", "--include-catalog",
  "--command",
  "--execute",
  "--params", "--params-file", "--unsafe-internal",
  "--daemon",
  "--transport",
  "--no-extension", "--extension-only", "--extension-legacy", "--wait-for-extension", "--wait-timeout-ms",
  "--skills-global", "--skills-local", "--no-skills",
  "--screenshot-mode", "--debug", "--context",
  "--stored",
  "--topic", "--days", "--from", "--to", "--source-selection", "--sources", "--include-engagement", "--limit-per-source",
  "--query", "--providers", "--budget", "--region", "--browser-mode", "--sort",
  "--brief", "--capture-mode", "--include-prototype-guidance",
  "--product-url", "--product-name", "--provider-hint", "--include-screenshots", "--include-all-images", "--include-copy",
  "--use-cookies", "--challenge-automation-mode", "--cookie-policy-override", "--cookie-policy",
  "--output-dir", "--ttl-hours", "--expired-only"
] as const;

export type PublicSurfaceFlagName = (typeof VALID_FLAGS)[number];
type PublicSurfaceFlagKind = "boolean" | "value";

export interface PublicSurfaceFlag {
  name: PublicSurfaceFlagName;
  kind: PublicSurfaceFlagKind;
}

export const VALID_EQUALS_FLAGS = [
  "--output-format",
  "--transport",
  "--session-id",
  "--url",
  "--screenshot-mode",
  "--context",
  "--timeout-ms",
  "--since-seq",
  "--since-console-seq",
  "--since-network-seq",
  "--since-exception-seq",
  "--max",
  "--dy",
  "--target-id",
  "--window-id",
  "--tab-id",
  "--name",
  "--cookies",
  "--cookies-file",
  "--persist-profile",
  "--expression",
  "--default-provider",
  "--command",
  "--request-id",
  "--strict",
  "--params",
  "--params-file",
  "--topic",
  "--days",
  "--from",
  "--to",
  "--source-selection",
  "--sources",
  "--mode",
  "--ref",
  "--path",
  "--screencast-id",
  "--reason",
  "--interval-ms",
  "--max-frames",
  "--max-chars",
  "--cursor",
  "--files",
  "--action",
  "--prompt-text",
  "--limit-per-source",
  "--query",
  "--providers",
  "--budget",
  "--region",
  "--sort",
  "--brief",
  "--capture-mode",
  "--product-url",
  "--product-name",
  "--provider-hint",
  "--include-prototype-guidance",
  "--x",
  "--y",
  "--from-x",
  "--from-y",
  "--to-x",
  "--to-y",
  "--steps",
  "--button",
  "--click-count",
  "--include-screenshots",
  "--include-all-images",
  "--include-copy",
  "--use-cookies",
  "--browser-mode",
  "--challenge-automation-mode",
  "--cookie-policy-override",
  "--cookie-policy",
  "--output-dir",
  "--ttl-hours"
] as const;

interface PublicSurfaceCliCommandDefinition {
  name: string;
  description: string;
  usage: string;
  flags: readonly PublicSurfaceFlagName[];
}

export interface PublicSurfaceCliCommandGroupDefinition {
  id: string;
  title: string;
  summary: string;
  commands: readonly PublicSurfaceCliCommandDefinition[];
}

export const PUBLIC_CLI_COMMAND_GROUPS = [
  {
    id: "install_lifecycle",
    title: "Install & Lifecycle",
    summary: "Install, remove, and inspect CLI basics.",
    commands: [
      {
        name: "install",
        description: "Install the plugin and sync bundled skill packs",
        usage: "npx opendevbrowser [--global|--local] [--with-config] [--full] [--skills-global|--skills-local|--no-skills] [--no-prompt] [--quiet]",
        flags: ["--global", "--local", "--with-config", "--full", "--skills-global", "--skills-local", "--no-skills", "--no-prompt", "--quiet"]
      },
      {
        name: "update",
        description: "Repair cached plugin pins and refresh managed skill packs",
        usage: "npx opendevbrowser update [--global|--local] [--skills-global|--skills-local|--no-skills]",
        flags: ["--global", "--local", "--skills-global", "--skills-local", "--no-skills"]
      },
      {
        name: "uninstall",
        description: "Remove plugin from config and clean managed skill packs",
        usage: "npx opendevbrowser uninstall [--global|--local] [--no-skills] [--no-prompt] [--quiet]",
        flags: ["--global", "--local", "--no-skills", "--no-prompt", "--quiet"]
      },
      {
        name: "help",
        description: "Show help",
        usage: "npx opendevbrowser --help | npx opendevbrowser help",
        flags: ["--help"]
      },
      {
        name: "version",
        description: "Show version",
        usage: "npx opendevbrowser --version | npx opendevbrowser version",
        flags: ["--version"]
      }
    ]
  },
  {
    id: "daemon_runtime",
    title: "Daemon & Runtime",
    summary: "Run daemon services and single-process scripts.",
    commands: [
      {
        name: "serve",
        description: "Start or stop the local daemon",
        usage: "npx opendevbrowser serve [--port <port>] [--token <token>] [--stop]",
        flags: ["--port", "--token", "--stop"]
      },
      {
        name: "daemon",
        description: "Install/uninstall/status daemon auto-start",
        usage: "npx opendevbrowser daemon <install|uninstall|status>",
        flags: ["--output-format"]
      },
      {
        name: "native",
        description: "Install/uninstall/status native messaging host",
        usage: "npx opendevbrowser native <install|uninstall|status> [extension-id]",
        flags: ["--output-format"]
      },
      {
        name: "run",
        description: "Execute a JSON script in a single process",
        usage: "npx opendevbrowser run --script <path> [--headless] [--profile <name>] [--persist-profile <bool>] [--chrome-path <path>] [--start-url <url>] [--flag <chrome-arg>]",
        flags: ["--script", "--headless", "--profile", "--persist-profile", "--chrome-path", "--start-url", "--flag"]
      }
    ]
  },
  {
    id: "session_lifecycle",
    title: "Session Lifecycle",
    summary: "Launch, connect, and manage browser session state.",
    commands: [
      {
        name: "launch",
        description: "Launch a managed browser session via daemon",
        usage: "npx opendevbrowser launch [--headless] [--profile <name>] [--persist-profile <bool>] [--chrome-path <path>] [--start-url <url>] [--flag <chrome-arg>] [--no-extension|--extension-only] [--extension-legacy] [--wait-for-extension] [--wait-timeout-ms <ms>]",
        flags: ["--headless", "--profile", "--persist-profile", "--chrome-path", "--start-url", "--flag", "--no-extension", "--extension-only", "--extension-legacy", "--wait-for-extension", "--wait-timeout-ms"]
      },
      {
        name: "connect",
        description: "Connect to an existing browser via daemon",
        usage: "npx opendevbrowser connect (--ws-endpoint <url> | --host <host> --cdp-port <port>) [--start-url <url>] [--extension-legacy]",
        flags: ["--ws-endpoint", "--host", "--cdp-port", "--start-url", "--extension-legacy"]
      },
      {
        name: "disconnect",
        description: "Disconnect a daemon session",
        usage: "npx opendevbrowser disconnect --session-id <id> [--close-browser]",
        flags: ["--session-id", "--close-browser"]
      },
      {
        name: "status",
        description: "Get daemon or session status",
        usage: "npx opendevbrowser status [--session-id <id> | --daemon] [--transport <relay|native>]",
        flags: ["--session-id", "--daemon", "--transport"]
      },
      {
        name: "status-capabilities",
        description: "Inspect runtime capability discovery for the host and an optional session",
        usage: "npx opendevbrowser status-capabilities [--session-id <id>] [--target-id <id>] [--challenge-automation-mode <mode>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--challenge-automation-mode", "--timeout-ms"]
      },
      {
        name: "cookie-import",
        description: "Import validated cookies into a session",
        usage: "npx opendevbrowser cookie-import --session-id <id> (--cookies <json> | --cookies-file <path>) [--strict <bool>]",
        flags: ["--session-id", "--cookies", "--cookies-file", "--strict"]
      },
      {
        name: "cookie-list",
        description: "List cookies for a session (optionally filtered by URL)",
        usage: "npx opendevbrowser cookie-list --session-id <id> [--url <url>]",
        flags: ["--session-id", "--url"]
      }
    ]
  },
  {
    id: "provider_workflows",
    title: "Provider Workflows",
    summary: "Run research, shopping, media, and artifact workflows.",
    commands: [
      {
        name: "research",
        description: "Run research workflows",
        usage: "npx opendevbrowser research run --topic <text> [--days <n>|--from <date> --to <date>] [--source-selection <family>] [--sources <csv>] [--include-engagement] [--limit-per-source <n>] [--browser-mode <mode>] [--mode <mode>] [--timeout-ms <ms>] [--output-dir <path>] [--ttl-hours <n>] [--use-cookies[=<bool>]] [--challenge-automation-mode <mode>] [--cookie-policy-override <policy>]",
        flags: ["--topic", "--days", "--from", "--to", "--source-selection", "--sources", "--include-engagement", "--limit-per-source", "--browser-mode", "--mode", "--timeout-ms", "--output-dir", "--ttl-hours", "--use-cookies", "--challenge-automation-mode", "--cookie-policy-override", "--cookie-policy"]
      },
      {
        name: "shopping",
        description: "Run shopping workflows",
        usage: "npx opendevbrowser shopping run --query <text> [--providers <csv>] [--budget <amount>] [--region <region>] [--browser-mode <mode>] [--sort <mode>] [--mode <mode>] [--timeout-ms <ms>] [--output-dir <path>] [--ttl-hours <n>] [--use-cookies[=<bool>]] [--challenge-automation-mode <mode>] [--cookie-policy-override <policy>]",
        flags: ["--query", "--providers", "--budget", "--region", "--browser-mode", "--sort", "--mode", "--timeout-ms", "--output-dir", "--ttl-hours", "--use-cookies", "--challenge-automation-mode", "--cookie-policy-override", "--cookie-policy"]
      },
      {
        name: "product-video",
        description: "Run product presentation asset workflows",
        usage: "npx opendevbrowser product-video run (--product-url <url> | --product-name <name>) [--provider-hint <provider>] [--include-screenshots[=<bool>]] [--include-all-images[=<bool>]] [--include-copy[=<bool>]] [--timeout-ms <ms>] [--browser-mode <mode>] [--use-cookies[=<bool>]] [--challenge-automation-mode <mode>] [--cookie-policy-override <policy>] [--output-dir <path>] [--ttl-hours <n>]",
        flags: ["--product-url", "--product-name", "--provider-hint", "--include-screenshots", "--include-all-images", "--include-copy", "--timeout-ms", "--browser-mode", "--use-cookies", "--challenge-automation-mode", "--cookie-policy-override", "--cookie-policy", "--output-dir", "--ttl-hours"]
      },
      {
        name: "inspiredesign",
        description: "Run inspiredesign workflows",
        usage: "npx opendevbrowser inspiredesign run --brief <text> [--url <url>]... [--capture-mode <mode>] [--include-prototype-guidance[=<bool>]] [--mode <mode>] [--timeout-ms <ms>] [--output-dir <path>] [--ttl-hours <n>] [--browser-mode <mode>] [--use-cookies[=<bool>]] [--challenge-automation-mode <mode>] [--cookie-policy-override <policy>]",
        flags: ["--brief", "--url", "--capture-mode", "--include-prototype-guidance", "--mode", "--timeout-ms", "--output-dir", "--ttl-hours", "--browser-mode", "--use-cookies", "--challenge-automation-mode", "--cookie-policy-override", "--cookie-policy"]
      },
      {
        name: "artifacts",
        description: "Manage workflow artifact lifecycle",
        usage: "npx opendevbrowser artifacts cleanup [--expired-only] [--output-dir <path>]",
        flags: ["--expired-only", "--output-dir"]
      },
      {
        name: "macro-resolve",
        description: "Resolve or execute a macro expression via provider actions",
        usage: "npx opendevbrowser macro-resolve --expression <macro> [--default-provider <provider>] [--include-catalog] [--execute [--timeout-ms <ms>] [--browser-mode <mode>] [--challenge-automation-mode <mode>]]",
        flags: ["--expression", "--default-provider", "--include-catalog", "--execute", "--timeout-ms", "--browser-mode", "--challenge-automation-mode"]
      }
    ]
  },
  {
    id: "design_canvas",
    title: "Design Canvas",
    summary: "Execute typed /canvas commands for session, document, preview, and code-sync flows.",
    commands: [
      {
        name: "canvas",
        description: "Execute a design-canvas command",
        usage: "npx opendevbrowser canvas --command <canvas.command> [--params <json> | --params-file <path>] [--timeout-ms <ms>]",
        flags: ["--command", "--params", "--params-file", "--timeout-ms"]
      }
    ]
  },
  {
    id: "navigation",
    title: "Navigation",
    summary: "Move through pages and capture fresh refs.",
    commands: [
      {
        name: "goto",
        description: "Navigate current session to a URL",
        usage: "npx opendevbrowser goto --session-id <id> --url <url> [--wait-until <state>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--url", "--wait-until", "--timeout-ms"]
      },
      {
        name: "wait",
        description: "Wait for load or a ref to appear",
        usage: "npx opendevbrowser wait --session-id <id> [--ref <ref>] [--state <state>|--until <condition>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--ref", "--state", "--until", "--timeout-ms"]
      },
      {
        name: "snapshot",
        description: "Capture a snapshot of the active page",
        usage: "npx opendevbrowser snapshot --session-id <id> [--mode <mode>] [--max-chars <n>] [--cursor <cursor>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--mode", "--max-chars", "--cursor", "--timeout-ms"]
      },
      {
        name: "review",
        description: "Capture a first-class review payload for the active page",
        usage: "npx opendevbrowser review --session-id <id> [--target-id <id>] [--max-chars <n>] [--cursor <cursor>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--max-chars", "--cursor", "--timeout-ms"]
      },
      {
        name: "review-desktop",
        description: "Capture desktop-assisted browser review with read-only desktop evidence",
        usage: "npx opendevbrowser review-desktop --session-id <id> [--target-id <id>] [--reason <text>] [--max-chars <n>] [--cursor <cursor>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--reason", "--max-chars", "--cursor", "--timeout-ms"]
      }
    ]
  },
  {
    id: "interaction",
    title: "Interaction",
    summary: "Perform ref-based interactions in the active page.",
    commands: [
      {
        name: "click",
        description: "Click an element by ref",
        usage: "npx opendevbrowser click --session-id <id> --ref <ref> [--target-id <id>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--ref", "--target-id", "--timeout-ms"]
      },
      {
        name: "hover",
        description: "Hover an element by ref",
        usage: "npx opendevbrowser hover --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "press",
        description: "Press a keyboard key",
        usage: "npx opendevbrowser press --session-id <id> --key <key> [--ref <ref>]",
        flags: ["--session-id", "--key", "--ref"]
      },
      {
        name: "check",
        description: "Check a checkbox by ref",
        usage: "npx opendevbrowser check --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "uncheck",
        description: "Uncheck a checkbox by ref",
        usage: "npx opendevbrowser uncheck --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "type",
        description: "Type into an element by ref",
        usage: "npx opendevbrowser type --session-id <id> --ref <ref> --text <text> [--clear] [--submit]",
        flags: ["--session-id", "--ref", "--text", "--clear", "--submit"]
      },
      {
        name: "select",
        description: "Select values in a select by ref",
        usage: "npx opendevbrowser select --session-id <id> --ref <ref> --values <csv>",
        flags: ["--session-id", "--ref", "--values"]
      },
      {
        name: "scroll",
        description: "Scroll the page or element by ref",
        usage: "npx opendevbrowser scroll --session-id <id> --dy <pixels> [--ref <ref>]",
        flags: ["--session-id", "--dy", "--ref"]
      },
      {
        name: "scroll-into-view",
        description: "Scroll an element into view by ref",
        usage: "npx opendevbrowser scroll-into-view --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "upload",
        description: "Upload files to a file input or chooser by ref",
        usage: "npx opendevbrowser upload --session-id <id> --ref <ref> --files <csv> [--target-id <id>]",
        flags: ["--session-id", "--ref", "--files", "--target-id"]
      },
      {
        name: "pointer-move",
        description: "Move the pointer to viewport coordinates",
        usage: "npx opendevbrowser pointer-move --session-id <id> --x <n> --y <n> [--steps <n>] [--target-id <id>]",
        flags: ["--session-id", "--x", "--y", "--steps", "--target-id"]
      },
      {
        name: "pointer-down",
        description: "Press a mouse button at viewport coordinates",
        usage: "npx opendevbrowser pointer-down --session-id <id> --x <n> --y <n> [--button <left|middle|right>] [--click-count <n>] [--target-id <id>]",
        flags: ["--session-id", "--x", "--y", "--button", "--click-count", "--target-id"]
      },
      {
        name: "pointer-up",
        description: "Release a mouse button at viewport coordinates",
        usage: "npx opendevbrowser pointer-up --session-id <id> --x <n> --y <n> [--button <left|middle|right>] [--click-count <n>] [--target-id <id>]",
        flags: ["--session-id", "--x", "--y", "--button", "--click-count", "--target-id"]
      },
      {
        name: "pointer-drag",
        description: "Drag the pointer between two viewport coordinates",
        usage: "npx opendevbrowser pointer-drag --session-id <id> --from-x <n> --from-y <n> --to-x <n> --to-y <n> [--steps <n>] [--target-id <id>]",
        flags: ["--session-id", "--from-x", "--from-y", "--to-x", "--to-y", "--steps", "--target-id"]
      }
    ]
  },
  {
    id: "targets_pages",
    title: "Targets & Pages",
    summary: "Manage tabs, targets, and named pages.",
    commands: [
      {
        name: "targets-list",
        description: "List page targets",
        usage: "npx opendevbrowser targets-list --session-id <id> [--include-urls]",
        flags: ["--session-id", "--include-urls"]
      },
      {
        name: "target-use",
        description: "Focus a target by id",
        usage: "npx opendevbrowser target-use --session-id <id> --target-id <id>",
        flags: ["--session-id", "--target-id"]
      },
      {
        name: "target-new",
        description: "Open a new target",
        usage: "npx opendevbrowser target-new --session-id <id> [--url <url>]",
        flags: ["--session-id", "--url"]
      },
      {
        name: "target-close",
        description: "Close a target by id",
        usage: "npx opendevbrowser target-close --session-id <id> --target-id <id>",
        flags: ["--session-id", "--target-id"]
      },
      {
        name: "page",
        description: "Open or focus a named page",
        usage: "npx opendevbrowser page --session-id <id> --name <page> [--url <url>]",
        flags: ["--session-id", "--name", "--url"]
      },
      {
        name: "pages",
        description: "List named pages",
        usage: "npx opendevbrowser pages --session-id <id>",
        flags: ["--session-id"]
      },
      {
        name: "page-close",
        description: "Close a named page",
        usage: "npx opendevbrowser page-close --session-id <id> --name <page>",
        flags: ["--session-id", "--name"]
      }
    ]
  },
  {
    id: "dom_export",
    title: "DOM & Export",
    summary: "Read DOM state and export page or component code.",
    commands: [
      {
        name: "dom-html",
        description: "Capture HTML for a ref",
        usage: "npx opendevbrowser dom-html --session-id <id> [--ref <ref>] [--max-chars <n>]",
        flags: ["--session-id", "--ref", "--max-chars"]
      },
      {
        name: "dom-text",
        description: "Capture text for a ref",
        usage: "npx opendevbrowser dom-text --session-id <id> [--ref <ref>] [--max-chars <n>]",
        flags: ["--session-id", "--ref", "--max-chars"]
      },
      {
        name: "dom-attr",
        description: "Capture attribute value for a ref",
        usage: "npx opendevbrowser dom-attr --session-id <id> --ref <ref> --attr <name>",
        flags: ["--session-id", "--ref", "--attr"]
      },
      {
        name: "dom-value",
        description: "Capture input value for a ref",
        usage: "npx opendevbrowser dom-value --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "dom-visible",
        description: "Check visibility for a ref",
        usage: "npx opendevbrowser dom-visible --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "dom-enabled",
        description: "Check enabled state for a ref",
        usage: "npx opendevbrowser dom-enabled --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "dom-checked",
        description: "Check checked state for a ref",
        usage: "npx opendevbrowser dom-checked --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "clone-page",
        description: "Clone the active page to React",
        usage: "npx opendevbrowser clone-page --session-id <id> [--target-id <id>] [--path <file>]",
        flags: ["--session-id", "--target-id", "--path"]
      },
      {
        name: "clone-component",
        description: "Clone a component by ref",
        usage: "npx opendevbrowser clone-component --session-id <id> --ref <ref> [--target-id <id>] [--path <file>]",
        flags: ["--session-id", "--ref", "--target-id", "--path"]
      }
    ]
  },
  {
    id: "diagnostics_annotation",
    title: "Diagnostics & Annotation",
    summary: "Collect session-centric diagnostics, trace proof, and annotation payloads.",
    commands: [
      {
        name: "session-inspector",
        description: "Capture a session-first diagnostic summary with relay health and trace proof",
        usage: "npx opendevbrowser session-inspector --session-id <id> [--include-urls] [--since-console-seq <n>] [--since-network-seq <n>] [--since-exception-seq <n>] [--max <n>] [--request-id <id>]",
        flags: ["--session-id", "--include-urls", "--since-console-seq", "--since-network-seq", "--since-exception-seq", "--max", "--request-id"]
      },
      {
        name: "session-inspector-plan",
        description: "Inspect browser-scoped computer-use policy and safe suggested steps",
        usage: "npx opendevbrowser session-inspector-plan --session-id <id> [--target-id <id>] [--challenge-automation-mode <mode>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--challenge-automation-mode", "--timeout-ms"]
      },
      {
        name: "session-inspector-audit",
        description: "Capture a correlated audit bundle across desktop evidence, browser review, and policy state",
        usage: "npx opendevbrowser session-inspector-audit --session-id <id> [--target-id <id>] [--reason <text>] [--max-chars <n>] [--cursor <cursor>] [--include-urls] [--since-console-seq <n>] [--since-network-seq <n>] [--since-exception-seq <n>] [--max <n>] [--request-id <id>] [--challenge-automation-mode <mode>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--reason", "--max-chars", "--cursor", "--include-urls", "--since-console-seq", "--since-network-seq", "--since-exception-seq", "--max", "--request-id", "--challenge-automation-mode", "--timeout-ms"]
      },
      {
        name: "perf",
        description: "Capture performance metrics",
        usage: "npx opendevbrowser perf --session-id <id>",
        flags: ["--session-id"]
      },
      {
        name: "screenshot",
        description: "Capture a screenshot",
        usage: "npx opendevbrowser screenshot --session-id <id> [--target-id <id>] [--path <file>] [--ref <ref> | --full-page] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--path", "--ref", "--full-page", "--timeout-ms"]
      },
      {
        name: "dialog",
        description: "Inspect or handle a JavaScript dialog",
        usage: "npx opendevbrowser dialog --session-id <id> [--target-id <id>] [--action <status|accept|dismiss>] [--prompt-text <text>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--action", "--prompt-text", "--timeout-ms"]
      },
      {
        name: "console-poll",
        description: "Poll console events",
        usage: "npx opendevbrowser console-poll --session-id <id> [--since-seq <n>] [--max <n>]",
        flags: ["--session-id", "--since-seq", "--max"]
      },
      {
        name: "network-poll",
        description: "Poll network events",
        usage: "npx opendevbrowser network-poll --session-id <id> [--since-seq <n>] [--max <n>]",
        flags: ["--session-id", "--since-seq", "--max"]
      },
      {
        name: "debug-trace-snapshot",
        description: "Capture page + console + network + exception diagnostics",
        usage: "npx opendevbrowser debug-trace-snapshot --session-id <id> [--since-console-seq <n>] [--since-network-seq <n>] [--since-exception-seq <n>] [--max <n>] [--request-id <id>]",
        flags: ["--session-id", "--since-console-seq", "--since-network-seq", "--since-exception-seq", "--max", "--request-id"]
      },
      {
        name: "annotate",
        description: "Request interactive annotations via direct or relay transport",
        usage: "npx opendevbrowser annotate --session-id <id> [--url <url>] [--transport <auto|direct|relay>] [--target-id <id>] [--tab-id <tab>] [--screenshot-mode <visible|full|none>] [--context <text>] [--debug] [--stored] [--include-screenshots <bool>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--url", "--transport", "--target-id", "--tab-id", "--screenshot-mode", "--context", "--debug", "--stored", "--include-screenshots", "--timeout-ms"]
      }
    ]
  },
  {
    id: "browser_replay",
    title: "Browser Replay",
    summary: "Capture temporal replay artifacts through the public browser replay lane for a browser target.",
    commands: [
      {
        name: "screencast-start",
        description: "Start a browser replay screencast capture",
        usage: "npx opendevbrowser screencast-start --session-id <id> [--target-id <id>] [--output-dir <path>] [--interval-ms <ms>] [--max-frames <n>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--output-dir", "--interval-ms", "--max-frames", "--timeout-ms"]
      },
      {
        name: "screencast-stop",
        description: "Stop a browser replay screencast capture",
        usage: "npx opendevbrowser screencast-stop --session-id <id> --screencast-id <id> [--timeout-ms <ms>]",
        flags: ["--session-id", "--screencast-id", "--timeout-ms"]
      }
    ]
  },
  {
    id: "desktop_observation",
    title: "Desktop Observation",
    summary: "Inspect the public read-only sibling desktop observation plane on macOS; availability, window inventory, and accessibility probes use the local swift command, while screenshots use macOS screencapture outside extension relay.",
    commands: [
      {
        name: "desktop-status",
        description: "Inspect public read-only desktop observation availability",
        usage: "npx opendevbrowser desktop-status [--timeout-ms <ms>]",
        flags: ["--timeout-ms"]
      },
      {
        name: "desktop-windows",
        description: "List windows exposed by the public read-only desktop observation plane",
        usage: "npx opendevbrowser desktop-windows [--reason <text>] [--timeout-ms <ms>]",
        flags: ["--reason", "--timeout-ms"]
      },
      {
        name: "desktop-active-window",
        description: "Inspect the active window through the public read-only desktop observation plane",
        usage: "npx opendevbrowser desktop-active-window [--reason <text>] [--timeout-ms <ms>]",
        flags: ["--reason", "--timeout-ms"]
      },
      {
        name: "desktop-capture-desktop",
        description: "Capture the current desktop surface through the public read-only desktop observation plane",
        usage: "npx opendevbrowser desktop-capture-desktop --reason <text> [--timeout-ms <ms>]",
        flags: ["--reason", "--timeout-ms"]
      },
      {
        name: "desktop-capture-window",
        description: "Capture a specific window through the public read-only desktop observation plane",
        usage: "npx opendevbrowser desktop-capture-window --window-id <id> --reason <text> [--timeout-ms <ms>]",
        flags: ["--window-id", "--reason", "--timeout-ms"]
      },
      {
        name: "desktop-accessibility-snapshot",
        description: "Capture desktop accessibility state through the public read-only desktop observation plane",
        usage: "npx opendevbrowser desktop-accessibility-snapshot --reason <text> [--window-id <id>] [--timeout-ms <ms>]",
        flags: ["--reason", "--window-id", "--timeout-ms"]
      }
    ]
  },
  {
    id: "power",
    title: "Power",
    summary: "Unsafe internal daemon passthrough.",
    commands: [
      {
        name: "rpc",
        description: "Execute an internal daemon RPC command (power-user)",
        usage: "npx opendevbrowser rpc --unsafe-internal --name <daemon.command> [--params <json> | --params-file <path>] [--timeout-ms <ms>]",
        flags: ["--unsafe-internal", "--name", "--params", "--params-file", "--timeout-ms"]
      }
    ]
  }
] as const satisfies readonly PublicSurfaceCliCommandGroupDefinition[];

export type PublicSurfaceCliCommandName = typeof PUBLIC_CLI_COMMAND_GROUPS[number]["commands"][number]["name"];

const cliExample = (command: string, args = ""): string => (
  `npx opendevbrowser ${command}${args ? ` ${args}` : ""}`
);

export interface CommandHelpDetail {
  description: string;
  usage: string;
  flags: readonly PublicSurfaceFlagName[];
  examples: readonly string[];
  notes: readonly string[];
}

export const CLI_COMMANDS = PUBLIC_CLI_COMMAND_GROUPS.flatMap((group) => (
  group.commands.map((command) => command.name)
)) as PublicSurfaceCliCommandName[];

const CLI_COMMAND_EXAMPLES = {
  install: [cliExample("install", "--local --with-config --skills-local")],
  update: [cliExample("update", "--local --skills-local")],
  uninstall: [cliExample("uninstall", "--local --no-skills --no-prompt")],
  help: ["npx opendevbrowser --help"],
  version: [cliExample("--version")],
  serve: [cliExample("serve", "--port 8788 --token local-dev-token")],
  daemon: [cliExample("daemon", "status --output-format json")],
  native: [cliExample("native", "status --output-format json")],
  run: [cliExample("run", "--script ./workflow.json --headless --output-format json")],
  launch: [cliExample("launch", "--no-extension --headless --start-url https://example.com --output-format json")],
  connect: [cliExample("connect", "--host 127.0.0.1 --cdp-port 9222 --output-format json")],
  disconnect: [cliExample("disconnect", "--session-id s1 --close-browser --output-format json")],
  status: [cliExample("status", "--daemon --output-format json")],
  "status-capabilities": [cliExample("status-capabilities", "--session-id s1 --target-id page-1 --challenge-automation-mode browser_with_helper --timeout-ms 30000 --output-format json")],
  "cookie-import": [cliExample("cookie-import", "--session-id s1 --cookies-file ./cookies.json --strict true --output-format json")],
  "cookie-list": [cliExample("cookie-list", "--session-id s1 --url https://example.com --output-format json")],
  research: [cliExample("research run", "--topic \"Chrome extension debugging workflows\" --days 30 --sources web,community --browser-mode managed --mode json --output-format json")],
  shopping: [cliExample("shopping run", "--query \"wireless ergonomic mouse\" --providers shopping/bestbuy,shopping/ebay --budget 150 --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --mode json --output-format json")],
  "product-video": [cliExample("product-video run", "--product-url \"https://example.com/p/1\" --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --include-screenshots --output-format json")],
  inspiredesign: [cliExample("inspiredesign run", "--brief \"Extract a reusable dashboard design contract from live references\" --url https://linear.app --browser-mode managed --use-cookies --challenge-automation-mode browser_with_helper --include-prototype-guidance --output-dir /tmp/inspiredesign --output-format json")],
  artifacts: [cliExample("artifacts cleanup", "--expired-only --output-dir /tmp/opendevbrowser --output-format json")],
  "macro-resolve": [cliExample("macro-resolve", "--expression '@community.search(\"browser automation failures\", 4)' --execute --browser-mode extension --challenge-automation-mode browser_with_helper --output-format json")],
  canvas: [cliExample("canvas", "--command canvas.session.open --params '{\"label\":\"design review\"}' --timeout-ms 120000 --output-format json")],
  goto: [cliExample("goto", "--session-id s1 --url https://example.com --wait-until networkidle --output-format json")],
  wait: [cliExample("wait", "--session-id s1 --state networkidle --timeout-ms 30000 --output-format json")],
  snapshot: [cliExample("snapshot", "--session-id s1 --mode actionables --max-chars 4000 --output-format json")],
  review: [cliExample("review", "--session-id s1 --target-id page-1 --output-format json")],
  "review-desktop": [cliExample("review-desktop", "--session-id s1 --reason \"trace challenge state\" --output-format json")],
  click: [cliExample("click", "--session-id s1 --ref r12 --output-format json")],
  hover: [cliExample("hover", "--session-id s1 --ref r12 --output-format json")],
  press: [cliExample("press", "--session-id s1 --key Enter --ref r12 --output-format json")],
  check: [cliExample("check", "--session-id s1 --ref r12 --output-format json")],
  uncheck: [cliExample("uncheck", "--session-id s1 --ref r12 --output-format json")],
  type: [cliExample("type", "--session-id s1 --ref r12 --text \"agent@example.com\" --clear --output-format json")],
  select: [cliExample("select", "--session-id s1 --ref r12 --values us,ca --output-format json")],
  scroll: [cliExample("scroll", "--session-id s1 --dy 1000 --output-format json")],
  "scroll-into-view": [cliExample("scroll-into-view", "--session-id s1 --ref r12 --output-format json")],
  upload: [cliExample("upload", "--session-id s1 --ref r12 --files ./draft.pdf,./hero.png --output-format json")],
  "pointer-move": [cliExample("pointer-move", "--session-id s1 --x 320 --y 240 --steps 12 --output-format json")],
  "pointer-down": [cliExample("pointer-down", "--session-id s1 --x 320 --y 240 --button left --click-count 1 --output-format json")],
  "pointer-up": [cliExample("pointer-up", "--session-id s1 --x 320 --y 240 --button left --click-count 1 --output-format json")],
  "pointer-drag": [cliExample("pointer-drag", "--session-id s1 --from-x 320 --from-y 240 --to-x 640 --to-y 240 --steps 18 --output-format json")],
  "targets-list": [cliExample("targets-list", "--session-id s1 --include-urls --output-format json")],
  "target-use": [cliExample("target-use", "--session-id s1 --target-id page-2 --output-format json")],
  "target-new": [cliExample("target-new", "--session-id s1 --url https://example.com/docs --output-format json")],
  "target-close": [cliExample("target-close", "--session-id s1 --target-id page-2 --output-format json")],
  page: [cliExample("page", "--session-id s1 --name settings --url https://example.com/settings --output-format json")],
  pages: [cliExample("pages", "--session-id s1 --output-format json")],
  "page-close": [cliExample("page-close", "--session-id s1 --name settings --output-format json")],
  "dom-html": [cliExample("dom-html", "--session-id s1 --ref r12 --max-chars 2000 --output-format json")],
  "dom-text": [cliExample("dom-text", "--session-id s1 --ref r12 --max-chars 500 --output-format json")],
  "dom-attr": [cliExample("dom-attr", "--session-id s1 --ref r12 --attr aria-label --output-format json")],
  "dom-value": [cliExample("dom-value", "--session-id s1 --ref r12 --output-format json")],
  "dom-visible": [cliExample("dom-visible", "--session-id s1 --ref r12 --output-format json")],
  "dom-enabled": [cliExample("dom-enabled", "--session-id s1 --ref r12 --output-format json")],
  "dom-checked": [cliExample("dom-checked", "--session-id s1 --ref r12 --output-format json")],
  "clone-page": [cliExample("clone-page", "--session-id s1 --target-id page-1 --path ./exports/page.tsx --output-format json")],
  "clone-component": [cliExample("clone-component", "--session-id s1 --ref r12 --path ./exports/component.tsx --output-format json")],
  "session-inspector": [cliExample("session-inspector", "--session-id s1 --include-urls --max 20 --output-format json")],
  "session-inspector-plan": [cliExample("session-inspector-plan", "--session-id s1 --target-id page-1 --challenge-automation-mode browser_with_helper --output-format json")],
  "session-inspector-audit": [cliExample("session-inspector-audit", "--session-id s1 --target-id page-1 --reason \"trace challenge state\" --include-urls --request-id req-session-audit-001 --challenge-automation-mode browser_with_helper --output-format json")],
  perf: [cliExample("perf", "--session-id s1 --output-format json")],
  screenshot: [cliExample("screenshot", "--session-id s1 --path ./artifacts/page.png --full-page --output-format json")],
  dialog: [cliExample("dialog", "--session-id s1 --action status --output-format json")],
  "console-poll": [cliExample("console-poll", "--session-id s1 --max 50 --output-format json")],
  "network-poll": [cliExample("network-poll", "--session-id s1 --max 50 --output-format json")],
  "debug-trace-snapshot": [cliExample("debug-trace-snapshot", "--session-id s1 --max 50 --request-id req-trace-001 --output-format json")],
  annotate: [cliExample("annotate", "--session-id s1 --transport auto --context \"review call to action spacing\" --include-screenshots true --output-format json")],
  "screencast-start": [cliExample("screencast-start", "--session-id s1 --output-dir ./artifacts/replay --interval-ms 750 --max-frames 40 --output-format json")],
  "screencast-stop": [cliExample("screencast-stop", "--session-id s1 --screencast-id cast-1 --output-format json")],
  "desktop-status": [cliExample("desktop-status", "--timeout-ms 5000 --output-format json")],
  "desktop-windows": [cliExample("desktop-windows", "--reason \"inventory browser-adjacent windows\" --output-format json")],
  "desktop-active-window": [cliExample("desktop-active-window", "--reason \"capture active browser context\" --output-format json")],
  "desktop-capture-desktop": [cliExample("desktop-capture-desktop", "--reason \"capture login checkpoint state\" --output-format json")],
  "desktop-capture-window": [cliExample("desktop-capture-window", "--window-id 101 --reason \"capture browser window\" --output-format json")],
  "desktop-accessibility-snapshot": [cliExample("desktop-accessibility-snapshot", "--reason \"inspect current browser-adjacent labels\" --window-id 101 --output-format json")],
  rpc: [cliExample("rpc", "--unsafe-internal --name browser.status --params-file ./rpc-params.json --output-format json")]
} as const satisfies Record<PublicSurfaceCliCommandName, readonly string[]>;

const CLI_COMMAND_NOTES: Partial<Record<PublicSurfaceCliCommandName, readonly string[]>> = {
  help: [
    "Generated help is the canonical first-contact discovery surface and should stay source-owned."
  ],
  run: [
    "One-shot run uses a temporary profile unless --persist-profile is explicitly enabled."
  ],
  launch: [
    "Use --wait-for-extension when you need a clean daemon-extension handshake before the next step."
  ],
  research: [
    "Load opendevbrowser-research first, use explicit source families such as --sources web,community, and inspect artifacts before final claims."
  ],
  shopping: [
    "Treat --region as advisory unless the workflow output reports region_authoritative=true."
  ],
  "product-video": [
    "Confirm whether the returned pack is visual-ready or metadata-first before briefing production."
  ],
  inspiredesign: [
    "Any inspiredesign --url forces deep capture for DOM/layout evidence; without URLs, --capture-mode defaults to off.",
    "Repeat --url for multiple references. There is no --urls alias."
  ],
  "macro-resolve": [
    "Use --browser-mode and --challenge-automation-mode only with --execute.",
    "When --execute is enabled, inspect execution.meta.blocker before trusting a blocked result as complete."
  ],
  canvas: [
    "Use --params-file for strict request envelopes such as canvas.plan.set or governance handoff payloads."
  ],
  annotate: [
    "Use --stored when you want the last delivered annotation payload without starting a new capture."
  ],
  "session-inspector-plan": [
    "Inspect browser-scoped challenge automation before enabling browser_with_helper on a live rerun."
  ],
  "session-inspector-audit": [
    "Audit mode is the quickest correlated proof lane when you need desktop evidence plus browser trace state."
  ]
} as const;

export const CLI_COMMAND_HELP_DETAILS = Object.fromEntries(
  PUBLIC_CLI_COMMAND_GROUPS.flatMap((group) => (
    group.commands.map((command) => [
      command.name,
      {
        description: command.description,
        usage: command.usage,
        flags: [...command.flags],
        examples: [...CLI_COMMAND_EXAMPLES[command.name]],
        notes: [...(CLI_COMMAND_NOTES[command.name] ?? [])]
      } satisfies CommandHelpDetail
    ] as const)
  ))
) as unknown as Record<PublicSurfaceCliCommandName, CommandHelpDetail>;

export interface ToolSurfaceDefinition {
  name: string;
  description: string;
  cliEquivalent?: string;
  notes?: readonly string[];
}

export interface ToolSurfaceEntry extends ToolSurfaceDefinition {
  example: string;
}

export const TOOL_SURFACE_ENTRIES: readonly ToolSurfaceDefinition[] = [
  { name: "opendevbrowser_launch", description: "Launch a managed browser session.", cliEquivalent: "launch" },
  { name: "opendevbrowser_connect", description: "Connect to an existing browser session.", cliEquivalent: "connect" },
  { name: "opendevbrowser_disconnect", description: "Disconnect a managed or connected session.", cliEquivalent: "disconnect" },
  { name: "opendevbrowser_status", description: "Inspect session and relay status.", cliEquivalent: "status" },
  { name: "opendevbrowser_status_capabilities", description: "Inspect runtime capability discovery for the host and an optional session.", cliEquivalent: "status-capabilities" },
  { name: "opendevbrowser_session_inspector", description: "Capture a session-first diagnostic bundle with relay health, trace proof, and a suggested next action.", cliEquivalent: "session-inspector" },
  { name: "opendevbrowser_session_inspector_plan", description: "Inspect browser-scoped computer-use policy, eligibility, and safe suggested steps.", cliEquivalent: "session-inspector-plan" },
  { name: "opendevbrowser_session_inspector_audit", description: "Capture a correlated audit bundle across desktop evidence, browser review, and policy state.", cliEquivalent: "session-inspector-audit" },
  { name: "opendevbrowser_targets_list", description: "List available page targets/tabs.", cliEquivalent: "targets-list" },
  { name: "opendevbrowser_target_use", description: "Switch the active target by id.", cliEquivalent: "target-use" },
  { name: "opendevbrowser_target_new", description: "Create a new target or tab.", cliEquivalent: "target-new" },
  { name: "opendevbrowser_target_close", description: "Close a target or tab by id.", cliEquivalent: "target-close" },
  { name: "opendevbrowser_page", description: "Open or focus a named page.", cliEquivalent: "page" },
  { name: "opendevbrowser_list", description: "List named pages in the session.", cliEquivalent: "pages" },
  { name: "opendevbrowser_close", description: "Close a named page.", cliEquivalent: "page-close" },
  { name: "opendevbrowser_goto", description: "Navigate to a URL.", cliEquivalent: "goto" },
  { name: "opendevbrowser_wait", description: "Wait for load, ref, or state conditions.", cliEquivalent: "wait" },
  { name: "opendevbrowser_snapshot", description: "Capture AX-tree refs for actions.", cliEquivalent: "snapshot" },
  { name: "opendevbrowser_review", description: "Capture a first-class review payload with status and actionables.", cliEquivalent: "review" },
  { name: "opendevbrowser_review_desktop", description: "Capture desktop-assisted browser review with read-only desktop evidence and browser-owned verification.", cliEquivalent: "review-desktop" },
  { name: "opendevbrowser_click", description: "Click an element by ref.", cliEquivalent: "click" },
  { name: "opendevbrowser_hover", description: "Hover an element by ref.", cliEquivalent: "hover" },
  { name: "opendevbrowser_press", description: "Send a keyboard key.", cliEquivalent: "press" },
  { name: "opendevbrowser_check", description: "Check a checkbox or radio by ref.", cliEquivalent: "check" },
  { name: "opendevbrowser_uncheck", description: "Uncheck a checkbox or radio by ref.", cliEquivalent: "uncheck" },
  { name: "opendevbrowser_type", description: "Type text into an input by ref.", cliEquivalent: "type" },
  { name: "opendevbrowser_select", description: "Set select values by ref.", cliEquivalent: "select" },
  { name: "opendevbrowser_scroll", description: "Scroll a page or element.", cliEquivalent: "scroll" },
  { name: "opendevbrowser_scroll_into_view", description: "Scroll a target element into view.", cliEquivalent: "scroll-into-view" },
  { name: "opendevbrowser_upload", description: "Upload files to a file input or chooser by ref.", cliEquivalent: "upload" },
  { name: "opendevbrowser_pointer_move", description: "Move the pointer to viewport coordinates.", cliEquivalent: "pointer-move" },
  { name: "opendevbrowser_pointer_down", description: "Press a mouse button at viewport coordinates.", cliEquivalent: "pointer-down" },
  { name: "opendevbrowser_pointer_up", description: "Release a mouse button at viewport coordinates.", cliEquivalent: "pointer-up" },
  { name: "opendevbrowser_pointer_drag", description: "Drag the pointer between viewport coordinates.", cliEquivalent: "pointer-drag" },
  { name: "opendevbrowser_dom_get_html", description: "Get HTML for a page or ref.", cliEquivalent: "dom-html" },
  { name: "opendevbrowser_dom_get_text", description: "Get text for a page or ref.", cliEquivalent: "dom-text" },
  { name: "opendevbrowser_get_attr", description: "Read a DOM attribute by ref.", cliEquivalent: "dom-attr" },
  { name: "opendevbrowser_get_value", description: "Read a form or control value by ref.", cliEquivalent: "dom-value" },
  { name: "opendevbrowser_is_visible", description: "Check ref visibility.", cliEquivalent: "dom-visible" },
  { name: "opendevbrowser_is_enabled", description: "Check ref enabled state.", cliEquivalent: "dom-enabled" },
  { name: "opendevbrowser_is_checked", description: "Check ref checked state.", cliEquivalent: "dom-checked" },
  { name: "opendevbrowser_run", description: "Execute multi-action automation scripts.", cliEquivalent: "run" },
  { name: "opendevbrowser_prompting_guide", description: "Start here for first-contact OpenDevBrowser guidance and the bundled best-practices quick start." },
  { name: "opendevbrowser_console_poll", description: "Poll redacted console events.", cliEquivalent: "console-poll" },
  { name: "opendevbrowser_network_poll", description: "Poll redacted network events.", cliEquivalent: "network-poll" },
  { name: "opendevbrowser_debug_trace_snapshot", description: "Capture page, console, and network diagnostics.", cliEquivalent: "debug-trace-snapshot" },
  { name: "opendevbrowser_cookie_import", description: "Import validated cookies into a session.", cliEquivalent: "cookie-import" },
  { name: "opendevbrowser_cookie_list", description: "List cookies in a session with optional URL filters.", cliEquivalent: "cookie-list" },
  { name: "opendevbrowser_macro_resolve", description: "Resolve or execute provider macro expressions.", cliEquivalent: "macro-resolve" },
  { name: "opendevbrowser_research_run", description: "Run the research workflow directly.", cliEquivalent: "research" },
  { name: "opendevbrowser_shopping_run", description: "Run the shopping workflow directly.", cliEquivalent: "shopping" },
  { name: "opendevbrowser_product_video_run", description: "Run the product-video asset workflow directly.", cliEquivalent: "product-video" },
  { name: "opendevbrowser_inspiredesign_run", description: "Run the inspiredesign workflow directly.", cliEquivalent: "inspiredesign" },
  { name: "opendevbrowser_canvas", description: "Execute a typed design-canvas command surface call.", cliEquivalent: "canvas" },
  { name: "opendevbrowser_clone_page", description: "Export the active page into React code.", cliEquivalent: "clone-page" },
  { name: "opendevbrowser_clone_component", description: "Export a component by ref into React code.", cliEquivalent: "clone-component" },
  { name: "opendevbrowser_perf", description: "Collect browser performance metrics.", cliEquivalent: "perf" },
  { name: "opendevbrowser_screenshot", description: "Capture a page screenshot.", cliEquivalent: "screenshot" },
  { name: "opendevbrowser_screencast_start", description: "Start a browser replay screencast capture.", cliEquivalent: "screencast-start" },
  { name: "opendevbrowser_screencast_stop", description: "Stop a browser replay screencast capture.", cliEquivalent: "screencast-stop" },
  { name: "opendevbrowser_dialog", description: "Inspect or handle a JavaScript dialog.", cliEquivalent: "dialog" },
  { name: "opendevbrowser_desktop_status", description: "Inspect public read-only desktop observation availability.", cliEquivalent: "desktop-status" },
  { name: "opendevbrowser_desktop_windows", description: "List windows exposed by the public read-only desktop observation plane.", cliEquivalent: "desktop-windows" },
  { name: "opendevbrowser_desktop_active_window", description: "Inspect the active window through the public read-only desktop observation plane.", cliEquivalent: "desktop-active-window" },
  { name: "opendevbrowser_desktop_capture_desktop", description: "Capture the current desktop surface through the public read-only desktop observation plane.", cliEquivalent: "desktop-capture-desktop" },
  { name: "opendevbrowser_desktop_capture_window", description: "Capture a specific window through the public read-only desktop observation plane.", cliEquivalent: "desktop-capture-window" },
  { name: "opendevbrowser_desktop_accessibility_snapshot", description: "Capture desktop accessibility state through the public read-only desktop observation plane.", cliEquivalent: "desktop-accessibility-snapshot" },
  { name: "opendevbrowser_annotate", description: "Capture interactive annotations.", cliEquivalent: "annotate" },
  { name: "opendevbrowser_skill_list", description: "List bundled and discovered skill packs before choosing a local onboarding or workflow lane." },
  { name: "opendevbrowser_skill_load", description: "Load a specific skill pack locally, especially the bundled best-practices quick start." }
] as const;

const TOOL_SURFACE_EXAMPLES: Partial<Record<string, string>> = {
  opendevbrowser_prompting_guide: "{\"topic\":\"quick start\"}",
  opendevbrowser_skill_list: "{}",
  opendevbrowser_skill_load: "{\"name\":\"opendevbrowser-best-practices\",\"topic\":\"quick start\"}"
};

const TOOL_SURFACE_NOTES: Partial<Record<string, readonly string[]>> = {
  opendevbrowser_prompting_guide: [
    "Tool-only helper. Use it before low-level browser commands when an agent needs the canonical quick start."
  ],
  opendevbrowser_skill_list: [
    "Tool-only helper. Use it to inspect local workflow lanes before loading a pack."
  ],
  opendevbrowser_skill_load: [
    "Tool-only helper. Use it to load opendevbrowser-best-practices or design-agent guidance directly into the current agent context."
  ]
};

export interface PublicSurfaceCliCommandGroup {
  id: string;
  title: string;
  summary: string;
  commands: readonly PublicSurfaceCliCommandName[];
}

export interface PublicSurfaceCliCommand extends CommandHelpDetail {
  name: PublicSurfaceCliCommandName;
  groupId: string;
  groupTitle: string;
  groupSummary: string;
}

export interface PublicSurfaceCliToolPair {
  cliCommand: PublicSurfaceCliCommandName;
  toolName: string;
}

export interface PublicSurfaceManifestSource {
  cliGroups: readonly PublicSurfaceCliCommandGroup[];
  cliCommands: readonly PublicSurfaceCliCommand[];
  cliFlags: readonly PublicSurfaceFlag[];
  toolSurfaces: readonly ToolSurfaceEntry[];
  cliToolPairs: readonly PublicSurfaceCliToolPair[];
}

export interface PublicSurfaceManifest {
  schemaVersion: string;
  generatedAt: string;
  cli: {
    groups: readonly PublicSurfaceCliCommandGroup[];
    commands: readonly PublicSurfaceCliCommand[];
    flags: readonly PublicSurfaceFlag[];
    equalsFlags: readonly PublicSurfaceFlagName[];
  };
  tools: {
    entries: readonly ToolSurfaceEntry[];
    cliToolPairs: readonly PublicSurfaceCliToolPair[];
  };
  counts: {
    commandCount: number;
    toolCount: number;
    cliToolPairCount: number;
  };
}

const VALID_EQUALS_FLAG_SET = new Set<string>(VALID_EQUALS_FLAGS);

export function buildPublicSurfaceCliGroups(): PublicSurfaceCliCommandGroup[] {
  return PUBLIC_CLI_COMMAND_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    summary: group.summary,
    commands: group.commands.map((command) => command.name) as PublicSurfaceCliCommandName[]
  }));
}

export function buildPublicSurfaceCliCommands(): PublicSurfaceCliCommand[] {
  return PUBLIC_CLI_COMMAND_GROUPS.flatMap((group) => (
    group.commands.map((command) => ({
      name: command.name,
      description: command.description,
      usage: command.usage,
      flags: [...command.flags],
      examples: [...CLI_COMMAND_EXAMPLES[command.name]],
      notes: [...(CLI_COMMAND_NOTES[command.name] ?? [])],
      groupId: group.id,
      groupTitle: group.title,
      groupSummary: group.summary
    }))
  ));
}

export function buildPublicSurfaceCliFlags(): PublicSurfaceFlag[] {
  return VALID_FLAGS.map((name) => ({
    name,
    kind: VALID_EQUALS_FLAG_SET.has(name) ? "value" : "boolean"
  }));
}

export function buildPublicSurfaceToolSurfaces(): ToolSurfaceEntry[] {
  return TOOL_SURFACE_ENTRIES.map((entry) => ({
    name: entry.name,
    description: entry.description,
    ...(entry.cliEquivalent ? { cliEquivalent: entry.cliEquivalent } : {}),
    example: TOOL_SURFACE_EXAMPLES[entry.name]
      ?? CLI_COMMAND_EXAMPLES[entry.cliEquivalent as PublicSurfaceCliCommandName][0],
    ...(TOOL_SURFACE_NOTES[entry.name]
      ? { notes: [...TOOL_SURFACE_NOTES[entry.name]!] }
      : {})
  }));
}

export function buildPublicSurfaceCliToolPairs(): PublicSurfaceCliToolPair[] {
  return TOOL_SURFACE_ENTRIES.flatMap((entry) => (
    entry.cliEquivalent
      ? [{ cliCommand: entry.cliEquivalent as PublicSurfaceCliCommandName, toolName: entry.name }]
      : []
  ));
}

export function buildPublicSurfaceManifestSource(): PublicSurfaceManifestSource {
  return {
    cliGroups: buildPublicSurfaceCliGroups(),
    cliCommands: buildPublicSurfaceCliCommands(),
    cliFlags: buildPublicSurfaceCliFlags(),
    toolSurfaces: buildPublicSurfaceToolSurfaces(),
    cliToolPairs: buildPublicSurfaceCliToolPairs()
  };
}

export function buildPublicSurfaceManifest(generatedAt = new Date().toISOString()): PublicSurfaceManifest {
  const source = buildPublicSurfaceManifestSource();
  return {
    schemaVersion: PUBLIC_SURFACE_MANIFEST_SCHEMA_VERSION,
    generatedAt,
    cli: {
      groups: source.cliGroups,
      commands: source.cliCommands,
      flags: source.cliFlags,
      equalsFlags: [...VALID_EQUALS_FLAGS]
    },
    tools: {
      entries: source.toolSurfaces,
      cliToolPairs: source.cliToolPairs
    },
    counts: {
      commandCount: source.cliCommands.length,
      toolCount: source.toolSurfaces.length,
      cliToolPairCount: source.cliToolPairs.length
    }
  };
}
