export const INSPIREDESIGN_HANDOFF_FILES = {
  designMarkdown: "design.md",
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
  prepareCanvasPlanRequest: `Fill canvasSessionId, leaseId, and documentId in ${INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest} before running ${INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas}.`,
  deepCaptureRecommendation: "Rerun inspiredesign with captureMode=deep only when you need richer evidence for visual hierarchy, protected references, or capture-specific debugging."
} as const;

export const buildInspiredesignFollowthroughSummary = (): string => (
  `Continue in OpenDevBrowser Canvas with ${INSPIREDESIGN_HANDOFF_FILES.canvasPlanRequest} and ${INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff}, load ${INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS[0]} plus ${INSPIREDESIGN_HANDOFF_RECOMMENDED_SKILLS[1]} before implementation, and rerun with captureMode=deep only when you need richer evidence.`
);

export const buildInspiredesignNextStep = (): string => (
  `${INSPIREDESIGN_HANDOFF_GUIDANCE.prepareCanvasPlanRequest} Then run ${INSPIREDESIGN_HANDOFF_COMMANDS.continueInCanvas}, confirm planStatus=accepted, then patch only the governance blocks listed in ${INSPIREDESIGN_HANDOFF_FILES.designAgentHandoff}.`
);
