export const USE_CASES = [
  {
    title: "QA loop",
    snippet: "Run repeatable browser checks with trace-backed pass/fail evidence.",
    icon: "🧪"
  },
  {
    title: "Auth automation",
    snippet: "Operate safely in logged-in sessions using extension relay controls.",
    icon: "🔐"
  },
  {
    title: "Data extraction",
    snippet: "Extract structured page intelligence from DOM and workflow outputs.",
    icon: "📦"
  },
  {
    title: "Visual QA",
    snippet: "Capture screenshots and annotations for fast UI review cycles.",
    icon: "📸"
  },
  {
    title: "UI component extraction",
    snippet: "Clone pages/components into reusable frontend artifacts quickly.",
    icon: "🧩"
  },
  {
    title: "Ops monitoring",
    snippet: "Diagnose regressions early with status, console, network, and perf signals.",
    icon: "📊"
  },
  {
    title: "Research",
    snippet: "Generate time-bounded multi-source research outputs in one workflow run.",
    icon: "🔎"
  },
  {
    title: "Shopping",
    snippet: "Compare offers across providers with normalized pricing and confidence signals.",
    icon: "🛍️"
  },
  {
    title: "Deal hunting",
    snippet: "Find high-confidence opportunities with market-aware ranking and filters.",
    icon: "💸"
  },
  {
    title: "UGC and presentation asset collection",
    snippet: "Collect product visuals/copy artifacts for UGC videos and product slides.",
    icon: "🎬"
  }
];

export const HOW_IT_WORKS = [
  {
    step: "Launch or connect",
    detail: "Start managed mode, extension relay mode, or CDP connect mode with one lifecycle model.",
    meta: "launch / connect"
  },
  {
    step: "Navigate and snapshot",
    detail: "Capture deterministic page state before actions.",
    meta: "goto + snapshot"
  },
  {
    step: "Execute actions by refs",
    detail: "Run click, type, select, press, and scroll via stable references.",
    meta: "refs over selectors"
  },
  {
    step: "Observe diagnostics",
    detail: "Poll console, network, trace, and perf for runtime confidence.",
    meta: "console/network/perf"
  },
  {
    step: "Run workflows",
    detail: "Use packaged research, shopping, and product-video modules with per-run cookie policy controls.",
    meta: "workflow wrappers"
  },
  {
    step: "Export artifacts",
    detail: "Capture screenshots, annotations, and cloned component/page artifacts.",
    meta: "artifact export"
  },
  {
    step: "Verify and close",
    detail: "Check status and disconnect sessions with explicit completion markers.",
    meta: "status + disconnect"
  }
];

export const SECURITY_CARDS = [
  {
    title: "Secure defaults",
    detail: "Unsafe transport and raw CDP options are disabled by default.",
    icon: "🛡️"
  },
  {
    title: "Relay and origin controls",
    detail: "Token checks and origin policy gate extension relay channels.",
    icon: "🔐"
  },
  {
    title: "Data redaction",
    detail: "Sensitive values are redacted from logs and diagnostics outputs.",
    icon: "🧼"
  },
  {
    title: "Reliability posture",
    detail: "Coverage guardrails and deterministic checks back release confidence.",
    icon: "🧪"
  },
  {
    title: "Operational recovery",
    detail: "Status surfaces and reconnect controls support production operations.",
    icon: "🧭"
  },
  {
    title: "Control boundaries",
    detail: "Host and capability constraints isolate risky execution paths.",
    icon: "🚧"
  }
];

export const WORKFLOW_MODULES = [
  {
    key: "research",
    title: "Research",
    inputs: "topic, timebox, source selection",
    stages: "timebox -> source fanout -> enrichment -> render",
    outputs: "ranked findings + artifact bundle",
    useCase: "research and ops monitoring lanes"
  },
  {
    key: "shopping",
    title: "Shopping",
    inputs: "query, providers, budget, region",
    stages: "offer fanout -> normalization -> ranking",
    outputs: "deal matrix + confidence diagnostics",
    useCase: "shopping and deal hunt lanes"
  },
  {
    key: "product-video",
    title: "Product Video",
    inputs: "product url/name, provider hint",
    stages: "product fetch -> asset capture -> bundle emit",
    outputs: "presentation-ready media pack",
    useCase: "UGC and presentation lane"
  }
];

export const PRODUCT_CAPABILITIES = [
  {
    title: "Managed mode",
    detail: "Launch and control a managed browser process with deterministic lifecycle handling."
  },
  {
    title: "Extension ops mode",
    detail: "Operate inside logged-in browser contexts through extension relay surfaces."
  },
  {
    title: "Legacy CDP mode",
    detail: "Attach to pre-existing debuggable sessions when lower-level control is required."
  },
  {
    title: "Tool surface",
    detail: "48 tool endpoints cover navigation, interaction, DOM, diagnostics, export, and workflow surfaces."
  },
  {
    title: "CLI surface",
    detail: "55 commands provide script-first operational control and daemon-backed execution."
  },
  {
    title: "Verification surfaces",
    detail: "Status, traces, logs, and metrics provide confidence gates for each automation run."
  }
];
