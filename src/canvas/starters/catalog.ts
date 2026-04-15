import { BUILT_IN_CANVAS_KITS } from "../kits/catalog";
import type { CanvasGenerationPlan, CanvasKitCatalogEntry, CanvasStarterTemplate } from "../types";

type BuiltInCanvasStarterShell = {
  pageName: string;
  pagePath: string;
  shellName: string;
  rect: { x: number; y: number; width: number; height: number };
  eyebrow?: string | null;
  headline: string;
  body: string;
  actionLabel?: string | null;
};

type BuiltInCanvasStarterInsertion = {
  itemId: string;
  x: number;
  y: number;
};

type BuiltInCanvasStarterDefinition = {
  template: Omit<CanvasStarterTemplate, "kitIds">;
  generationPlan: CanvasGenerationPlan;
  shell: BuiltInCanvasStarterShell;
  insertions: BuiltInCanvasStarterInsertion[];
};

function starterKitSortKey(entry: { priority: number; kit: CanvasKitCatalogEntry }): string {
  return `${String(entry.priority).padStart(16, "0")}:${entry.kit.id}`;
}

const BUILT_IN_CANVAS_STARTERS: readonly BuiltInCanvasStarterDefinition[] = [
  {
    template: {
      id: "hero.saas-product",
      name: "SaaS Product Hero",
      description: "High-conviction hero shell for product launches and homepage above-the-fold work.",
      tags: ["hero", "marketing", "launch"],
      defaultFrameworkId: "nextjs",
      compatibleFrameworkIds: ["nextjs", "react", "remix"],
      metadata: {}
    },
    generationPlan: {
      targetOutcome: { mode: "high-fi-live-edit", summary: "Launch a product-led hero." },
      visualDirection: { profile: "product-story", themeStrategy: "single-theme" },
      layoutStrategy: { approach: "hero-first", navigationModel: "global-header" },
      contentStrategy: { source: "starter-template" },
      componentStrategy: { mode: "kit-composed", interactionStates: ["default", "hover", "focus", "disabled"] },
      motionPosture: { level: "subtle", reducedMotion: "respect-user-preference" },
      responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
      accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
      validationTargets: {
        blockOn: ["contrast-failure"],
        requiredThemes: ["light"],
        browserValidation: "required",
        maxInteractionLatencyMs: 150
      }
    },
    shell: {
      pageName: "Product Hero",
      pagePath: "/",
      shellName: "Product Hero Shell",
      rect: { x: 120, y: 120, width: 1120, height: 720 },
      eyebrow: "Product launch",
      headline: "Ship coordinated launches faster.",
      body: "A starter shell for launch pages, new-feature reveals, and product storytelling blocks.",
      actionLabel: "Book a demo"
    },
    insertions: [
      { itemId: "kit.marketing.product-launch.feature-hero", x: 152, y: 308 }
    ]
  },
  {
    template: {
      id: "pricing.subscription",
      name: "Subscription Pricing",
      description: "Pricing-page starter for subscription plans, packaging, and conversion copy.",
      tags: ["pricing", "marketing", "subscription"],
      defaultFrameworkId: "nextjs",
      compatibleFrameworkIds: ["nextjs", "react", "remix"],
      metadata: {}
    },
    generationPlan: {
      targetOutcome: { mode: "high-fi-live-edit", summary: "Create a subscription pricing starter." },
      visualDirection: { profile: "commerce-system", themeStrategy: "single-theme" },
      layoutStrategy: { approach: "pricing-stack", navigationModel: "global-header" },
      contentStrategy: { source: "starter-template" },
      componentStrategy: { mode: "kit-composed", interactionStates: ["default", "hover", "focus", "disabled"] },
      motionPosture: { level: "subtle", reducedMotion: "respect-user-preference" },
      responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
      accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
      validationTargets: {
        blockOn: ["contrast-failure"],
        requiredThemes: ["light"],
        browserValidation: "required",
        maxInteractionLatencyMs: 150
      }
    },
    shell: {
      pageName: "Pricing",
      pagePath: "/pricing",
      shellName: "Pricing Shell",
      rect: { x: 120, y: 120, width: 1120, height: 760 },
      eyebrow: "Subscription plans",
      headline: "Package the right plan for every operating team.",
      body: "Seed plan comparison, conversion messaging, and pricing detail sections with reusable kit content.",
      actionLabel: "Compare plans"
    },
    insertions: [
      { itemId: "kit.marketing.product-launch.feature-hero", x: 152, y: 324 }
    ]
  },
  {
    template: {
      id: "dashboard.analytics",
      name: "Analytics Dashboard",
      description: "Starter for KPI dashboards and metric monitoring surfaces.",
      tags: ["dashboard", "analytics", "metrics"],
      defaultFrameworkId: "react",
      compatibleFrameworkIds: ["react", "nextjs", "remix"],
      metadata: {}
    },
    generationPlan: {
      targetOutcome: { mode: "high-fi-live-edit", summary: "Seed an analytics dashboard." },
      visualDirection: { profile: "control-room", themeStrategy: "single-theme" },
      layoutStrategy: { approach: "dashboard-grid", navigationModel: "sidebar" },
      contentStrategy: { source: "starter-template" },
      componentStrategy: { mode: "kit-composed", interactionStates: ["default", "hover", "focus", "selected", "loading"] },
      motionPosture: { level: "subtle", reducedMotion: "respect-user-preference" },
      responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
      accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
      validationTargets: {
        blockOn: ["contrast-failure"],
        requiredThemes: ["light"],
        browserValidation: "required",
        maxInteractionLatencyMs: 180
      }
    },
    shell: {
      pageName: "Analytics Dashboard",
      pagePath: "/analytics",
      shellName: "Analytics Dashboard Shell",
      rect: { x: 120, y: 120, width: 1200, height: 820 },
      eyebrow: "Performance overview",
      headline: "Read product and revenue movement at a glance.",
      body: "Seed dashboard scaffolding with metric-card inventory and analytics token collections.",
      actionLabel: "Review KPIs"
    },
    insertions: [
      { itemId: "kit.dashboard.analytics-core.metric-card", x: 152, y: 292 }
    ]
  },
  {
    template: {
      id: "dashboard.ops",
      name: "Operations Dashboard",
      description: "Starter for incident, queue, and command-center dashboards.",
      tags: ["dashboard", "operations", "incidents"],
      defaultFrameworkId: "react",
      compatibleFrameworkIds: ["react", "nextjs", "remix"],
      metadata: {}
    },
    generationPlan: {
      targetOutcome: { mode: "high-fi-live-edit", summary: "Seed an operations command center." },
      visualDirection: { profile: "ops-control", themeStrategy: "single-theme" },
      layoutStrategy: { approach: "command-grid", navigationModel: "sidebar" },
      contentStrategy: { source: "starter-template" },
      componentStrategy: { mode: "kit-composed", interactionStates: ["default", "hover", "focus", "selected", "loading", "error"] },
      motionPosture: { level: "subtle", reducedMotion: "respect-user-preference" },
      responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
      accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
      validationTargets: {
        blockOn: ["contrast-failure"],
        requiredThemes: ["light"],
        browserValidation: "required",
        maxInteractionLatencyMs: 180
      }
    },
    shell: {
      pageName: "Operations Dashboard",
      pagePath: "/ops",
      shellName: "Operations Dashboard Shell",
      rect: { x: 120, y: 120, width: 1200, height: 820 },
      eyebrow: "Operations command center",
      headline: "Track live incidents, owners, and recovery posture.",
      body: "Seed incident control surfaces with reusable operations kit content.",
      actionLabel: "Review incidents"
    },
    insertions: [
      { itemId: "kit.dashboard.operations-control.incident-panel", x: 152, y: 292 }
    ]
  },
  {
    template: {
      id: "auth.sign-in",
      name: "Sign-In Flow",
      description: "Starter for sign-in, reauthentication, and workspace access flows.",
      tags: ["auth", "sign-in", "forms"],
      defaultFrameworkId: "react",
      compatibleFrameworkIds: ["react", "nextjs", "remix"],
      metadata: {}
    },
    generationPlan: {
      targetOutcome: { mode: "high-fi-live-edit", summary: "Seed a sign-in flow." },
      visualDirection: { profile: "auth-focused", themeStrategy: "single-theme" },
      layoutStrategy: { approach: "single-column-form", navigationModel: "immersive" },
      contentStrategy: { source: "starter-template" },
      componentStrategy: { mode: "kit-composed", interactionStates: ["default", "focus", "disabled", "error"] },
      motionPosture: { level: "minimal", reducedMotion: "respect-user-preference" },
      responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
      accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
      validationTargets: {
        blockOn: ["contrast-failure"],
        requiredThemes: ["light"],
        browserValidation: "required",
        maxInteractionLatencyMs: 140
      }
    },
    shell: {
      pageName: "Sign In",
      pagePath: "/sign-in",
      shellName: "Sign-In Starter Shell",
      rect: { x: 160, y: 120, width: 960, height: 720 },
      eyebrow: "Workspace access",
      headline: "Welcome back.",
      body: "Seed a focused sign-in surface with auth kit tokens and component scaffolding.",
      actionLabel: "Continue"
    },
    insertions: [
      { itemId: "kit.auth.multi-step.sign-in-shell", x: 344, y: 276 }
    ]
  },
  {
    template: {
      id: "auth.sign-up",
      name: "Sign-Up Flow",
      description: "Starter for onboarding, account creation, and invitation acceptance.",
      tags: ["auth", "sign-up", "onboarding"],
      defaultFrameworkId: "remix",
      compatibleFrameworkIds: ["remix", "react", "nextjs"],
      metadata: {}
    },
    generationPlan: {
      targetOutcome: { mode: "high-fi-live-edit", summary: "Seed a sign-up flow." },
      visualDirection: { profile: "auth-focused", themeStrategy: "single-theme" },
      layoutStrategy: { approach: "single-column-form", navigationModel: "immersive" },
      contentStrategy: { source: "starter-template" },
      componentStrategy: { mode: "kit-composed", interactionStates: ["default", "focus", "disabled", "error"] },
      motionPosture: { level: "minimal", reducedMotion: "respect-user-preference" },
      responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
      accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
      validationTargets: {
        blockOn: ["contrast-failure"],
        requiredThemes: ["light"],
        browserValidation: "required",
        maxInteractionLatencyMs: 140
      }
    },
    shell: {
      pageName: "Sign Up",
      pagePath: "/sign-up",
      shellName: "Sign-Up Starter Shell",
      rect: { x: 160, y: 120, width: 960, height: 720 },
      eyebrow: "Create an account",
      headline: "Start with your team credentials.",
      body: "Seed sign-up copy, layout, and auth kit structure without hardcoding framework-specific output.",
      actionLabel: "Create account"
    },
    insertions: [
      { itemId: "kit.auth.multi-step.sign-in-shell", x: 344, y: 276 }
    ]
  },
  {
    template: {
      id: "settings.account",
      name: "Account Settings",
      description: "Starter for account ownership, security, and preferences surfaces.",
      tags: ["settings", "account", "security"],
      defaultFrameworkId: "nextjs",
      compatibleFrameworkIds: ["nextjs", "react", "remix"],
      metadata: {}
    },
    generationPlan: {
      targetOutcome: { mode: "high-fi-live-edit", summary: "Seed account settings." },
      visualDirection: { profile: "settings-system", themeStrategy: "single-theme" },
      layoutStrategy: { approach: "settings-panel", navigationModel: "sidebar" },
      contentStrategy: { source: "starter-template" },
      componentStrategy: { mode: "kit-composed", interactionStates: ["default", "hover", "focus", "selected", "disabled"] },
      motionPosture: { level: "minimal", reducedMotion: "respect-user-preference" },
      responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
      accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
      validationTargets: {
        blockOn: ["contrast-failure"],
        requiredThemes: ["light"],
        browserValidation: "required",
        maxInteractionLatencyMs: 150
      }
    },
    shell: {
      pageName: "Account Settings",
      pagePath: "/settings/account",
      shellName: "Account Settings Shell",
      rect: { x: 120, y: 120, width: 1120, height: 760 },
      eyebrow: "Account controls",
      headline: "Manage security, devices, and recovery posture.",
      body: "Seed settings information hierarchy and account-security kit content.",
      actionLabel: "Review security"
    },
    insertions: [
      { itemId: "kit.settings.account-security.security-preferences", x: 152, y: 300 }
    ]
  },
  {
    template: {
      id: "docs.reference",
      name: "Reference Docs",
      description: "Framework-neutral docs starter for technical references and implementation notes.",
      tags: ["docs", "reference", "knowledge-base"],
      defaultFrameworkId: "astro",
      compatibleFrameworkIds: ["astro", "nextjs", "react", "remix"],
      metadata: {}
    },
    generationPlan: {
      targetOutcome: { mode: "document-only", summary: "Seed a reference documentation layout." },
      visualDirection: { profile: "documentation", themeStrategy: "single-theme" },
      layoutStrategy: { approach: "content-first", navigationModel: "sidebar" },
      contentStrategy: { source: "starter-template" },
      componentStrategy: { mode: "semantic-first", interactionStates: ["default", "focus"] },
      motionPosture: { level: "none", reducedMotion: "respect-user-preference" },
      responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
      accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
      validationTargets: {
        blockOn: ["contrast-failure"],
        requiredThemes: ["light"],
        browserValidation: "optional",
        maxInteractionLatencyMs: 220
      }
    },
    shell: {
      pageName: "Reference Docs",
      pagePath: "/docs/reference",
      shellName: "Reference Documentation Shell",
      rect: { x: 120, y: 120, width: 1120, height: 820 },
      eyebrow: "Technical reference",
      headline: "Document the surface area operators depend on.",
      body: "A framework-neutral starter for reference pages, API documentation, and architecture notes.",
      actionLabel: "Open reference"
    },
    insertions: []
  }
] as const;

function resolveStarterKitEntries(starterId: string): CanvasKitCatalogEntry[] {
  return [...BUILT_IN_CANVAS_KITS]
    .flatMap((kit) =>
      kit.starterHooks
        .filter((hook) => hook.starterId === starterId)
        .map((hook) => ({
          priority: hook.priority as number,
          kit
        }))
    )
    .sort((left, right) => starterKitSortKey(left).localeCompare(starterKitSortKey(right)))
    .map((entry) => entry.kit);
}

function enrichTemplate(template: BuiltInCanvasStarterDefinition["template"]): CanvasStarterTemplate {
  const kitEntries = resolveStarterKitEntries(template.id);
  const compatibleFrameworkIds = [
    template.defaultFrameworkId,
    ...template.compatibleFrameworkIds,
    ...kitEntries.flatMap((entry) => entry.compatibleFrameworkIds)
  ].filter((entry, index, values) => values.indexOf(entry) === index);
  return {
    ...structuredClone(template),
    compatibleFrameworkIds,
    kitIds: kitEntries.map((entry) => entry.id)
  };
}

export function listBuiltInCanvasStarterTemplates(): CanvasStarterTemplate[] {
  return BUILT_IN_CANVAS_STARTERS.map((entry) => enrichTemplate(entry.template));
}

export function listBuiltInCanvasStarterIds(): string[] {
  return BUILT_IN_CANVAS_STARTERS.map((entry) => entry.template.id);
}

export function getBuiltInCanvasStarterDefinition(starterId: string): (Omit<BuiltInCanvasStarterDefinition, "template"> & { template: CanvasStarterTemplate }) | null {
  const definition = BUILT_IN_CANVAS_STARTERS.find((entry) => entry.template.id === starterId);
  if (!definition) {
    return null;
  }
  return {
    ...structuredClone(definition),
    template: enrichTemplate(definition.template)
  };
}
