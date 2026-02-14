export type SkillNudgeState = {
  pending: boolean;
  requestedAtMs: number | null;
};

export const SKILL_NUDGE_MARKER = "[opendevbrowser:skill-nudge]";

const SKILL_NUDGE_MESSAGE = `${SKILL_NUDGE_MARKER} If this task likely matches a skill, start with skill("opendevbrowser-best-practices", "quick start"). Use another skill only when it is more relevant.`;

type TextPart = { type: "text"; text: string };
type UnknownPart = { type: string; text?: string };

export function createSkillNudgeState(): SkillNudgeState {
  return { pending: false, requestedAtMs: null };
}

export function extractTextFromParts(parts: UnknownPart[]): string {
  return parts
    .filter((part): part is TextPart => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function shouldTriggerSkillNudge(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

export function markSkillNudge(state: SkillNudgeState, nowMs: number): void {
  state.pending = true;
  state.requestedAtMs = nowMs;
}

export function clearSkillNudge(state: SkillNudgeState): void {
  state.pending = false;
  state.requestedAtMs = null;
}

export function consumeSkillNudge(state: SkillNudgeState, nowMs: number, maxAgeMs: number): boolean {
  if (!state.pending) return false;

  const requestedAt = state.requestedAtMs ?? 0;
  if (!state.requestedAtMs || nowMs - requestedAt > maxAgeMs) {
    clearSkillNudge(state);
    return false;
  }

  clearSkillNudge(state);
  return true;
}

export function buildSkillNudgeMessage(): string {
  return SKILL_NUDGE_MESSAGE;
}
