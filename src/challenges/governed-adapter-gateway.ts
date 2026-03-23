import type { ProvidersChallengeOrchestrationConfig } from "../config";
import { runOwnedEnvironmentLane } from "./owned-environment-lane";
import { runSanctionedIdentityLane } from "./sanctioned-identity-lane";
import { runServiceAdapterLane } from "./service-adapter-lane";
import type { GovernedLaneRequest, GovernedLaneResult } from "./types";

export const evaluateGovernedLane = (
  config: ProvidersChallengeOrchestrationConfig,
  request: GovernedLaneRequest
): GovernedLaneResult => {
  if (!config.enabled) {
    return {
      status: "blocked",
      lane: request.lane,
      reason: "Challenge orchestration is disabled.",
      auditMetadata: {}
    };
  }

  switch (request.lane) {
    case "owned_environment_fixture":
      if (!config.governed.allowOwnedEnvironmentFixtures) {
        return {
          status: "blocked",
          lane: request.lane,
          reason: "Owned-environment fixtures are disabled by policy.",
          auditMetadata: {}
        };
      }
      return runOwnedEnvironmentLane(request);
    case "sanctioned_identity":
      if (!config.governed.allowSanctionedIdentity) {
        return {
          status: "blocked",
          lane: request.lane,
          reason: "Sanctioned identity is disabled by policy.",
          auditMetadata: {}
        };
      }
      return runSanctionedIdentityLane(request);
    case "service_adapter":
      if (!config.governed.allowServiceAdapters) {
        return {
          status: "blocked",
          lane: request.lane,
          reason: "Service adapters are disabled by policy.",
          auditMetadata: {}
        };
      }
      return runServiceAdapterLane(request);
  }
};
