#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedProviderIdsFromSource } from "../provider-live-scenarios.mjs";
import { CANVAS_LIVE_TIMEOUTS_MS } from "../live-direct-utils.mjs";
import { PRODUCT_VIDEO_ENV_LIMITED_DETAIL_MATCHERS } from "./workflow-lane-constants.mjs";
import {
  getPublicSurfaceCounts,
  getPublicSurfaceToolEntries
} from "./public-surface-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const WORKFLOW_INVENTORY_SCHEMA_VERSION = "2026-04-10";

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

export function getCliCommands(rootDir = ROOT) {
  return getPublicSurfaceCounts(rootDir).commandNames;
}

export function getToolSurfaceEntries(rootDir = ROOT) {
  return getPublicSurfaceToolEntries(rootDir);
}

export function deriveCliToolPairs(rootDir = ROOT) {
  return getPublicSurfaceCounts(rootDir).cliToolPairs;
}

const CLI_FAMILY_DEFINITIONS = [
  {
    id: "system",
    label: "System lifecycle",
    commands: ["install", "update", "uninstall", "help", "version", "serve", "daemon"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/daemon.ts", "scripts/cli-smoke-test.mjs"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "session",
    label: "Session lifecycle",
    commands: ["launch", "connect", "disconnect", "status", "status-capabilities", "cookie-import", "cookie-list"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/session/launch.ts", "src/cli/commands/session/connect.ts", "src/cli/commands/session/disconnect.ts", "src/cli/commands/status-capabilities.ts", "src/cli/commands/session/cookie-import.ts", "src/cli/commands/session/cookie-list.ts", "scripts/cli-smoke-test.mjs"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "script",
    label: "Script automation",
    commands: ["run"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/run.ts", "scripts/cli-smoke-test.mjs"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "navigation",
    label: "Navigation and review",
    commands: ["goto", "wait", "snapshot", "review", "review-desktop"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/nav/goto.ts", "src/cli/commands/nav/wait.ts", "src/cli/commands/nav/snapshot.ts", "src/cli/commands/nav/review.ts", "src/cli/commands/nav/review-desktop.ts", "scripts/cli-smoke-test.mjs"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "interaction",
    label: "Interaction and pointer control",
    commands: ["click", "hover", "press", "check", "uncheck", "type", "select", "scroll", "scroll-into-view", "upload", "pointer-move", "pointer-down", "pointer-up", "pointer-drag"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/interact", "scripts/cli-smoke-test.mjs"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "targets",
    label: "Targets and named pages",
    commands: ["targets-list", "target-use", "target-new", "target-close", "page", "pages", "page-close"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/targets", "src/cli/commands/pages", "scripts/cli-smoke-test.mjs"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "dom",
    label: "DOM inspection and export",
    commands: ["dom-html", "dom-text", "dom-attr", "dom-value", "dom-visible", "dom-enabled", "dom-checked", "clone-page", "clone-component"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/dom", "src/cli/commands/export", "scripts/cli-smoke-test.mjs"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    commands: ["session-inspector", "session-inspector-plan", "session-inspector-audit", "perf", "screenshot", "screencast-start", "screencast-stop", "dialog", "console-poll", "network-poll", "debug-trace-snapshot", "artifacts"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/session/inspector.ts", "src/cli/commands/session/inspector-plan.ts", "src/cli/commands/session/inspector-audit.ts", "src/cli/commands/devtools", "src/cli/commands/artifacts.ts", "src/browser/session-inspector.ts", "src/browser/screencast-recorder.ts", "scripts/cli-smoke-test.mjs"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "desktop",
    label: "Desktop observation",
    commands: ["desktop-status", "desktop-windows", "desktop-active-window", "desktop-capture-desktop", "desktop-capture-window", "desktop-accessibility-snapshot"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/desktop", "src/cli/remote-desktop-runtime.ts", "src/desktop/runtime.ts"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "macro",
    label: "Macro provider workflows",
    commands: ["macro-resolve"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/macro-resolve.ts", "src/macros/execute.ts"],
    scenarioIds: [
      "workflow.macro.web_search",
      "workflow.macro.web_fetch",
      "workflow.macro.community_search",
      "workflow.macro.media_search"
    ]
  },
  {
    id: "providers",
    label: "First-class provider workflows",
    commands: ["research", "shopping", "product-video", "inspiredesign"],
    ownerFiles: [
      "src/cli/args.ts",
      "src/cli/index.ts",
      "src/cli/commands/research.ts",
      "src/cli/commands/shopping.ts",
      "src/cli/commands/product-video.ts",
      "src/cli/commands/inspiredesign.ts",
      "src/providers/inspiredesign-contract.ts",
      "src/providers/workflows.ts"
    ],
    scenarioIds: [
      "workflow.research.run",
      "workflow.shopping.run",
      "workflow.product_video.url",
      "workflow.product_video.name",
      "workflow.inspiredesign.run"
    ]
  },
  {
    id: "annotation",
    label: "Annotation workflow",
    commands: ["annotate"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/annotate.ts", "scripts/annotate-live-probe.mjs"],
    scenarioIds: ["feature.annotate.direct", "feature.annotate.relay"]
  },
  {
    id: "canvas",
    label: "Canvas workflow",
    commands: ["canvas"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/canvas.ts", "scripts/canvas-live-workflow.mjs"],
    scenarioIds: [
      "feature.canvas.managed_headless",
      "feature.canvas.managed_headed",
      "feature.canvas.extension",
      "feature.canvas.cdp"
    ]
  },
  {
    id: "guarded",
    label: "Guarded power-user surfaces",
    commands: ["native", "rpc"],
    ownerFiles: ["src/cli/args.ts", "src/cli/index.ts", "src/cli/commands/native.ts", "src/cli/commands/rpc.ts"],
    scenarioIds: ["guarded.native.bridge", "guarded.rpc.surface"]
  }
];

const TOOL_FAMILY_DEFINITIONS = [
  {
    id: "session",
    label: "Session lifecycle",
    members: ["opendevbrowser_launch", "opendevbrowser_connect", "opendevbrowser_disconnect", "opendevbrowser_status", "opendevbrowser_status_capabilities", "opendevbrowser_cookie_import", "opendevbrowser_cookie_list"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "targets_pages",
    label: "Targets and pages",
    members: ["opendevbrowser_targets_list", "opendevbrowser_target_use", "opendevbrowser_target_new", "opendevbrowser_target_close", "opendevbrowser_page", "opendevbrowser_list", "opendevbrowser_close"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "navigation",
    label: "Navigation and review",
    members: ["opendevbrowser_goto", "opendevbrowser_wait", "opendevbrowser_snapshot", "opendevbrowser_review", "opendevbrowser_review_desktop"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "interaction",
    label: "Interaction and pointer control",
    members: ["opendevbrowser_click", "opendevbrowser_hover", "opendevbrowser_press", "opendevbrowser_check", "opendevbrowser_uncheck", "opendevbrowser_type", "opendevbrowser_select", "opendevbrowser_scroll", "opendevbrowser_scroll_into_view", "opendevbrowser_upload", "opendevbrowser_pointer_move", "opendevbrowser_pointer_down", "opendevbrowser_pointer_up", "opendevbrowser_pointer_drag"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "dom",
    label: "DOM inspection",
    members: ["opendevbrowser_dom_get_html", "opendevbrowser_dom_get_text", "opendevbrowser_get_attr", "opendevbrowser_get_value", "opendevbrowser_is_visible", "opendevbrowser_is_enabled", "opendevbrowser_is_checked"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "export",
    label: "Export",
    members: ["opendevbrowser_clone_page", "opendevbrowser_clone_component"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    members: ["opendevbrowser_session_inspector", "opendevbrowser_session_inspector_plan", "opendevbrowser_session_inspector_audit", "opendevbrowser_console_poll", "opendevbrowser_network_poll", "opendevbrowser_debug_trace_snapshot", "opendevbrowser_perf", "opendevbrowser_screenshot", "opendevbrowser_screencast_start", "opendevbrowser_screencast_stop", "opendevbrowser_dialog"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "desktop",
    label: "Desktop observation",
    members: ["opendevbrowser_desktop_status", "opendevbrowser_desktop_windows", "opendevbrowser_desktop_active_window", "opendevbrowser_desktop_capture_desktop", "opendevbrowser_desktop_capture_window", "opendevbrowser_desktop_accessibility_snapshot"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "run",
    label: "Script execution",
    members: ["opendevbrowser_run"],
    scenarioIds: ["feature.cli.smoke"]
  },
  {
    id: "macro",
    label: "Macro provider workflows",
    members: ["opendevbrowser_macro_resolve"],
    scenarioIds: ["workflow.macro.web_search", "workflow.macro.web_fetch", "workflow.macro.community_search", "workflow.macro.media_search"]
  },
  {
    id: "workflow",
    label: "First-class workflows",
    members: [
      "opendevbrowser_research_run",
      "opendevbrowser_shopping_run",
      "opendevbrowser_product_video_run",
      "opendevbrowser_inspiredesign_run"
    ],
    scenarioIds: [
      "workflow.research.run",
      "workflow.shopping.run",
      "workflow.product_video.url",
      "workflow.product_video.name",
      "workflow.inspiredesign.run"
    ]
  },
  {
    id: "annotation",
    label: "Annotation",
    members: ["opendevbrowser_annotate"],
    scenarioIds: ["feature.annotate.direct", "feature.annotate.relay"]
  },
  {
    id: "canvas",
    label: "Canvas",
    members: ["opendevbrowser_canvas"],
    scenarioIds: ["feature.canvas.managed_headless", "feature.canvas.managed_headed", "feature.canvas.extension", "feature.canvas.cdp"]
  },
  {
    id: "local_only",
    label: "Local-only tool helpers",
    members: ["opendevbrowser_prompting_guide", "opendevbrowser_skill_list", "opendevbrowser_skill_load"],
    scenarioIds: ["non_cli.tool_only"]
  }
];

export const VALIDATION_SCENARIOS = [
  {
    id: "feature.cli.onboarding",
    label: "CLI onboarding quick start",
    runner: "node",
    isolatedDaemonHarness: true,
    primaryArgs: ["scripts/cli-onboarding-smoke.mjs"],
    secondaryArgs: ["scripts/cli-onboarding-smoke.mjs"],
    timeoutMs: 180_000,
    allowedStatuses: ["pass"],
    executionPolicy: "automated",
    entryPath: "node scripts/cli-onboarding-smoke.mjs",
    primaryTask: "Read generated help, follow the best-practices quick-start guidance, and confirm a minimal managed happy path.",
    secondaryTask: "Repeat the same help-led onboarding flow to prove the alias help path and bundled quick-start guidance stay deterministic.",
    ownerFiles: [
      "scripts/cli-onboarding-smoke.mjs",
      "src/cli/onboarding-metadata.json",
      "src/cli/help.ts",
      "src/skills/skill-nudge.ts",
      "docs/FIRST_RUN_ONBOARDING.md"
    ],
    notes: "This release-blocking lane proves the first-contact path from generated help to bundled guidance to one minimal success case."
  },
  {
    id: "feature.cli.smoke",
    label: "CLI smoke command matrix",
    runner: "node",
    isolatedDaemonHarness: true,
    primaryArgs: ["scripts/cli-smoke-test.mjs"],
    secondaryArgs: ["scripts/cli-smoke-test.mjs", "--variant", "secondary"],
    timeoutMs: 240_000,
    allowedStatuses: ["pass"],
    executionPolicy: "automated",
    entryPath: "node scripts/cli-smoke-test.mjs",
    primaryTask: "Bootstrap a clean temp install, run a managed browser-debugging session end to end, and verify the low-level CLI surface a power user reaches for during page triage.",
    secondaryTask: "Repeat the same low-level CLI matrix against a second synthetic page while rechecking connect, cookies, review, pointer, export, diagnostics, and teardown flows.",
    ownerFiles: ["scripts/cli-smoke-test.mjs", "src/cli/index.ts", "src/cli/args.ts"],
    notes: "This is the primary automated validation scenario for safe low-level CLI commands."
  },
  {
    id: "workflow.research.run",
    label: "Research workflow",
    runner: "cli",
    primaryArgs: ["research", "run", "--topic", "browser automation anti-bot changes", "--days", "14", "--source-selection", "auto", "--limit-per-source", "4", "--mode", "compact", "--timeout-ms", "120000"],
    secondaryArgs: ["research", "run", "--topic", "Chrome extension debugging workflows", "--days", "30", "--source-selection", "auto", "--limit-per-source", "3", "--mode", "compact", "--timeout-ms", "120000"],
    timeoutMs: 120_000,
    allowedStatuses: ["pass", "env_limited"],
    executionPolicy: "automated",
    entryPath: "opendevbrowser research run",
    primaryTask: "Research the last 14 days of public anti-bot changes that affect production browser automation teams.",
    secondaryTask: "Research public guidance and field reports about Chrome extension debugging workflows over the last month.",
    ownerFiles: ["src/cli/commands/research.ts", "src/providers/research-compiler.ts", "src/providers/research-executor.ts", "src/providers/workflows.ts", "src/providers/renderer.ts"]
  },
  {
    id: "workflow.shopping.run",
    label: "Shopping workflow",
    runner: "cli",
    primaryArgs: ["shopping", "run", "--query", "wireless ergonomic mouse", "--providers", "shopping/bestbuy,shopping/ebay", "--budget", "150", "--browser-mode", "managed", "--timeout-ms", "120000"],
    secondaryArgs: ["shopping", "run", "--query", "27 inch 4k monitor", "--providers", "shopping/bestbuy,shopping/ebay", "--budget", "350", "--browser-mode", "managed", "--sort", "lowest_price", "--timeout-ms", "120000"],
    timeoutMs: 120_000,
    allowedStatuses: ["pass"],
    executionPolicy: "automated",
    entryPath: "opendevbrowser shopping run",
    primaryTask: "Find the best ergonomic wireless mouse under a real budget using providers that should return live offers without auth walls.",
    secondaryTask: "Compare 27-inch 4K monitors under budget with explicit provider selection and price sorting pressure.",
    ownerFiles: ["src/cli/commands/shopping.ts", "src/providers/shopping-compiler.ts", "src/providers/shopping-workflow.ts", "src/providers/shopping-postprocess.ts", "src/providers/workflows.ts", "src/providers/runtime-factory.ts"]
  },
  {
    id: "workflow.product_video.url",
    label: "Product video workflow by URL",
    runner: "cli",
    primaryArgs: ["product-video", "run", "--product-url", "https://www.bestbuy.com/site/logitech-mx-master-3s-wireless-laser-mouse-with-ultrafast-scrolling-8k-dpi-any-surface-tracking-and-quiet-clicks-pale-gray/6502574.p?skuId=6502574", "--timeout-ms", "180000", "--include-copy"],
    secondaryArgs: ["product-video", "run", "--product-url", "https://www.bestbuy.com/site/sony-wh-1000xm5-wireless-noise-canceling-over-the-ear-headphones-black/6505727.p?skuId=6505727", "--timeout-ms", "180000", "--include-copy"],
    timeoutMs: 180_000,
    allowedStatuses: ["pass", "env_limited"],
    envLimitedDetailMatchers: PRODUCT_VIDEO_ENV_LIMITED_DETAIL_MATCHERS,
    executionPolicy: "automated",
    entryPath: "opendevbrowser product-video run --product-url ...",
    primaryTask: "Build a product presentation asset pack from a live Best Buy PDP for a creative brief.",
    secondaryTask: "Build a second product presentation asset pack from a different live Best Buy PDP to check asset extraction variability.",
    ownerFiles: ["src/cli/commands/product-video.ts", "src/providers/workflows.ts", "src/providers/shopping-postprocess.ts"]
  },
  {
    id: "workflow.product_video.name",
    label: "Product video workflow by name",
    runner: "cli",
    primaryArgs: ["product-video", "run", "--product-name", "Logitech MX Master 3S Wireless Mouse", "--provider-hint", "shopping/bestbuy", "--timeout-ms", "180000", "--include-copy"],
    secondaryArgs: ["product-video", "run", "--product-name", "Sony WH-1000XM5 Headphones", "--provider-hint", "shopping/bestbuy", "--timeout-ms", "180000", "--include-copy"],
    timeoutMs: 180_000,
    allowedStatuses: ["pass", "env_limited"],
    envLimitedDetailMatchers: PRODUCT_VIDEO_ENV_LIMITED_DETAIL_MATCHERS,
    executionPolicy: "automated",
    entryPath: "opendevbrowser product-video run --product-name ...",
    primaryTask: "Resolve a product by name and prepare an asset pack for a motion designer without supplying a URL manually.",
    secondaryTask: "Resolve a second named product with the same provider hint to check search-driven asset-pack stability.",
    ownerFiles: ["src/cli/commands/product-video.ts", "src/providers/workflows.ts", "src/providers/shopping-postprocess.ts"]
  },
  {
    id: "workflow.inspiredesign.run",
    label: "Inspiredesign workflow",
    runner: "cli",
    primaryArgs: [
      "inspiredesign",
      "run",
      "--brief",
      "Synthesize an editorial product landing page direction from public references.",
      "--url",
      "https://example.com/",
      "--url",
      "https://www.iana.org/domains/example",
      "--timeout-ms",
      "120000"
    ],
    secondaryArgs: [
      "inspiredesign",
      "run",
      "--brief",
      "Produce a reusable docs-marketing design contract with prototype guidance from public references.",
      "--url",
      "https://developer.mozilla.org/en-US/",
      "--url",
      "https://playwright.dev/",
      "--include-prototype-guidance",
      "--mode",
      "compact",
      "--timeout-ms",
      "120000"
    ],
    timeoutMs: 120_000,
    allowedStatuses: ["pass", "env_limited"],
    executionPolicy: "automated",
    entryPath: "opendevbrowser inspiredesign run",
    primaryTask: "Study multiple public references and return a reusable design contract without relying on deep browser capture.",
    secondaryTask: "Return the same inspiredesign contract plus prototype guidance while proving repeated --url inputs stay canonical.",
    ownerFiles: [
      "src/cli/commands/inspiredesign.ts",
      "src/tools/inspiredesign_run.ts",
      "src/providers/inspiredesign-contract.ts",
      "src/providers/workflows.ts"
    ]
  },
  {
    id: "workflow.macro.web_search",
    label: "Macro web search",
    runner: "cli",
    primaryArgs: ["macro-resolve", "--execute", "--expression", '@web.search(\"site:developer.mozilla.org playwright locator\", 4)', "--timeout-ms", "120000", "--challenge-automation-mode", "browser_with_helper"],
    secondaryArgs: ["macro-resolve", "--execute", "--expression", '@web.search(\"site:developer.chrome.com devtools protocol popup attach\", 4)', "--timeout-ms", "120000", "--challenge-automation-mode", "browser_with_helper"],
    timeoutMs: 120_000,
    allowedStatuses: ["pass", "env_limited"],
    executionPolicy: "automated",
    entryPath: "opendevbrowser macro-resolve --execute @web.search(...)",
    primaryTask: "Find authoritative public guidance on Playwright locators for a browser automation debugging note.",
    secondaryTask: "Find public Chrome DevTools Protocol guidance on popup attach flows for a browser-runtime investigation.",
    ownerFiles: ["src/cli/commands/macro-resolve.ts", "src/macros/execute.ts", "src/providers/index.ts"]
  },
  {
    id: "workflow.macro.web_fetch",
    label: "Macro web fetch",
    runner: "cli",
    primaryArgs: ["macro-resolve", "--execute", "--expression", '@web.fetch(\"https://developer.chrome.com/docs/extensions/reference/api/debugger\")', "--timeout-ms", "120000", "--challenge-automation-mode", "browser_with_helper"],
    secondaryArgs: ["macro-resolve", "--execute", "--expression", '@web.fetch(\"https://playwright.dev/docs/api/class-locator\")', "--timeout-ms", "120000", "--challenge-automation-mode", "browser_with_helper"],
    timeoutMs: 120_000,
    allowedStatuses: ["pass"],
    executionPolicy: "automated",
    entryPath: "opendevbrowser macro-resolve --execute @web.fetch(...)",
    primaryTask: "Fetch a Chrome extensions debugger reference page to inspect the document content directly.",
    secondaryTask: "Fetch a Playwright docs page to confirm direct page retrieval across a different domain and docs stack.",
    ownerFiles: ["src/cli/commands/macro-resolve.ts", "src/macros/execute.ts", "src/providers/index.ts"]
  },
  {
    id: "workflow.macro.community_search",
    label: "Macro community search",
    runner: "cli",
    primaryArgs: ["macro-resolve", "--execute", "--expression", '@community.search(\"browser automation failures\", 4)', "--timeout-ms", "120000", "--challenge-automation-mode", "browser_with_helper"],
    secondaryArgs: ["macro-resolve", "--execute", "--expression", '@community.search(\"popup attach failures\", 4)', "--timeout-ms", "120000", "--challenge-automation-mode", "browser_with_helper"],
    timeoutMs: 120_000,
    allowedStatuses: ["pass", "env_limited"],
    executionPolicy: "automated",
    entryPath: "opendevbrowser macro-resolve --execute @community.search(...)",
    primaryTask: "Find public community threads about browser automation failures that an engineer would review before opening an incident.",
    secondaryTask: "Find community discussions about popup attach failures to compare troubleshooting patterns.",
    ownerFiles: ["src/cli/commands/macro-resolve.ts", "src/macros/execute.ts", "src/providers/index.ts"]
  },
  {
    id: "workflow.macro.media_search",
    label: "Macro media search",
    runner: "cli",
    primaryArgs: ["macro-resolve", "--execute", "--expression", '@media.search(\"browser automation x\", \"x\", 5)', "--timeout-ms", "120000", "--challenge-automation-mode", "browser_with_helper"],
    secondaryArgs: ["macro-resolve", "--execute", "--expression", '@media.search(\"browser automation reddit\", \"reddit\", 5)', "--timeout-ms", "120000", "--challenge-automation-mode", "browser_with_helper"],
    timeoutMs: 120_000,
    allowedStatuses: ["pass", "env_limited"],
    executionPolicy: "automated",
    entryPath: "opendevbrowser macro-resolve --execute @media.search(...)",
    primaryTask: "Search a first-party social surface for current practitioner chatter about browser automation.",
    secondaryTask: "Repeat the media search on a second platform to verify first-party routing and shell detection on another surface.",
    ownerFiles: ["src/cli/commands/macro-resolve.ts", "src/macros/execute.ts", "src/providers/social/search-quality.ts"]
  },
  {
    id: "feature.annotate.direct",
    label: "Direct annotation probe",
    runner: "node",
    primaryArgs: ["scripts/annotate-live-probe.mjs", "--transport", "direct"],
    secondaryArgs: ["scripts/annotate-live-probe.mjs", "--transport", "direct"],
    timeoutMs: 180_000,
    allowedStatuses: ["pass", "expected_timeout"],
    executionPolicy: "automated",
    entryPath: "node scripts/annotate-live-probe.mjs --transport direct",
    primaryTask: "Request a direct annotation session on a live page to validate the annotation transport boundary.",
    secondaryTask: "Repeat the direct annotation probe on the second pass to ensure the manual-boundary behavior is stable.",
    ownerFiles: ["scripts/annotate-live-probe.mjs", "src/cli/commands/annotate.ts", "src/browser/annotation-manager.ts"]
  },
  {
    id: "feature.annotate.relay",
    label: "Relay annotation probe",
    runner: "node",
    primaryArgs: ["scripts/annotate-live-probe.mjs", "--transport", "relay"],
    secondaryArgs: ["scripts/annotate-live-probe.mjs", "--transport", "relay"],
    timeoutMs: 180_000,
    requiresExtension: true,
    allowedStatuses: ["pass", "expected_timeout", "env_limited"],
    executionPolicy: "automated",
    entryPath: "node scripts/annotate-live-probe.mjs --transport relay",
    primaryTask: "Validate relay-backed annotation on the connected extension surface as a real review handoff would.",
    secondaryTask: "Repeat the relay probe to ensure extension-boundary behavior stays stable across runs.",
    ownerFiles: ["scripts/annotate-live-probe.mjs", "src/cli/commands/annotate.ts", "src/browser/annotation-manager.ts"]
  },
  {
    id: "feature.canvas.managed_headless",
    label: "Canvas managed headless",
    runner: "node",
    primaryArgs: ["scripts/canvas-live-workflow.mjs", "--surface", "managed-headless"],
    secondaryArgs: ["scripts/canvas-live-workflow.mjs", "--surface", "managed-headless"],
    timeoutMs: CANVAS_LIVE_TIMEOUTS_MS.managedHeadless,
    allowedStatuses: ["pass"],
    executionPolicy: "automated",
    entryPath: "node scripts/canvas-live-workflow.mjs --surface managed-headless",
    primaryTask: "Build and patch a hero composition headlessly for a landing page iteration.",
    secondaryTask: "Repeat the headless hero-edit flow to check for replay stability after code fixes.",
    ownerFiles: ["scripts/canvas-live-workflow.mjs", "src/cli/commands/canvas.ts", "src/browser/canvas-manager.ts"]
  },
  {
    id: "feature.canvas.managed_headed",
    label: "Canvas managed headed",
    runner: "node",
    primaryArgs: ["scripts/canvas-live-workflow.mjs", "--surface", "managed-headed"],
    secondaryArgs: ["scripts/canvas-live-workflow.mjs", "--surface", "managed-headed"],
    timeoutMs: CANVAS_LIVE_TIMEOUTS_MS.managedHeaded,
    allowedStatuses: ["pass"],
    executionPolicy: "automated",
    entryPath: "node scripts/canvas-live-workflow.mjs --surface managed-headed",
    primaryTask: "Run the same hero-edit flow in a visible managed browser for a designer reviewing changes live.",
    secondaryTask: "Repeat the headed canvas flow after fixes to confirm the visible surface did not regress.",
    ownerFiles: ["scripts/canvas-live-workflow.mjs", "src/cli/commands/canvas.ts", "src/browser/canvas-manager.ts"]
  },
  {
    id: "feature.canvas.extension",
    label: "Canvas extension surface",
    runner: "node",
    primaryArgs: ["scripts/canvas-live-workflow.mjs", "--surface", "extension"],
    secondaryArgs: ["scripts/canvas-live-workflow.mjs", "--surface", "extension"],
    timeoutMs: CANVAS_LIVE_TIMEOUTS_MS.extension,
    requiresExtension: true,
    allowedStatuses: ["pass", "env_limited"],
    executionPolicy: "automated",
    entryPath: "node scripts/canvas-live-workflow.mjs --surface extension",
    primaryTask: "Run the hero-edit canvas flow through the connected extension surface that a logged-in operator would use.",
    secondaryTask: "Repeat the extension canvas flow to confirm relay and runtime continuity after fixes.",
    ownerFiles: ["scripts/canvas-live-workflow.mjs", "src/cli/commands/canvas.ts", "src/browser/canvas-manager.ts", "extension/src/ops/ops-runtime.ts"]
  },
  {
    id: "feature.canvas.cdp",
    label: "Canvas CDP surface",
    runner: "node",
    primaryArgs: ["scripts/canvas-live-workflow.mjs", "--surface", "cdp"],
    secondaryArgs: ["scripts/canvas-live-workflow.mjs", "--surface", "cdp"],
    timeoutMs: CANVAS_LIVE_TIMEOUTS_MS.cdp,
    requiresExtension: true,
    allowedStatuses: ["pass", "env_limited"],
    executionPolicy: "automated",
    entryPath: "node scripts/canvas-live-workflow.mjs --surface cdp",
    primaryTask: "Run the hero-edit canvas flow through the legacy CDP surface a power user still expects to work.",
    secondaryTask: "Repeat the legacy CDP canvas flow to check that reconnect/release behavior remains stable.",
    ownerFiles: ["scripts/canvas-live-workflow.mjs", "src/cli/commands/canvas.ts", "src/browser/canvas-manager.ts"]
  },
  {
    id: "guarded.connect.remote",
    label: "Remote CDP connect",
    runner: "guarded",
    primaryArgs: [],
    secondaryArgs: [],
    timeoutMs: 0,
    allowedStatuses: [],
    executionPolicy: "guarded",
    entryPath: "opendevbrowser connect --ws-endpoint ...",
    primaryTask: "Attach to an already-running Chrome instance that was started with remote debugging or a known relay endpoint.",
    secondaryTask: "Repeat the remote attach after changing the target browser or debugging port in the external environment.",
    ownerFiles: ["src/cli/commands/session/connect.ts", "src/tools/connect.ts"]
  },
  {
    id: "guarded.native.bridge",
    label: "Native bridge",
    runner: "guarded",
    primaryArgs: [],
    secondaryArgs: [],
    timeoutMs: 0,
    allowedStatuses: [],
    executionPolicy: "guarded",
    entryPath: "opendevbrowser native ...",
    primaryTask: "Use the native bridge from a trusted desktop/browser integration where the host integration is already provisioned.",
    secondaryTask: "Repeat the native bridge test after provisioning changes in the host environment.",
    ownerFiles: ["src/cli/commands/native.ts"]
  },
  {
    id: "guarded.rpc.surface",
    label: "Unsafe daemon RPC",
    runner: "guarded",
    primaryArgs: [],
    secondaryArgs: [],
    timeoutMs: 0,
    allowedStatuses: [],
    executionPolicy: "guarded",
    entryPath: "opendevbrowser rpc --unsafe-internal ...",
    primaryTask: "Issue an internal daemon RPC during a trusted power-user debugging session after verifying the exact command contract.",
    secondaryTask: "Repeat the internal RPC probe only when a new daemon contract is under active investigation.",
    ownerFiles: ["src/cli/commands/rpc.ts"]
  },
  {
    id: "non_cli.tool_only",
    label: "Tool-only local helpers",
    runner: "non_cli",
    primaryArgs: [],
    secondaryArgs: [],
    timeoutMs: 0,
    allowedStatuses: [],
    executionPolicy: "non_cli",
    entryPath: "tool-only surface",
    primaryTask: "Use tool-only local helpers from the plugin/tool API where no public CLI entry exists.",
    secondaryTask: "Repeat the same tool-only helper usage through the host tool runtime when validating local skill or prompting helpers.",
    ownerFiles: ["src/tools/index.ts", "src/public-surface/source.ts"]
  }
];

export { PRODUCT_VIDEO_ENV_LIMITED_DETAIL_MATCHERS };

function buildFamilyLookup(definitions, key) {
  const lookup = new Map();
  for (const definition of definitions) {
    for (const member of definition[key]) {
      lookup.set(member, definition);
    }
  }
  return lookup;
}

const CLI_FAMILY_LOOKUP = buildFamilyLookup(CLI_FAMILY_DEFINITIONS, "commands");
const TOOL_FAMILY_LOOKUP = buildFamilyLookup(TOOL_FAMILY_DEFINITIONS, "members");
const SCENARIO_LOOKUP = new Map(VALIDATION_SCENARIOS.map((scenario) => [scenario.id, scenario]));
const CLI_COMMAND_SCENARIO_OVERRIDES = new Map([
  ["connect", { scenarioIds: ["guarded.connect.remote"], executionPolicy: "guarded", ownerFiles: ["src/cli/commands/session/connect.ts", "src/tools/connect.ts"] }]
]);
const TOOL_SCENARIO_OVERRIDES = new Map([
  ["opendevbrowser_connect", { scenarioIds: ["guarded.connect.remote"], executionPolicy: "guarded" }]
]);

function assertScenarioIdsExist(sourceLabel, scenarioIds) {
  for (const scenarioId of scenarioIds) {
    if (!SCENARIO_LOOKUP.has(scenarioId)) {
      throw new Error(`${sourceLabel} references unknown scenario ${scenarioId}.`);
    }
  }
}

export function buildCliCommandInventory(rootDir = ROOT) {
  return getCliCommands(rootDir).map((command) => {
    const family = CLI_FAMILY_LOOKUP.get(command);
    if (!family) {
      throw new Error(`CLI command ${command} is missing inventory metadata.`);
    }
    const override = CLI_COMMAND_SCENARIO_OVERRIDES.get(command) ?? null;
    const scenarioIds = override?.scenarioIds ?? family.scenarioIds;
    assertScenarioIdsExist(`CLI command ${command}`, scenarioIds);
    const primaryScenario = SCENARIO_LOOKUP.get(scenarioIds[0]);
    return {
      id: `cli.${command}`,
      kind: "cli_command",
      label: command,
      family: family.id,
      familyLabel: family.label,
      sourceOfTruth: "src/cli/args.ts",
      executionPolicy: override?.executionPolicy ?? primaryScenario.executionPolicy,
      scenarioIds: [...scenarioIds],
      realLifeTest: primaryScenario.primaryTask,
      alternateTask: primaryScenario.secondaryTask,
      ownerFiles: [...(override?.ownerFiles ?? family.ownerFiles)]
    };
  });
}

export function buildToolInventory(rootDir = ROOT) {
  return getToolSurfaceEntries(rootDir).map((entry) => {
    const family = TOOL_FAMILY_LOOKUP.get(entry.name);
    if (!family) {
      throw new Error(`Tool ${entry.name} is missing inventory metadata.`);
    }
    const override = TOOL_SCENARIO_OVERRIDES.get(entry.name) ?? null;
    const scenarioIds = override?.scenarioIds ?? family.scenarioIds;
    assertScenarioIdsExist(`Tool ${entry.name}`, scenarioIds);
    const primaryScenario = SCENARIO_LOOKUP.get(scenarioIds[0]);
    return {
      id: `tool.${entry.name}`,
      kind: "tool_surface",
      label: entry.name,
      description: entry.description,
      family: family.id,
      familyLabel: family.label,
      sourceOfTruth: "src/public-surface/source.ts",
      cliEquivalent: entry.cliEquivalent,
      executionPolicy: override?.executionPolicy ?? primaryScenario.executionPolicy,
      scenarioIds: [...scenarioIds],
      realLifeTest: primaryScenario.primaryTask,
      alternateTask: primaryScenario.secondaryTask
    };
  });
}

export function buildToolFamilyInventory(rootDir = ROOT) {
  const toolEntries = getToolSurfaceEntries(rootDir);
  return TOOL_FAMILY_DEFINITIONS.map((definition) => {
    assertScenarioIdsExist(`Tool family ${definition.id}`, definition.scenarioIds);
    const primaryScenario = SCENARIO_LOOKUP.get(definition.scenarioIds[0]);
    return {
      id: `tool_family.${definition.id}`,
      kind: "tool_family",
      label: definition.label,
      sourceOfTruth: "src/public-surface/source.ts",
      executionPolicy: primaryScenario.executionPolicy,
      scenarioIds: [...definition.scenarioIds],
      members: toolEntries.filter((entry) => definition.members.includes(entry.name)).map((entry) => entry.name),
      realLifeTest: primaryScenario.primaryTask,
      alternateTask: primaryScenario.secondaryTask
    };
  });
}

export function buildValidationScenarioInventory() {
  return VALIDATION_SCENARIOS.map((scenario) => ({
    id: `scenario.${scenario.id}`,
    kind: "validation_scenario",
    label: scenario.label,
    executionPolicy: scenario.executionPolicy,
    entryPath: scenario.entryPath,
    runner: scenario.runner,
    primaryTask: scenario.primaryTask,
    secondaryTask: scenario.secondaryTask,
    ownerFiles: [...scenario.ownerFiles]
  }));
}

export function buildCoverageSummary(rootDir = ROOT) {
  const cliCommands = getCliCommands(rootDir);
  const toolEntries = getToolSurfaceEntries(rootDir);
  const cliToolPairs = deriveCliToolPairs(rootDir);
  const cliToolPairSet = new Set(cliToolPairs.map(([cliCommand]) => cliCommand));
  const providerIds = expectedProviderIdsFromSource(rootDir).all;
  const cliOnlyCommands = cliCommands.filter((command) => !cliToolPairSet.has(command));
  const toolOnlySurfaces = toolEntries.filter((entry) => !entry.cliEquivalent).map((entry) => entry.name);
  return {
    commandCount: cliCommands.length,
    toolCount: toolEntries.length,
    cliToolPairCount: cliToolPairs.length,
    cliOnlyCommandCount: cliOnlyCommands.length,
    toolOnlySurfaceCount: toolOnlySurfaces.length,
    providerIdCount: providerIds.length,
    cliOnlyCommands,
    toolOnlySurfaces,
    providerIds
  };
}

function ensureUniqueIds(records, label) {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new Error(`Duplicate ${label} id: ${record.id}`);
    }
    seen.add(record.id);
  }
}

export function buildWorkflowInventory(rootDir = ROOT) {
  const cliCommands = buildCliCommandInventory(rootDir);
  const toolSurfaces = buildToolInventory(rootDir);
  const toolFamilies = buildToolFamilyInventory(rootDir);
  const scenarios = buildValidationScenarioInventory();
  ensureUniqueIds(cliCommands, "CLI inventory");
  ensureUniqueIds(toolSurfaces, "tool inventory");
  ensureUniqueIds(toolFamilies, "tool family inventory");
  ensureUniqueIds(scenarios, "scenario inventory");
  return {
    schemaVersion: WORKFLOW_INVENTORY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    coverage: buildCoverageSummary(rootDir),
    cliCommands,
    cliToolPairs: deriveCliToolPairs(rootDir).map(([cliCommand, toolName]) => ({
      id: `pair.${cliCommand}`,
      cliCommand,
      toolName
    })),
    toolSurfaces,
    toolFamilies,
    scenarios
  };
}
