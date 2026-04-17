import type { SessionInspectorHandle } from "../browser/manager-types";
import type { AutomationCoordinatorLike } from "../automation/coordinator";
import type { ToolDeps } from "./deps";
import { failure } from "./response";

export function requireAutomationCoordinator(
  deps: ToolDeps
): AutomationCoordinatorLike | string {
  return deps.automationCoordinator
    ?? failure("Automation coordinator unavailable.", "automation_coordinator_unavailable");
}

export function requireSessionInspectorHandle(
  deps: ToolDeps
): SessionInspectorHandle | string {
  const inspector = deps.manager.createSessionInspector?.();
  return inspector
    ?? failure(
      "Session inspector is unavailable for the current runtime.",
      "session_inspector_unavailable"
    );
}
