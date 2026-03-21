import type {
  CanvasComponentInventoryItem,
  CanvasKitCatalogEntry,
  CanvasTokenCollection
} from "../types";

type TemplateNode = {
  id: string;
  kind: "frame" | "text" | "component-instance";
  name: string;
  parentId: string | null;
  rect: { x: number; y: number; width: number; height: number };
  props?: Record<string, unknown>;
  style?: Record<string, unknown>;
  tokenRefs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const REACT_FRAMEWORK = {
  id: "react",
  label: "React",
  packageName: "react",
  metadata: {}
} as const;

const TSX_REACT_ADAPTER = {
  id: "tsx-react-v1",
  label: "TSX React v1",
  packageName: "@opendevbrowser/tsx-react-v1",
  metadata: {}
} as const;

function createTokenCollection(
  id: string,
  name: string,
  items: Array<{ id: string; path: string; value: unknown; type?: string }>
): CanvasTokenCollection {
  return {
    id,
    name,
    items: items.map(({ id: itemId, path, value, type = null }) => ({
      id: itemId,
      path,
      value: structuredClone(value),
      type,
      description: null,
      modes: [],
      metadata: {}
    })),
    metadata: {}
  };
}

function createInventoryItem(options: {
  id: string;
  name: string;
  componentName: string;
  description: string;
  props?: CanvasComponentInventoryItem["props"];
  content?: Partial<CanvasComponentInventoryItem["content"]>;
  template: { rootNodeId: string; nodes: TemplateNode[] };
}): CanvasComponentInventoryItem {
  const { props = [], content = {} } = options;
  return {
    id: options.id,
    name: options.name,
    componentName: options.componentName,
    description: options.description,
    sourceKind: "built-in-kit",
    sourceFamily: "starter_template",
    origin: "starter",
    framework: {
      ...REACT_FRAMEWORK,
      adapter: { ...TSX_REACT_ADAPTER }
    },
    adapter: { ...TSX_REACT_ADAPTER },
    plugin: null,
    variants: [],
    props: structuredClone(props),
    slots: [],
    events: [],
    content: {
      acceptsText: false,
      acceptsRichText: false,
      slotNames: [],
      metadata: {},
      ...structuredClone(content)
    },
    metadata: {
      template: {
        rootNodeId: options.template.rootNodeId,
        nodes: options.template.nodes.map(({ props: nodeProps = {}, style = {}, tokenRefs = {}, metadata = {}, ...node }) => ({
          id: node.id,
          kind: node.kind,
          name: node.name,
          parentId: node.parentId,
          childIds: [],
          rect: structuredClone(node.rect),
          props: structuredClone(nodeProps),
          style: structuredClone(style),
          tokenRefs: structuredClone(tokenRefs),
          variantPatches: [],
          metadata: structuredClone(metadata)
        }))
      }
    }
  };
}

export const BUILT_IN_CANVAS_KITS: readonly CanvasKitCatalogEntry[] = [
  {
    id: "dashboard.analytics-core",
    label: "Analytics Core",
    description: "Core dashboard surfaces for KPI and trend monitoring.",
    defaultFrameworkId: "react",
    compatibleFrameworkIds: ["react", "nextjs", "remix"],
    defaultLibraryAdapterIds: ["tsx-react-v1"],
    pluginHints: ["local-ui-kit"],
    starterHooks: [
      { starterId: "dashboard.analytics", priority: 10, metadata: {} }
    ],
    tokenCollections: [
      createTokenCollection("kit.dashboard.analytics-core.tokens", "Analytics Core Tokens", [
        { id: "surface-card", path: "surface.card", value: "#0f172a", type: "color" },
        { id: "text-strong", path: "text.strong", value: "#f8fafc", type: "color" }
      ])
    ],
    items: [
      createInventoryItem({
        id: "kit.dashboard.analytics-core.metric-card",
        name: "Analytics Metric Card",
        componentName: "AnalyticsMetricCard",
        description: "KPI card with label, value, and trend summary.",
        props: [
          { name: "label", type: "string", required: true, defaultValue: "Pipeline health", metadata: {} },
          { name: "value", type: "string", required: true, defaultValue: "98.4%", metadata: {} },
          { name: "trend", type: "string", required: false, defaultValue: "+4.2%", metadata: {} }
        ],
        template: {
          rootNodeId: "metric-card",
          nodes: [
            {
              id: "metric-card",
              kind: "frame",
              name: "Metric Card",
              parentId: null,
              rect: { x: 96, y: 96, width: 320, height: 188 },
              style: { backgroundColor: "#0f172a", borderRadius: 24, padding: 24 },
              metadata: { role: "card" }
            },
            {
              id: "metric-card-label",
              kind: "text",
              name: "Metric Label",
              parentId: "metric-card",
              rect: { x: 120, y: 118, width: 180, height: 24 },
              props: { text: "Pipeline health" },
              style: { color: "#94a3b8", fontSize: 14, fontWeight: 600 }
            },
            {
              id: "metric-card-value",
              kind: "text",
              name: "Metric Value",
              parentId: "metric-card",
              rect: { x: 120, y: 148, width: 180, height: 48 },
              props: { text: "98.4%" },
              style: { color: "#f8fafc", fontSize: 38, fontWeight: 700 }
            },
            {
              id: "metric-card-trend",
              kind: "text",
              name: "Metric Trend",
              parentId: "metric-card",
              rect: { x: 120, y: 202, width: 120, height: 20 },
              props: { text: "+4.2%" },
              style: { color: "#34d399", fontSize: 14, fontWeight: 600 }
            }
          ]
        }
      })
    ],
    metadata: {}
  },
  {
    id: "dashboard.operations-control",
    label: "Operations Control",
    description: "Operational control-room blocks for incidents and queues.",
    defaultFrameworkId: "react",
    compatibleFrameworkIds: ["react", "nextjs", "remix"],
    defaultLibraryAdapterIds: ["tsx-react-v1"],
    pluginHints: ["local-ui-kit"],
    starterHooks: [
      { starterId: "dashboard.ops", priority: 10, metadata: {} }
    ],
    tokenCollections: [
      createTokenCollection("kit.dashboard.operations-control.tokens", "Operations Control Tokens", [
        { id: "surface-panel", path: "surface.panel", value: "#111827", type: "color" },
        { id: "accent-live", path: "accent.live", value: "#f97316", type: "color" }
      ])
    ],
    items: [
      createInventoryItem({
        id: "kit.dashboard.operations-control.incident-panel",
        name: "Incident Control Panel",
        componentName: "IncidentControlPanel",
        description: "Priority incident panel with owner and recovery CTA.",
        props: [
          { name: "headline", type: "string", required: true, defaultValue: "Priority incident", metadata: {} },
          { name: "owner", type: "string", required: true, defaultValue: "Ops on-call", metadata: {} }
        ],
        template: {
          rootNodeId: "incident-panel",
          nodes: [
            {
              id: "incident-panel",
              kind: "frame",
              name: "Incident Panel",
              parentId: null,
              rect: { x: 96, y: 96, width: 360, height: 212 },
              style: { backgroundColor: "#111827", borderRadius: 24, padding: 24 }
            },
            {
              id: "incident-panel-kicker",
              kind: "text",
              name: "Incident Kicker",
              parentId: "incident-panel",
              rect: { x: 120, y: 116, width: 140, height: 20 },
              props: { text: "Live priority" },
              style: { color: "#f97316", fontSize: 13, fontWeight: 700 }
            },
            {
              id: "incident-panel-headline",
              kind: "text",
              name: "Incident Headline",
              parentId: "incident-panel",
              rect: { x: 120, y: 146, width: 220, height: 30 },
              props: { text: "Priority incident" },
              style: { color: "#f8fafc", fontSize: 24, fontWeight: 700 }
            },
            {
              id: "incident-panel-owner",
              kind: "text",
              name: "Incident Owner",
              parentId: "incident-panel",
              rect: { x: 120, y: 184, width: 180, height: 20 },
              props: { text: "Ops on-call" },
              style: { color: "#cbd5e1", fontSize: 14 }
            }
          ]
        }
      })
    ],
    metadata: {}
  },
  {
    id: "marketing.product-launch",
    label: "Product Launch",
    description: "Launch-ready hero and supporting marketing layout blocks.",
    defaultFrameworkId: "react",
    compatibleFrameworkIds: ["react", "nextjs", "remix"],
    defaultLibraryAdapterIds: ["tsx-react-v1"],
    pluginHints: [],
    starterHooks: [
      { starterId: "hero.saas-product", priority: 10, metadata: {} },
      { starterId: "pricing.subscription", priority: 20, metadata: {} }
    ],
    tokenCollections: [
      createTokenCollection("kit.marketing.product-launch.tokens", "Product Launch Tokens", [
        { id: "surface-hero", path: "surface.hero", value: "#111827", type: "color" },
        { id: "accent-hero", path: "accent.hero", value: "#38bdf8", type: "color" }
      ])
    ],
    items: [
      createInventoryItem({
        id: "kit.marketing.product-launch.feature-hero",
        name: "Feature Launch Hero",
        componentName: "FeatureLaunchHero",
        description: "Hero block with eyebrow, headline, and primary action.",
        props: [
          { name: "eyebrow", type: "string", required: true, defaultValue: "New release", metadata: {} },
          { name: "headline", type: "string", required: true, defaultValue: "Ship coordinated launches faster", metadata: {} },
          { name: "ctaLabel", type: "string", required: true, defaultValue: "Request demo", metadata: {} }
        ],
        template: {
          rootNodeId: "feature-hero",
          nodes: [
            {
              id: "feature-hero",
              kind: "frame",
              name: "Feature Hero",
              parentId: null,
              rect: { x: 96, y: 96, width: 640, height: 280 },
              style: { backgroundColor: "#111827", borderRadius: 32, padding: 40 }
            },
            {
              id: "feature-hero-eyebrow",
              kind: "text",
              name: "Hero Eyebrow",
              parentId: "feature-hero",
              rect: { x: 136, y: 130, width: 160, height: 22 },
              props: { text: "New release" },
              style: { color: "#38bdf8", fontSize: 14, fontWeight: 700 }
            },
            {
              id: "feature-hero-headline",
              kind: "text",
              name: "Hero Headline",
              parentId: "feature-hero",
              rect: { x: 136, y: 164, width: 420, height: 96 },
              props: { text: "Ship coordinated launches faster" },
              style: { color: "#f8fafc", fontSize: 40, fontWeight: 700 }
            },
            {
              id: "feature-hero-cta",
              kind: "component-instance",
              name: "Hero CTA",
              parentId: "feature-hero",
              rect: { x: 136, y: 282, width: 164, height: 44 },
              props: { text: "Request demo", variant: "primary" },
              style: { backgroundColor: "#38bdf8", borderRadius: 999 }
            }
          ]
        }
      })
    ],
    metadata: {}
  },
  {
    id: "auth.multi-step",
    label: "Multi-Step Auth",
    description: "Authentication flows for sign-in, sign-up, and verification.",
    defaultFrameworkId: "react",
    compatibleFrameworkIds: ["react", "nextjs", "remix"],
    defaultLibraryAdapterIds: ["tsx-react-v1"],
    pluginHints: [],
    starterHooks: [
      { starterId: "auth.sign-in", priority: 10, metadata: {} },
      { starterId: "auth.sign-up", priority: 20, metadata: {} }
    ],
    tokenCollections: [
      createTokenCollection("kit.auth.multi-step.tokens", "Auth Tokens", [
        { id: "surface-auth", path: "surface.auth", value: "#0f172a", type: "color" },
        { id: "border-auth", path: "border.auth", value: "#334155", type: "color" }
      ])
    ],
    items: [
      createInventoryItem({
        id: "kit.auth.multi-step.sign-in-shell",
        name: "Sign-In Shell",
        componentName: "SignInShell",
        description: "Compact auth form shell with title, support copy, and button.",
        content: { acceptsText: true },
        props: [
          { name: "headline", type: "string", required: true, defaultValue: "Welcome back", metadata: {} },
          { name: "supportingText", type: "string", required: true, defaultValue: "Continue with your workspace account.", metadata: {} }
        ],
        template: {
          rootNodeId: "sign-in-shell",
          nodes: [
            {
              id: "sign-in-shell",
              kind: "frame",
              name: "Sign-In Shell",
              parentId: null,
              rect: { x: 96, y: 96, width: 420, height: 280 },
              style: { backgroundColor: "#0f172a", borderRadius: 28, padding: 32 }
            },
            {
              id: "sign-in-shell-headline",
              kind: "text",
              name: "Auth Headline",
              parentId: "sign-in-shell",
              rect: { x: 128, y: 126, width: 220, height: 36 },
              props: { text: "Welcome back" },
              style: { color: "#f8fafc", fontSize: 28, fontWeight: 700 }
            },
            {
              id: "sign-in-shell-copy",
              kind: "text",
              name: "Auth Copy",
              parentId: "sign-in-shell",
              rect: { x: 128, y: 170, width: 248, height: 40 },
              props: { text: "Continue with your workspace account." },
              style: { color: "#cbd5e1", fontSize: 15 }
            },
            {
              id: "sign-in-shell-submit",
              kind: "component-instance",
              name: "Auth Submit",
              parentId: "sign-in-shell",
              rect: { x: 128, y: 270, width: 164, height: 44 },
              props: { text: "Continue", variant: "primary" },
              style: { backgroundColor: "#38bdf8", borderRadius: 999 }
            }
          ]
        }
      })
    ],
    metadata: {}
  },
  {
    id: "settings.account-security",
    label: "Account Security",
    description: "Settings patterns for account ownership and security controls.",
    defaultFrameworkId: "react",
    compatibleFrameworkIds: ["react", "nextjs", "remix"],
    defaultLibraryAdapterIds: ["tsx-react-v1"],
    pluginHints: [],
    starterHooks: [
      { starterId: "settings.account", priority: 10, metadata: {} }
    ],
    tokenCollections: [
      createTokenCollection("kit.settings.account-security.tokens", "Account Security Tokens", [
        { id: "surface-settings", path: "surface.settings", value: "#ffffff", type: "color" },
        { id: "border-settings", path: "border.settings", value: "#e2e8f0", type: "color" }
      ])
    ],
    items: [
      createInventoryItem({
        id: "kit.settings.account-security.security-preferences",
        name: "Security Preferences Panel",
        componentName: "SecurityPreferencesPanel",
        description: "Settings panel for 2FA, sessions, and recovery contact actions.",
        props: [
          { name: "title", type: "string", required: true, defaultValue: "Security preferences", metadata: {} }
        ],
        template: {
          rootNodeId: "security-preferences",
          nodes: [
            {
              id: "security-preferences",
              kind: "frame",
              name: "Security Preferences",
              parentId: null,
              rect: { x: 96, y: 96, width: 480, height: 248 },
              style: { backgroundColor: "#ffffff", borderRadius: 24, borderColor: "#e2e8f0", borderWidth: 1, padding: 24 }
            },
            {
              id: "security-preferences-title",
              kind: "text",
              name: "Security Title",
              parentId: "security-preferences",
              rect: { x: 122, y: 122, width: 220, height: 28 },
              props: { text: "Security preferences" },
              style: { color: "#0f172a", fontSize: 24, fontWeight: 700 }
            },
            {
              id: "security-preferences-detail",
              kind: "text",
              name: "Security Detail",
              parentId: "security-preferences",
              rect: { x: 122, y: 164, width: 260, height: 40 },
              props: { text: "Two-factor auth, device sessions, and recovery email." },
              style: { color: "#475569", fontSize: 15 }
            }
          ]
        }
      })
    ],
    metadata: {}
  }
] as const;

export function listBuiltInCanvasInventoryItems(): CanvasComponentInventoryItem[] {
  return BUILT_IN_CANVAS_KITS.flatMap((kit) =>
    kit.items.map((item) => {
      const next = structuredClone(item);
      next.metadata = {
        ...next.metadata,
        catalog: {
          kitId: kit.id,
          defaultFrameworkId: kit.defaultFrameworkId,
          compatibleFrameworkIds: [...kit.compatibleFrameworkIds],
          starterIds: kit.starterHooks.map((hook) => hook.starterId)
        }
      };
      return next;
    })
  );
}

export function listBuiltInCanvasKitIds(): string[] {
  return BUILT_IN_CANVAS_KITS.map((entry) => entry.id);
}
