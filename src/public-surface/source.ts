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
  "--product-url", "--product-name", "--provider-hint", "--include-screenshots", "--include-all-images", "--include-copy",
  "--use-cookies", "--challenge-automation-mode", "--cookie-policy-override", "--cookie-policy",
  "--output-dir", "--ttl-hours", "--expired-only"
] as const;

export type PublicSurfaceFlagName = (typeof VALID_FLAGS)[number];
export type PublicSurfaceFlagKind = "boolean" | "value";

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
  "--product-url",
  "--product-name",
  "--provider-hint",
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

export interface PublicSurfaceCliCommandDefinition {
  name: string;
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
        usage: "npx opendevbrowser [--global|--local] [--with-config] [--full] [--skills-global|--skills-local|--no-skills] [--no-prompt] [--quiet]",
        flags: ["--global", "--local", "--with-config", "--full", "--skills-global", "--skills-local", "--no-skills", "--no-prompt", "--quiet"]
      },
      {
        name: "update",
        usage: "npx opendevbrowser update [--global|--local]",
        flags: ["--global", "--local"]
      },
      {
        name: "uninstall",
        usage: "npx opendevbrowser uninstall [--global|--local] [--no-prompt] [--quiet]",
        flags: ["--global", "--local", "--no-prompt", "--quiet"]
      },
      {
        name: "help",
        usage: "npx opendevbrowser --help | npx opendevbrowser help",
        flags: ["--help"]
      },
      {
        name: "version",
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
        usage: "npx opendevbrowser serve [--port <port>] [--token <token>] [--stop]",
        flags: ["--port", "--token", "--stop"]
      },
      {
        name: "daemon",
        usage: "npx opendevbrowser daemon <install|uninstall|status>",
        flags: ["--output-format"]
      },
      {
        name: "native",
        usage: "npx opendevbrowser native <install|uninstall|status> [extension-id]",
        flags: ["--output-format"]
      },
      {
        name: "run",
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
        usage: "npx opendevbrowser launch [--headless] [--profile <name>] [--persist-profile <bool>] [--chrome-path <path>] [--start-url <url>] [--flag <chrome-arg>] [--no-extension|--extension-only] [--extension-legacy] [--wait-for-extension] [--wait-timeout-ms <ms>]",
        flags: ["--headless", "--profile", "--persist-profile", "--chrome-path", "--start-url", "--flag", "--no-extension", "--extension-only", "--extension-legacy", "--wait-for-extension", "--wait-timeout-ms"]
      },
      {
        name: "connect",
        usage: "npx opendevbrowser connect (--ws-endpoint <url> | --host <host> --cdp-port <port>) [--start-url <url>] [--extension-legacy]",
        flags: ["--ws-endpoint", "--host", "--cdp-port", "--start-url", "--extension-legacy"]
      },
      {
        name: "disconnect",
        usage: "npx opendevbrowser disconnect --session-id <id> [--close-browser]",
        flags: ["--session-id", "--close-browser"]
      },
      {
        name: "status",
        usage: "npx opendevbrowser status [--session-id <id> | --daemon] [--transport <relay|native>]",
        flags: ["--session-id", "--daemon", "--transport"]
      },
      {
        name: "status-capabilities",
        usage: "npx opendevbrowser status-capabilities [--session-id <id>] [--target-id <id>] [--challenge-automation-mode <mode>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--challenge-automation-mode", "--timeout-ms"]
      },
      {
        name: "cookie-import",
        usage: "npx opendevbrowser cookie-import --session-id <id> (--cookies <json> | --cookies-file <path>) [--strict <bool>]",
        flags: ["--session-id", "--cookies", "--cookies-file", "--strict"]
      },
      {
        name: "cookie-list",
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
        usage: "npx opendevbrowser research run --topic <text> [--days <n>|--from <date> --to <date>] [--source-selection <family>] [--sources <csv>] [--include-engagement] [--limit-per-source <n>] [--mode <mode>] [--timeout-ms <ms>] [--output-dir <path>] [--ttl-hours <n>] [--use-cookies[=<bool>]] [--challenge-automation-mode <mode>] [--cookie-policy-override <policy>]",
        flags: ["--topic", "--days", "--from", "--to", "--source-selection", "--sources", "--include-engagement", "--limit-per-source", "--mode", "--timeout-ms", "--output-dir", "--ttl-hours", "--use-cookies", "--challenge-automation-mode", "--cookie-policy-override", "--cookie-policy"]
      },
      {
        name: "shopping",
        usage: "npx opendevbrowser shopping run --query <text> [--providers <csv>] [--budget <amount>] [--region <region>] [--browser-mode <mode>] [--sort <mode>] [--mode <mode>] [--timeout-ms <ms>] [--output-dir <path>] [--ttl-hours <n>] [--use-cookies[=<bool>]] [--challenge-automation-mode <mode>] [--cookie-policy-override <policy>]",
        flags: ["--query", "--providers", "--budget", "--region", "--browser-mode", "--sort", "--mode", "--timeout-ms", "--output-dir", "--ttl-hours", "--use-cookies", "--challenge-automation-mode", "--cookie-policy-override", "--cookie-policy"]
      },
      {
        name: "product-video",
        usage: "npx opendevbrowser product-video run (--product-url <url> | --product-name <name>) [--provider-hint <provider>] [--include-screenshots <bool>] [--include-all-images <bool>] [--include-copy <bool>] [--timeout-ms <ms>] [--use-cookies[=<bool>]] [--challenge-automation-mode <mode>] [--cookie-policy-override <policy>] [--output-dir <path>] [--ttl-hours <n>]",
        flags: ["--product-url", "--product-name", "--provider-hint", "--include-screenshots", "--include-all-images", "--include-copy", "--timeout-ms", "--use-cookies", "--challenge-automation-mode", "--cookie-policy-override", "--cookie-policy", "--output-dir", "--ttl-hours"]
      },
      {
        name: "artifacts",
        usage: "npx opendevbrowser artifacts cleanup [--expired-only] [--output-dir <path>]",
        flags: ["--expired-only", "--output-dir"]
      },
      {
        name: "macro-resolve",
        usage: "npx opendevbrowser macro-resolve --expression <macro> [--default-provider <provider>] [--include-catalog] [--execute] [--timeout-ms <ms>] [--challenge-automation-mode <mode>]",
        flags: ["--expression", "--default-provider", "--include-catalog", "--execute", "--timeout-ms", "--challenge-automation-mode"]
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
        usage: "npx opendevbrowser goto --session-id <id> --url <url> [--wait-until <state>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--url", "--wait-until", "--timeout-ms"]
      },
      {
        name: "wait",
        usage: "npx opendevbrowser wait --session-id <id> [--ref <ref>] [--state <state>|--until <condition>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--ref", "--state", "--until", "--timeout-ms"]
      },
      {
        name: "snapshot",
        usage: "npx opendevbrowser snapshot --session-id <id> [--mode <mode>] [--max-chars <n>] [--cursor <cursor>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--mode", "--max-chars", "--cursor", "--timeout-ms"]
      },
      {
        name: "review",
        usage: "npx opendevbrowser review --session-id <id> [--target-id <id>] [--max-chars <n>] [--cursor <cursor>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--max-chars", "--cursor", "--timeout-ms"]
      },
      {
        name: "review-desktop",
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
        usage: "npx opendevbrowser click --session-id <id> --ref <ref> [--target-id <id>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--ref", "--target-id", "--timeout-ms"]
      },
      {
        name: "hover",
        usage: "npx opendevbrowser hover --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "press",
        usage: "npx opendevbrowser press --session-id <id> --key <key> [--ref <ref>]",
        flags: ["--session-id", "--key", "--ref"]
      },
      {
        name: "check",
        usage: "npx opendevbrowser check --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "uncheck",
        usage: "npx opendevbrowser uncheck --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "type",
        usage: "npx opendevbrowser type --session-id <id> --ref <ref> --text <text> [--clear] [--submit]",
        flags: ["--session-id", "--ref", "--text", "--clear", "--submit"]
      },
      {
        name: "select",
        usage: "npx opendevbrowser select --session-id <id> --ref <ref> --values <csv>",
        flags: ["--session-id", "--ref", "--values"]
      },
      {
        name: "scroll",
        usage: "npx opendevbrowser scroll --session-id <id> --dy <pixels> [--ref <ref>]",
        flags: ["--session-id", "--dy", "--ref"]
      },
      {
        name: "scroll-into-view",
        usage: "npx opendevbrowser scroll-into-view --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "upload",
        usage: "npx opendevbrowser upload --session-id <id> --ref <ref> --files <csv> [--target-id <id>]",
        flags: ["--session-id", "--ref", "--files", "--target-id"]
      },
      {
        name: "pointer-move",
        usage: "npx opendevbrowser pointer-move --session-id <id> --x <n> --y <n> [--steps <n>] [--target-id <id>]",
        flags: ["--session-id", "--x", "--y", "--steps", "--target-id"]
      },
      {
        name: "pointer-down",
        usage: "npx opendevbrowser pointer-down --session-id <id> --x <n> --y <n> [--button <left|middle|right>] [--click-count <n>] [--target-id <id>]",
        flags: ["--session-id", "--x", "--y", "--button", "--click-count", "--target-id"]
      },
      {
        name: "pointer-up",
        usage: "npx opendevbrowser pointer-up --session-id <id> --x <n> --y <n> [--button <left|middle|right>] [--click-count <n>] [--target-id <id>]",
        flags: ["--session-id", "--x", "--y", "--button", "--click-count", "--target-id"]
      },
      {
        name: "pointer-drag",
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
        usage: "npx opendevbrowser targets-list --session-id <id> [--include-urls]",
        flags: ["--session-id", "--include-urls"]
      },
      {
        name: "target-use",
        usage: "npx opendevbrowser target-use --session-id <id> --target-id <id>",
        flags: ["--session-id", "--target-id"]
      },
      {
        name: "target-new",
        usage: "npx opendevbrowser target-new --session-id <id> [--url <url>]",
        flags: ["--session-id", "--url"]
      },
      {
        name: "target-close",
        usage: "npx opendevbrowser target-close --session-id <id> --target-id <id>",
        flags: ["--session-id", "--target-id"]
      },
      {
        name: "page",
        usage: "npx opendevbrowser page --session-id <id> --name <page> [--url <url>]",
        flags: ["--session-id", "--name", "--url"]
      },
      {
        name: "pages",
        usage: "npx opendevbrowser pages --session-id <id>",
        flags: ["--session-id"]
      },
      {
        name: "page-close",
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
        usage: "npx opendevbrowser dom-html --session-id <id> [--ref <ref>] [--max-chars <n>]",
        flags: ["--session-id", "--ref", "--max-chars"]
      },
      {
        name: "dom-text",
        usage: "npx opendevbrowser dom-text --session-id <id> [--ref <ref>] [--max-chars <n>]",
        flags: ["--session-id", "--ref", "--max-chars"]
      },
      {
        name: "dom-attr",
        usage: "npx opendevbrowser dom-attr --session-id <id> --ref <ref> --attr <name>",
        flags: ["--session-id", "--ref", "--attr"]
      },
      {
        name: "dom-value",
        usage: "npx opendevbrowser dom-value --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "dom-visible",
        usage: "npx opendevbrowser dom-visible --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "dom-enabled",
        usage: "npx opendevbrowser dom-enabled --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "dom-checked",
        usage: "npx opendevbrowser dom-checked --session-id <id> --ref <ref>",
        flags: ["--session-id", "--ref"]
      },
      {
        name: "clone-page",
        usage: "npx opendevbrowser clone-page --session-id <id> [--target-id <id>] [--path <file>]",
        flags: ["--session-id", "--target-id", "--path"]
      },
      {
        name: "clone-component",
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
        usage: "npx opendevbrowser session-inspector --session-id <id> [--include-urls] [--since-console-seq <n>] [--since-network-seq <n>] [--since-exception-seq <n>] [--max <n>] [--request-id <id>]",
        flags: ["--session-id", "--include-urls", "--since-console-seq", "--since-network-seq", "--since-exception-seq", "--max", "--request-id"]
      },
      {
        name: "session-inspector-plan",
        usage: "npx opendevbrowser session-inspector-plan --session-id <id> [--target-id <id>] [--challenge-automation-mode <mode>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--challenge-automation-mode", "--timeout-ms"]
      },
      {
        name: "session-inspector-audit",
        usage: "npx opendevbrowser session-inspector-audit --session-id <id> [--target-id <id>] [--reason <text>] [--max-chars <n>] [--cursor <cursor>] [--include-urls] [--since-console-seq <n>] [--since-network-seq <n>] [--since-exception-seq <n>] [--max <n>] [--request-id <id>] [--challenge-automation-mode <mode>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--reason", "--max-chars", "--cursor", "--include-urls", "--since-console-seq", "--since-network-seq", "--since-exception-seq", "--max", "--request-id", "--challenge-automation-mode", "--timeout-ms"]
      },
      {
        name: "perf",
        usage: "npx opendevbrowser perf --session-id <id>",
        flags: ["--session-id"]
      },
      {
        name: "screenshot",
        usage: "npx opendevbrowser screenshot --session-id <id> [--target-id <id>] [--path <file>] [--ref <ref> | --full-page] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--path", "--ref", "--full-page", "--timeout-ms"]
      },
      {
        name: "dialog",
        usage: "npx opendevbrowser dialog --session-id <id> [--target-id <id>] [--action <status|accept|dismiss>] [--prompt-text <text>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--action", "--prompt-text", "--timeout-ms"]
      },
      {
        name: "console-poll",
        usage: "npx opendevbrowser console-poll --session-id <id> [--since-seq <n>] [--max <n>]",
        flags: ["--session-id", "--since-seq", "--max"]
      },
      {
        name: "network-poll",
        usage: "npx opendevbrowser network-poll --session-id <id> [--since-seq <n>] [--max <n>]",
        flags: ["--session-id", "--since-seq", "--max"]
      },
      {
        name: "debug-trace-snapshot",
        usage: "npx opendevbrowser debug-trace-snapshot --session-id <id> [--since-console-seq <n>] [--since-network-seq <n>] [--since-exception-seq <n>] [--max <n>] [--request-id <id>]",
        flags: ["--session-id", "--since-console-seq", "--since-network-seq", "--since-exception-seq", "--max", "--request-id"]
      },
      {
        name: "annotate",
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
        usage: "npx opendevbrowser screencast-start --session-id <id> [--target-id <id>] [--output-dir <path>] [--interval-ms <ms>] [--max-frames <n>] [--timeout-ms <ms>]",
        flags: ["--session-id", "--target-id", "--output-dir", "--interval-ms", "--max-frames", "--timeout-ms"]
      },
      {
        name: "screencast-stop",
        usage: "npx opendevbrowser screencast-stop --session-id <id> --screencast-id <id> [--timeout-ms <ms>]",
        flags: ["--session-id", "--screencast-id", "--timeout-ms"]
      }
    ]
  },
  {
    id: "desktop_observation",
    title: "Desktop Observation",
    summary: "Inspect the public read-only sibling desktop observation plane on macOS; window inventory and accessibility probes use the local swift command, while screenshots use screencapture outside extension relay.",
    commands: [
      {
        name: "desktop-status",
        usage: "npx opendevbrowser desktop-status [--timeout-ms <ms>]",
        flags: ["--timeout-ms"]
      },
      {
        name: "desktop-windows",
        usage: "npx opendevbrowser desktop-windows [--reason <text>] [--timeout-ms <ms>]",
        flags: ["--reason", "--timeout-ms"]
      },
      {
        name: "desktop-active-window",
        usage: "npx opendevbrowser desktop-active-window [--reason <text>] [--timeout-ms <ms>]",
        flags: ["--reason", "--timeout-ms"]
      },
      {
        name: "desktop-capture-desktop",
        usage: "npx opendevbrowser desktop-capture-desktop --reason <text> [--timeout-ms <ms>]",
        flags: ["--reason", "--timeout-ms"]
      },
      {
        name: "desktop-capture-window",
        usage: "npx opendevbrowser desktop-capture-window --window-id <id> --reason <text> [--timeout-ms <ms>]",
        flags: ["--window-id", "--reason", "--timeout-ms"]
      },
      {
        name: "desktop-accessibility-snapshot",
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
        usage: "npx opendevbrowser rpc --unsafe-internal --name <daemon.command> [--params <json> | --params-file <path>] [--timeout-ms <ms>]",
        flags: ["--unsafe-internal", "--name", "--params", "--params-file", "--timeout-ms"]
      }
    ]
  }
] as const satisfies readonly PublicSurfaceCliCommandGroupDefinition[];

export type PublicSurfaceCliCommandName = typeof PUBLIC_CLI_COMMAND_GROUPS[number]["commands"][number]["name"];

export interface CommandHelpDetail {
  usage: string;
  flags: readonly PublicSurfaceFlagName[];
}

export const CLI_COMMANDS = PUBLIC_CLI_COMMAND_GROUPS.flatMap((group) => (
  group.commands.map((command) => command.name)
)) as PublicSurfaceCliCommandName[];

export const CLI_COMMAND_HELP_DETAILS = Object.fromEntries(
  PUBLIC_CLI_COMMAND_GROUPS.flatMap((group) => (
    group.commands.map((command) => [
      command.name,
      {
        usage: command.usage,
        flags: [...command.flags]
      } satisfies CommandHelpDetail
    ] as const)
  ))
) as unknown as Record<PublicSurfaceCliCommandName, CommandHelpDetail>;

export interface ToolSurfaceEntry {
  name: string;
  description: string;
  cliEquivalent?: string;
}

export const TOOL_SURFACE_ENTRIES: readonly ToolSurfaceEntry[] = [
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
      usage: command.usage,
      flags: [...command.flags],
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
    ...(entry.cliEquivalent ? { cliEquivalent: entry.cliEquivalent } : {})
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
