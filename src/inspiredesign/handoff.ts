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

export const INSPIREDESIGN_HANDOFF_SKILLS = {
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
  reviewAdvancedBrief: `${INSPIREDESIGN_HANDOFF_FILES.advancedBrief} is the authoritative prompt route for the selected format, profile defaults, layout posture, motion grammar, and anti-patterns. Read it before touching Canvas or implementation files.`,
  prepareCanvasPlanRequest: `Fill canvasSessionId, leaseId, and documentId in ${INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest} before running ${INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas}.`,
  deepCaptureRecommendation: "Any inspiredesign run with reference URLs already uses captureMode=deep. Rerun with the same URLs only when you need refreshed DOM/layout evidence, restored session state, or capture-specific debugging."
} as const;

export const buildInspiredesignFollowthroughSummary = (): string => (
  `Read ${INSPIREDESIGN_HANDOFF_FILES.advancedBrief} first, then continue in OpenDevBrowser Canvas with ${INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest} and ${INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff}, load ${INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS[0]} plus ${INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS[1]} before implementation, and note that any supplied reference URL already uses captureMode=deep.`
);

export const buildInspiredesignNextStep = (): string => (
  `Read ${INSPIREDESIGN_HANDOFF_FILES.advancedBrief} first. ${INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest} Then run ${INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas}, confirm planStatus=accepted, then patch only the governance blocks listed in ${INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff}.`
);
