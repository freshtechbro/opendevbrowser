export const INSPIREDESIGN_HANDOFF_FILES = {
  designMarkdown: "design.md",
  advancedBrief: "advanced-brief.md",
  designContract: "design-contract.json",
  canvasPlanRequest: "canvas-plan.request.json",
  designAgentHandoff: "design-agent-handoff.json",
  generationPlan: "generation-plan.json",
  implementationPlanMarkdown: "implementation-plan.md",
  implementationPlan: "implementation-plan.json",
  evidence: "evidence.json",
  prototypeGuidance: "prototype-guidance.md"
} as const;

export type InspiredesignGuideEntry = {
  purpose: string;
  expectedContents: readonly string[];
  howToUse: readonly string[];
  mustNot: readonly string[];
};

type InspiredesignHandoffFile =
  (typeof INSPIREDESIGN_HANDOFF_FILES)[keyof typeof INSPIREDESIGN_HANDOFF_FILES];

export type InspiredesignArtifactGuide = Record<InspiredesignHandoffFile, InspiredesignGuideEntry>;

export type InspiredesignContractSectionGuide = Record<string, InspiredesignGuideEntry>;

const INSPIREDESIGN_HANDOFF_SKILLS = {
  bestPractices: {
    name: "opendevbrowser-best-practices",
    topic: "quick start"
  },
  designAgent: {
    name: "opendevbrowser-design-agent",
    topic: "canvas-contract"
  }
} as const;

type InspiredesignHandoffSkill =
  (typeof INSPIREDESIGN_HANDOFF_SKILLS)[keyof typeof INSPIREDESIGN_HANDOFF_SKILLS];

const formatSkillReference = (skill: InspiredesignHandoffSkill): string => (
  `${skill.name} "${skill.topic}"`
);

const formatSkillLoadCommand = (skill: InspiredesignHandoffSkill): string => (
  `opendevbrowser_skill_load ${skill.name} "${skill.topic}"`
);

export const INSPIREDESIGN_HANDOFF_COMMANDS = {
  loadBestPractices: formatSkillLoadCommand(INSPIREDESIGN_HANDOFF_SKILLS.bestPractices),
  loadDesignAgent: formatSkillLoadCommand(INSPIREDESIGN_HANDOFF_SKILLS.designAgent),
  continueInCanvas: `opendevbrowser canvas --command canvas.plan.set --params-file ./${INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest}`
} as const;

export const INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS = [
  formatSkillReference(INSPIREDESIGN_HANDOFF_SKILLS.bestPractices),
  formatSkillReference(INSPIREDESIGN_HANDOFF_SKILLS.designAgent)
] as const;

export const INSPIREDESIGN_HANDOFF_GUIDANCE = {
  reviewAdvancedBrief: `${INSPIREDESIGN_HANDOFF_FILES.advancedBrief} is the authoritative reference-first brief. When URL references exist, captured evidence leads the creative direction; selected format, profile defaults, layout posture, motion grammar, and anti-patterns are route guardrails only. Read it before touching Canvas or implementation files.`,
  prepareCanvasPlanRequest: `Fill canvasSessionId, leaseId, and documentId in ${INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest} before running ${INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas}.`,
  deepCaptureRecommendation: "Any inspiredesign run with reference URLs already uses captureMode=deep. Rerun with the same URLs only when you need refreshed DOM/layout evidence, restored session state, or capture-specific debugging."
} as const;

export const INSPIREDESIGN_ARTIFACT_GUIDE: InspiredesignArtifactGuide = {
  [INSPIREDESIGN_HANDOFF_FILES.advancedBrief]: {
    purpose: "Authoritative reference-first brief for the downstream design agent.",
    expectedContents: ["Selected prompt format", "reference pattern board", "route guardrails"],
    howToUse: ["Read first", "treat captured evidence as creative priority", "use guardrails to avoid route drift"],
    mustNot: ["Do not treat defaults as stronger than captured references"]
  },
  [INSPIREDESIGN_HANDOFF_FILES.designMarkdown]: {
    purpose: "Human-readable design specification and implementation narrative.",
    expectedContents: ["inspiration analysis", "unified direction", "governance summary", "deliverables"],
    howToUse: ["Use as the readable project brief", "cross-check implementation choices against its sections"],
    mustNot: ["Do not use prose as a substitute for the JSON contract when patching Canvas"]
  },
  [INSPIREDESIGN_HANDOFF_FILES.designContract]: {
    purpose: "Narrowed Canvas governance contract for design decisions.",
    expectedContents: ["emitted governance blocks", "motion system", "library policy", "runtime budgets"],
    howToUse: ["Patch only emitted governance blocks", "compare implementation against this contract before shipping"],
    mustNot: ["Do not add navigation, async, or performance context as Canvas governance patches"]
  },
  [INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest]: {
    purpose: "Ready-to-fill request payload for `canvas.plan.set`.",
    expectedContents: ["request ids", "Canvas session ids", "mutation-safe generationPlan"],
    howToUse: ["Fill canvasSessionId, leaseId, and documentId", "submit with the provided canvas.plan.set command"],
    mustNot: ["Do not add handoff-only fields or reference-only analysis to generationPlan"]
  },
  [INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff]: {
    purpose: "Downstream index for artifact usage, skills, commands, and omitted implementation context.",
    expectedContents: ["skills", "commands", "contract scope", "implementation context", "artifact and section guides"],
    howToUse: ["Use as the navigation map for the bundle", "load recommended skills before implementation"],
    mustNot: ["Do not treat handoff context as runtime Canvas schema"]
  },
  [INSPIREDESIGN_HANDOFF_FILES.generationPlan]: {
    purpose: "Full generated plan for reasoning about design intent.",
    expectedContents: ["Canvas plan fields", "design vectors", "reference analysis when available"],
    howToUse: ["Use for agent reasoning and audit traceability", "compare with canvas-plan.request.json for runtime subset"],
    mustNot: ["Do not submit this file directly to Canvas when it contains non-request context"]
  },
  [INSPIREDESIGN_HANDOFF_FILES.implementationPlanMarkdown]: {
    purpose: "Human-readable engineering sequence for the first implementation pass.",
    expectedContents: ["build sequence", "component plan", "token strategy", "QA and risk checks"],
    howToUse: ["Convert sections into implementation tasks", "keep tests and browser validation aligned to the plan"],
    mustNot: ["Do not implement sections unsupported by brief or reference evidence"]
  },
  [INSPIREDESIGN_HANDOFF_FILES.implementationPlan]: {
    purpose: "Machine-readable implementation plan matching the Markdown plan.",
    expectedContents: ["architecture steps", "component inventory", "state and validation tasks"],
    howToUse: ["Use for structured task extraction", "keep it synchronized with implementation-plan.md"],
    mustNot: ["Do not treat it as a Canvas document patch payload"]
  },
  [INSPIREDESIGN_HANDOFF_FILES.evidence]: {
    purpose: "Evidence digest for brief, reference, capture, and design-vector provenance.",
    expectedContents: ["brief expansion", "reference outcomes", "capture attempts", "design vectors"],
    howToUse: ["Audit why choices were made", "prefer evidence over generic template defaults"],
    mustNot: ["Do not ignore failed or skipped capture statuses when judging confidence"]
  },
  [INSPIREDESIGN_HANDOFF_FILES.prototypeGuidance]: {
    purpose: "Optional first prototype guidance when the workflow requests prototype output.",
    expectedContents: ["prototype structure", "design-vector guidance", "browser proof checklist"],
    howToUse: ["Use only for the first prototype pass", "promote proven ideas back into contract-aligned work"],
    mustNot: ["Do not treat prototype guidance as final implementation authority"]
  }
};

export const INSPIREDESIGN_CONTRACT_SECTION_GUIDE: InspiredesignContractSectionGuide = {
  intent: {
    purpose: "Define why the design exists and what success means.",
    expectedContents: ["audience", "task", "success criteria", "trust posture"],
    howToUse: ["Validate the primary user job before styling", "reject sections that do not serve the task"],
    mustNot: ["Do not start visual polish before the audience and task are clear"]
  },
  generationPlan: {
    purpose: "Mutation-safe subset accepted by Canvas planning.",
    expectedContents: ["target outcome", "visual, layout, content, component, motion, responsive, accessibility posture"],
    howToUse: ["Submit only through canvas-plan.request.json", "repair generationPlanIssues before mutation"],
    mustNot: ["Do not add handoff-only guide fields to the Canvas generation plan"]
  },
  designLanguage: {
    purpose: "Name the coherent visual direction and token ownership.",
    expectedContents: ["direction", "style axes", "semantic token source", "approved libraries"],
    howToUse: ["Keep one design language per task", "align repeated components to semantic tokens"],
    mustNot: ["Do not mix unrelated visual families inside one surface"]
  },
  contentModel: {
    purpose: "Define real content, message hierarchy, and UI states.",
    expectedContents: ["primary message", "supporting messages", "states", "loading, empty, and error behavior"],
    howToUse: ["Use real content first", "plan non-happy-path states before polish"],
    mustNot: ["Do not ship placeholder copy as product content"]
  },
  layoutSystem: {
    purpose: "Describe page architecture and section rhythm.",
    expectedContents: ["grid", "containers", "spacing rhythm", "alignment rules"],
    howToUse: ["Use to place sections and scan units consistently", "verify desktop and mobile structure"],
    mustNot: ["Do not invent one-off layout rules for repeated sections"]
  },
  typographySystem: {
    purpose: "Define type families, scale, measure, and loading behavior.",
    expectedContents: ["families", "scale", "measure", "fallback policy", "loading strategy"],
    howToUse: ["Apply type hierarchy consistently", "avoid layout shift from font loading"],
    mustNot: ["Do not default to unapproved system stacks for a distinctive design"]
  },
  colorSystem: {
    purpose: "Define semantic color roles and theme behavior.",
    expectedContents: ["primary roles", "surface roles", "text roles", "state colors"],
    howToUse: ["Map repeated UI to semantic tokens", "validate contrast in every required theme"],
    mustNot: ["Do not scatter raw color values across leaf components"]
  },
  surfaceSystem: {
    purpose: "Define material, depth, borders, and background behavior.",
    expectedContents: ["surface hierarchy", "border rules", "shadow rules", "material effects"],
    howToUse: ["Use depth only to clarify hierarchy", "align material effects with design vectors"],
    mustNot: ["Do not turn every content group into a card by default"]
  },
  iconSystem: {
    purpose: "Define icon usage and decorative asset boundaries.",
    expectedContents: ["icon family", "stroke policy", "labeling rules", "decorative rules"],
    howToUse: ["Use icons to clarify actions", "keep accessible names on icon-only controls"],
    mustNot: ["Do not rely on icons as the only explanation for critical actions"]
  },
  motionSystem: {
    purpose: "Define motion that supports comprehension.",
    expectedContents: ["timing", "interaction moments", "reduced-motion posture", "advanced motion advisory"],
    howToUse: ["Keep shader, WebGL, and Spline cues advisory", "provide reduced-motion replacements"],
    mustNot: ["Do not use motion cues to authorize new runtime libraries"]
  },
  responsiveSystem: {
    purpose: "Define authored behavior across desktop, tablet, and mobile.",
    expectedContents: ["breakpoints", "adaptation rules", "touch policy", "overflow policy"],
    howToUse: ["Validate the primary action at every viewport", "collapse structure before copy becomes cramped"],
    mustNot: ["Do not assume desktop layouts naturally scale down"]
  },
  accessibilityPolicy: {
    purpose: "Set accessibility requirements before implementation.",
    expectedContents: ["WCAG target", "keyboard requirements", "focus policy", "semantic requirements"],
    howToUse: ["Block release on contrast or keyboard regressions", "validate focus on every interactive state"],
    mustNot: ["Do not defer accessibility until after visual implementation"]
  },
  libraryPolicy: {
    purpose: "Declare approved implementation libraries and runtime boundaries.",
    expectedContents: ["components", "icons", "styling", "motion", "threeD"],
    howToUse: ["Use as the dependency authorization boundary", "keep motion and threeD empty unless separately approved"],
    mustNot: ["Do not infer WebGL, shader, Spline, or 3D runtime support from advisory motion"]
  },
  runtimeBudgets: {
    purpose: "Set practical limits for sections, actions, interaction latency, and preview cost.",
    expectedContents: ["section budgets", "action budgets", "latency budgets", "preview notes"],
    howToUse: ["Use as a constraint during implementation", "validate slow or animation-heavy surfaces against it"],
    mustNot: ["Do not add decorative weight that violates the budget"]
  },
  navigationModel: {
    purpose: "Implementation-only context for route, tab, overlay, and deep-link ownership.",
    expectedContents: ["route owner", "deep-link policy", "invalid route fallback", "overlay entry points"],
    howToUse: ["Use from design-agent-handoff.json when wiring implementation state"],
    mustNot: ["Do not patch this omitted block into Canvas governance"]
  },
  asyncModel: {
    purpose: "Implementation-only context for loading, restart, cancellation, and URL-owned query state.",
    expectedContents: ["owner", "load trigger", "restart triggers", "cancellation policy"],
    howToUse: ["Use when wiring fetch/search state and stale-request handling"],
    mustNot: ["Do not let components invent independent async ownership"]
  },
  performanceModel: {
    purpose: "Implementation-only context for render hotspots and measurement posture.",
    expectedContents: ["render hotspots", "stable identity policy", "list strategy", "measurement plan"],
    howToUse: ["Use before building scan-heavy or motion-heavy surfaces"],
    mustNot: ["Do not ship heavy interaction surfaces without measurement evidence"]
  }
};

export const buildInspiredesignFollowthroughSummary = (): string => (
  `Read ${INSPIREDESIGN_HANDOFF_FILES.advancedBrief} first, then continue in OpenDevBrowser Canvas with ${INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest} and ${INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff}, load ${INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS[0]} plus ${INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS[1]} before implementation, and note that any supplied reference URL already uses captureMode=deep.`
);

export const buildInspiredesignNextStep = (): string => (
  `Read ${INSPIREDESIGN_HANDOFF_FILES.advancedBrief} first. ${INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest} Then run ${INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas}, confirm planStatus=accepted, then patch only the governance blocks listed in ${INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff}.`
);
