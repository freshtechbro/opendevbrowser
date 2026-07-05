import type { ChallengeAutomationMode, ChallengeInspectPlan } from "../challenges";
import type { GoogleAuthIntent } from "../core/auth-intent";
import type { BrowserMode } from "./session-store";
import type {
  BrowserAuthProvenanceDiagnostics,
  BrowserSessionDiagnostics
} from "./manager-types";
import type {
  SessionAuthCapability,
  SessionAuthProof,
  SessionProfileKind,
  SessionProfileScope
} from "./session-profile-registry";
import type { TargetInfo } from "./target-manager";

export type BrowserTransportBoundaryState =
  | "extension_relay"
  | "managed_profile"
  | "explicit_local_cdp"
  | "raw_cdp_unknown";

export type BrowserSessionCapabilitySummary = {
  transport: {
    mode: BrowserMode;
    boundary: BrowserTransportBoundaryState;
    extensionRelay: boolean;
    opsRelay: boolean;
    relayCdp: boolean;
    directCdp: boolean;
    managed: boolean;
    liveActiveTabReuse: "available" | "extension_ops_required";
  };
  profile: {
    source?: BrowserAuthProvenanceDiagnostics["profileSource"];
    kind?: SessionProfileKind;
    scope?: SessionProfileScope;
    persistent?: boolean;
    headless?: boolean;
    authCapability: SessionAuthCapability;
    authProof: SessionAuthProof;
    leaseActive?: boolean;
    pathHashPresent: boolean;
  };
  auth: {
    googleAuthIntent: GoogleAuthIntent;
    googleUserOwnedAuth: "extension_ops_available" | "extension_ops_required";
    cookieContinuityIsLoginProof: false;
    providerVerified: boolean;
    cookieBootstrap: BrowserAuthProvenanceDiagnostics["cookieBootstrap"];
    explicitCookieImportAttempted: boolean;
  };
  browserPrimitives: {
    targetListUse: true;
    snapshotRefAction: true;
    screenshots: true;
    screencastReplay: true;
    consoleNetworkDebugTrace: true;
    popupOwnershipMetadata: "observed" | "not_observed" | "unavailable";
  };
  challengeAutomation: {
    mode: ChallengeAutomationMode | "unknown";
    browserScopedActions: boolean;
    helperEligible: boolean;
    helperReason?: string;
    standDownReason?: string;
  };
  extensionBoundaries: {
    annotationStoredRelay: "extension_relay_preferred";
    designCanvasRelay: "extension_relay_required_for_canvas_tab";
    nativeMessaging: "extension_install_required";
    opsRelay: "available" | "extension_required";
    relayCdp: "available" | "relay_required";
  };
};

export type BrowserSessionCapabilityInput = {
  mode: BrowserMode;
  diagnostics?: BrowserSessionDiagnostics;
  relay?: {
    extensionConnected: boolean;
    opsConnected: boolean;
    cdpConnected: boolean;
  } | null;
  targets?: {
    targets: TargetInfo[];
    unavailable?: boolean;
  };
  challengePlan?: ChallengeInspectPlan;
  challengeAutomationMode?: ChallengeAutomationMode;
};

export function summarizeBrowserSessionCapabilities(
  input: BrowserSessionCapabilityInput
): BrowserSessionCapabilitySummary {
  const provenance = input.diagnostics?.authProvenance;
  const profile = provenance?.profile;
  const authCapability = profile?.authCapability ?? deriveAuthCapability(input.mode, provenance);
  const authProof = profile?.authProof ?? deriveAuthProof(input.mode, provenance);
  const mode = input.challengePlan?.mode ?? input.challengeAutomationMode ?? "unknown";
  const helperEligibility = input.challengePlan?.helperEligibility;
  const extensionRelay = input.mode === "extension" || input.relay?.extensionConnected === true;
  const opsRelay = input.relay?.opsConnected === true;
  const relayCdp = input.relay?.cdpConnected === true;
  const directCdp = input.mode === "cdpConnect";
  const helperSummary = summarizeChallengeHelperEligibility({
    headless: profile?.headless,
    helperEligibility
  });

  return {
    transport: {
      mode: input.mode,
      boundary: deriveTransportBoundary(input.mode, profile?.kind),
      extensionRelay,
      opsRelay,
      relayCdp,
      directCdp,
      managed: input.mode === "managed",
      liveActiveTabReuse: opsRelay ? "available" : "extension_ops_required"
    },
    profile: {
      ...(provenance?.profileSource ? { source: provenance.profileSource } : {}),
      ...(profile?.kind ? { kind: profile.kind } : {}),
      ...(profile?.scope ? { scope: profile.scope } : {}),
      ...(typeof profile?.persistent === "boolean" ? { persistent: profile.persistent } : {}),
      ...(typeof profile?.headless === "boolean" ? { headless: profile.headless } : {}),
      authCapability,
      authProof,
      ...(typeof profile?.lease?.active === "boolean" ? { leaseActive: profile.lease.active } : {}),
      pathHashPresent: typeof profile?.pathHash === "string"
    },
    auth: {
      googleAuthIntent: provenance?.googleAuthIntent ?? "none",
      googleUserOwnedAuth: input.mode === "extension" && opsRelay
        ? "extension_ops_available"
        : "extension_ops_required",
      cookieContinuityIsLoginProof: false,
      providerVerified: provenance?.providerCookieImport?.authStateVerified === true,
      cookieBootstrap: provenance?.cookieBootstrap ?? {
        attempted: false,
        disabled: false,
        importedCount: 0,
        rejectedCount: 0
      },
      explicitCookieImportAttempted: provenance?.explicitCookieImportAttempted === true
    },
    browserPrimitives: {
      targetListUse: true,
      snapshotRefAction: true,
      screenshots: true,
      screencastReplay: true,
      consoleNetworkDebugTrace: true,
      popupOwnershipMetadata: resolvePopupOwnershipMetadata(input.targets)
    },
    challengeAutomation: {
      mode,
      browserScopedActions: mode === "browser" || mode === "browser_with_helper",
      helperEligible: helperSummary.helperEligible,
      ...(helperSummary.helperReason ? { helperReason: helperSummary.helperReason } : {}),
      ...(helperSummary.standDownReason ? { standDownReason: helperSummary.standDownReason } : {})
    },
    extensionBoundaries: {
      annotationStoredRelay: "extension_relay_preferred",
      designCanvasRelay: "extension_relay_required_for_canvas_tab",
      nativeMessaging: "extension_install_required",
      opsRelay: opsRelay ? "available" : "extension_required",
      relayCdp: relayCdp ? "available" : "relay_required"
    }
  };
}

function summarizeChallengeHelperEligibility(args: {
  headless?: boolean;
  helperEligibility?: ChallengeInspectPlan["helperEligibility"];
}): {
  helperEligible: boolean;
  helperReason?: string;
  standDownReason?: string;
} {
  if (args.headless === true) {
    return {
      helperEligible: false,
      helperReason: "Headless browser sessions cannot use the optional helper bridge.",
      standDownReason: "helper_disabled_for_browser_mode"
    };
  }
  return {
    helperEligible: args.helperEligibility?.allowed === true,
    ...(args.helperEligibility?.reason ? { helperReason: args.helperEligibility.reason } : {}),
    ...(args.helperEligibility?.standDownReason ? { standDownReason: args.helperEligibility.standDownReason } : {})
  };
}

function resolvePopupOwnershipMetadata(
  targets: BrowserSessionCapabilityInput["targets"] | undefined
): BrowserSessionCapabilitySummary["browserPrimitives"]["popupOwnershipMetadata"] {
  if (targets?.unavailable === true) {
    return "unavailable";
  }
  return targets?.targets.some((target) => typeof target.openerTargetId === "string") === true
    ? "observed"
    : "not_observed";
}

function deriveTransportBoundary(
  mode: BrowserMode,
  kind: SessionProfileKind | undefined
): BrowserTransportBoundaryState {
  if (mode === "extension") {
    return "extension_relay";
  }
  if (mode === "managed") {
    return "managed_profile";
  }
  if (kind === "explicit_cdp_profile") {
    return "explicit_local_cdp";
  }
  return "raw_cdp_unknown";
}

function deriveAuthCapability(
  mode: BrowserMode,
  provenance: BrowserAuthProvenanceDiagnostics | undefined
): SessionAuthCapability {
  if (mode === "extension") {
    return "live_extension";
  }
  if (provenance?.providerCookieImport?.authStateVerified === true) {
    return "cookie_continuity";
  }
  return "public";
}

function deriveAuthProof(
  mode: BrowserMode,
  provenance: BrowserAuthProvenanceDiagnostics | undefined
): SessionAuthProof {
  if (mode === "extension") {
    return "live_extension";
  }
  if (provenance?.providerCookieImport?.authStateVerified === true) {
    return "provider_verified";
  }
  return "none";
}
