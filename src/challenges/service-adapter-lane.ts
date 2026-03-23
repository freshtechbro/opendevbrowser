import type { GovernedLaneRequest, GovernedLaneResult } from "./types";

export const runServiceAdapterLane = (request: GovernedLaneRequest): GovernedLaneResult => {
  const adapter = request.auditContext?.adapterId;
  const approved = typeof adapter === "string" && adapter.trim().length > 0;
  return {
    status: approved ? "executed" : "blocked",
    lane: "service_adapter",
    reason: approved
      ? "Governed service adapter approved by explicit adapter metadata."
      : "Service-adapter lane requires an explicit adapter identifier and entitlement.",
    auditMetadata: {
      approved,
      ...(approved ? { adapterId: adapter } : {})
    }
  };
};
