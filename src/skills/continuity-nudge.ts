export type ContinuityNudgeState = {
  pending: boolean;
  requestedAtMs: number | null;
};

export const CONTINUITY_NUDGE_MARKER = "[opendevbrowser:continuity-nudge]";

const DEFAULT_FILE_PATH = "opendevbrowser_continuity.md";

export function createContinuityNudgeState(): ContinuityNudgeState {
  return { pending: false, requestedAtMs: null };
}

export function shouldTriggerContinuityNudge(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

export function markContinuityNudge(state: ContinuityNudgeState, nowMs: number): void {
  state.pending = true;
  state.requestedAtMs = nowMs;
}

export function clearContinuityNudge(state: ContinuityNudgeState): void {
  state.pending = false;
  state.requestedAtMs = null;
}

export function consumeContinuityNudge(
  state: ContinuityNudgeState,
  nowMs: number,
  maxAgeMs: number
): boolean {
  if (!state.pending) return false;

  const requestedAt = state.requestedAtMs ?? 0;
  if (!state.requestedAtMs || nowMs - requestedAt > maxAgeMs) {
    clearContinuityNudge(state);
    return false;
  }

  clearContinuityNudge(state);
  return true;
}

export function buildContinuityNudgeMessage(filePath?: string): string {
  const target = filePath?.trim() || DEFAULT_FILE_PATH;
  return `${CONTINUITY_NUDGE_MARKER} For long-running tasks, create or update ${target} at the repo root with Goal, Constraints/Assumptions, Key decisions, State (Done/Now/Next), Open questions, and Working set. Keep it brief.`;
}
