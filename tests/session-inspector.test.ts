import { describe, expect, it, vi } from "vitest";
import {
  buildCorrelatedAuditBundle,
  inspectSession
} from "../src/browser/session-inspector";
import type {
  BrowserVerificationEnvelope,
  DesktopObservationEnvelope
} from "../src/automation/coordinator";
import type { ChallengeInspectPlan } from "../src/challenges";
import type { SessionInspectorHandle } from "../src/browser/manager-types";
import type { RelayStatus } from "../src/relay/relay-server";

type InspectorStatus = Awaited<ReturnType<SessionInspectorHandle["status"]>>;
type InspectorTargets = Awaited<ReturnType<SessionInspectorHandle["listTargets"]>>;
type InspectorTrace = Awaited<ReturnType<SessionInspectorHandle["debugTraceSnapshot"]>>;
type InspectorTraceFixture = Record<string, unknown>;
type InspectorTraceChannelInput = {
  events?: unknown[];
  nextSeq?: number;
  truncated?: boolean;
};
type InspectorTraceInput = {
  requestId?: string;
  generatedAt?: string;
  page?: Record<string, unknown>;
  channels?: {
    console?: InspectorTraceChannelInput;
    network?: InspectorTraceChannelInput;
    exception?: InspectorTraceChannelInput;
  };
  fingerprint?: InspectorTrace["fingerprint"];
  meta?: Record<string, unknown>;
};

const makeTrace = (input: InspectorTraceInput = {}): InspectorTraceFixture => ({
  requestId: input.requestId ?? "trace-default",
  generatedAt: input.generatedAt ?? "2026-04-03T00:00:00.000Z",
  page: {
    mode: "managed",
    activeTargetId: "target-1",
    ...input.page
  },
  channels: {
    console: {
      events: [],
      nextSeq: 0,
      truncated: false,
      ...input.channels?.console
    },
    network: {
      events: [],
      nextSeq: 0,
      truncated: false,
      ...input.channels?.network
    },
    exception: {
      events: [],
      nextSeq: 0,
      truncated: false,
      ...input.channels?.exception
    }
  },
  fingerprint: input.fingerprint ?? {
    tier1: {
      ok: true,
      warnings: [],
      issues: []
    },
    tier2: {
      enabled: false,
      mode: "off",
      profileId: "default",
      healthScore: 1,
      challengeCount: 0,
      rotationCount: 0,
      lastRotationTs: 0,
      lastAppliedNetworkSeq: 0,
      recentChallenges: []
    },
    tier3: {
      enabled: false,
      status: "active",
      adapterName: "none",
      fallbackTier: "tier1",
      canary: {
        level: 0,
        averageScore: 0,
        lastAction: "none",
        sampleCount: 0
      }
    }
  },
  ...(input.meta ? { meta: input.meta } : {})
});

type RelayStatusInput = Partial<Omit<RelayStatus, "health">> & {
  health?: Partial<RelayStatus["health"]>;
};

const makeRelayStatus = (overrides: RelayStatusInput = {}): RelayStatus => {
  const defaultHealth: RelayStatus["health"] = {
    ok: true,
    reason: "ok",
    extensionConnected: false,
    extensionHandshakeComplete: true,
    cdpConnected: false,
    annotationConnected: false,
    opsConnected: true,
    opsOwnedTargetCount: 0,
    canvasConnected: false,
    pairingRequired: false
  };

  return {
    running: true,
    extensionConnected: false,
    extensionHandshakeComplete: true,
    annotationConnected: false,
    opsConnected: true,
    opsOwnedTargetCount: 0,
    canvasConnected: false,
    cdpConnected: false,
    pairingRequired: false,
    instanceId: "relay-test-instance",
    epoch: 1,
    ...overrides,
    health: {
      ...defaultHealth,
      ...overrides.health
    }
  };
};

const makeHandle = (options: {
  session?: Partial<InspectorStatus>;
  targets?: Partial<InspectorTargets>;
  trace?: InspectorTraceFixture;
} = {}) => {
  const session: InspectorStatus = {
    sessionId: "session-1",
    mode: "managed",
    activeTargetId: "target-1",
    url: "https://session.example",
    title: "Session Title",
    meta: {
      blockerState: "clear",
      dialog: { open: false }
    },
    ...options.session
  } as InspectorStatus;

  const targets: InspectorTargets = {
    activeTargetId: "target-1",
    targets: [
      {
        targetId: "target-1",
        type: "page",
        title: "Session Title",
        url: "https://session.example"
      }
    ],
    ...options.targets
  } as InspectorTargets;

  const trace = options.trace ?? makeTrace();

  const handle: SessionInspectorHandle = {
    status: vi.fn(async () => session),
    listTargets: vi.fn(async (_sessionId: string, includeUrls = false) => {
      if (includeUrls) {
        return targets;
      }
      return {
        ...targets,
        targets: targets.targets.map((target) => {
          const redacted = { ...target };
          delete (redacted as { url?: string }).url;
          return redacted;
        })
      };
    }),
    consolePoll: vi.fn(async () => ({ events: [], nextSeq: 0 })),
    networkPoll: vi.fn(async () => ({ events: [], nextSeq: 0 })),
    debugTraceSnapshot: vi.fn(async () => trace as InspectorTrace)
  };

  return { handle, session, targets, trace };
};

const observation: DesktopObservationEnvelope = {
  observationId: "observation-1",
  requestedAt: "2026-04-15T00:00:00.000Z",
  status: {
    platform: "darwin",
    permissionLevel: "observe",
    available: true,
    capabilities: ["observe.screen"],
    auditArtifactsDir: "/tmp/desktop-audit"
  }
};

const review: BrowserVerificationEnvelope = {
  observationId: "observation-1",
  verifiedAt: "2026-04-15T00:00:01.000Z",
  review: {
    sessionId: "session-1",
    targetId: "target-1",
    mode: "managed",
    snapshotId: "snapshot-1",
    content: "review content",
    truncated: false,
    refCount: 1,
    timingMs: 5
  }
};

const makeChallengePlan = (overrides: Partial<ChallengeInspectPlan> = {}): ChallengeInspectPlan => ({
  classification: "auth_required",
  authState: "credentials_required",
  summary: "Authentication challenge detected.",
  mode: "browser_with_helper",
  source: "config",
  helperEligibility: { allowed: true, reason: "Helper remains eligible." },
  yield: { required: false, reason: "none" },
  decision: {
    lane: "generic_browser_autonomy",
    rationale: "Use bounded browser actions.",
    attemptBudget: 1,
    noProgressLimit: 1,
    verificationLevel: "full",
    stopConditions: [],
    allowedActionFamilies: ["verification"]
  },
  allowedActionFamilies: ["verification"],
  forbiddenActionFamilies: [],
  governedLanes: [],
  capabilityMatrix: {
    canNavigateToAuth: false,
    canReuseExistingSession: false,
    canReuseCookies: false,
    canFillNonSecretFields: false,
    canExploreClicks: false,
    canUseOwnedEnvironmentFixture: false,
    canUseSanctionedIdentity: false,
    canUseServiceAdapter: false,
    canUseComputerUseBridge: true,
    helperEligibility: { allowed: true, reason: "Helper remains eligible." },
    mustYield: false,
    mustDefer: false
  },
  helper: {
    status: "suggested",
    reason: "Helper returned bounded browser actions.",
    suggestedSteps: []
  },
  suggestedSteps: [],
  evidence: {
    blockerState: "active",
    loginRefs: [],
    sessionReuseRefs: [],
    humanVerificationRefs: [],
    checkpointRefs: []
  },
  ...overrides
});

describe("inspectSession", () => {
  it("aggregates console and network summaries into a warning result", async () => {
    const { handle } = makeHandle({
      trace: {
        requestId: "trace-1",
        generatedAt: "2026-04-03T20:00:00.000Z",
        page: {
          url: "https://trace.example/path",
          title: "Trace Title"
        },
        channels: {
          console: {
            events: [
              { level: "error", text: " boom " },
              { type: "warning", message: " heads up " },
              { level: "info", value: " from value " },
              { level: "log" }
            ],
            nextSeq: 8,
            truncated: true
          },
          network: {
            events: [
              { status: 500, method: "GET", url: "https://trace.example/fail-1" },
              { status: 200, method: "POST", url: "https://trace.example/ok" },
              { errorText: "timeout", method: "PUT", url: "https://trace.example/fail-2" },
              { error: "dns" }
            ],
            nextSeq: 9,
            truncated: false
          }
        },
        meta: {
          blockerState: "clear"
        }
      } as InspectorTrace
    });

    const relayStatus = makeRelayStatus({ port: 8787 });
    const result = await inspectSession(handle, {
      sessionId: "session-1",
      max: 10,
      relayStatus
    });

    expect(handle.listTargets).toHaveBeenCalledWith("session-1", false);
    expect(handle.debugTraceSnapshot).toHaveBeenCalledWith("session-1", {
      sinceConsoleSeq: undefined,
      sinceNetworkSeq: undefined,
      sinceExceptionSeq: undefined,
      max: 10,
      requestId: undefined
    });
    expect(result.relay).toMatchObject({
      running: true,
      port: 8787,
      health: { ok: true }
    });
    expect(result.console).toEqual({
      eventCount: 4,
      nextSeq: 8,
      truncated: true,
      errorCount: 1,
      warningCount: 1,
      latest: [
        { level: "info", message: "from value" },
        { level: "warning", message: "heads up" },
        { level: "error", message: "boom" }
      ]
    });
    expect(result.network).toEqual({
      eventCount: 4,
      nextSeq: 9,
      truncated: false,
      failureCount: 3,
      latestFailures: [
        { error: "dns" },
        { error: "timeout", method: "PUT", url: "https://trace.example/[redacted]" },
        { status: 500, method: "GET", url: "https://trace.example/[redacted]" }
      ]
    });
    expect(result.proofArtifact).toEqual({
      source: "debug_trace_snapshot",
      requestId: "trace-1",
      generatedAt: "2026-04-03T20:00:00.000Z",
      blockerState: "clear",
      url: "https://trace.example/[redacted]",
      title: "Trace Title"
    });
    expect(result.healthState).toBe("warning");
    expect(result.suggestedNextAction).toBe(
      "Inspect the summarized trace failures, fix the page instability, then rerun snapshot or review."
    );
  });

  it("falls back to session metadata and defaults when trace metadata is incomplete", async () => {
    const { handle, session } = makeHandle({
      session: {
        meta: {
          blockerState: "resolving",
          dialog: { open: false }
        }
      },
      trace: {
        channels: {},
        meta: {},
        page: {
          url: "",
          title: ""
        }
      } as InspectorTrace
    });

    const result = await inspectSession(handle, {
      sessionId: "session-2",
      includeUrls: false,
      requestId: "fallback-req"
    });

    expect(handle.listTargets).toHaveBeenCalledWith("session-2", false);
    expect(handle.debugTraceSnapshot).toHaveBeenCalledWith("session-2", {
      sinceConsoleSeq: undefined,
      sinceNetworkSeq: undefined,
      sinceExceptionSeq: undefined,
      max: 25,
      requestId: "fallback-req"
    });
    expect(result.relay).toBeNull();
    expect(result.console).toEqual({
      eventCount: 0,
      nextSeq: null,
      truncated: false,
      errorCount: 0,
      warningCount: 0,
      latest: []
    });
    expect(result.network).toEqual({
      eventCount: 0,
      nextSeq: null,
      truncated: false,
      failureCount: 0,
      latestFailures: []
    });
    expect(result.proofArtifact).toEqual({
      source: "debug_trace_snapshot",
      requestId: "fallback-req",
      generatedAt: null,
      blockerState: "resolving",
      url: "https://session.example/[redacted]",
      title: session.title
    });
    expect(result.healthState).toBe("ok");
    expect(result.suggestedNextAction).toBe(
      "Capture snapshot or review and continue the normal snapshot -> action -> snapshot loop."
    );
  });

  it("summarizes sanitized session capability diagnostics", async () => {
    const { handle } = makeHandle({
      session: {
        mode: "cdpConnect",
        diagnostics: {
          authProvenance: {
            googleAuthIntent: "none",
            profileSource: "cdp_connected_profile",
            profile: {
              profileId: "pinterest-work",
              displayName: "Pinterest Work",
              kind: "explicit_cdp_profile",
              scope: "explicit_local_cdp",
              browserFamily: "chromium",
              persistent: true,
              headless: false,
              authCapability: "explicit_cdp_profile",
              authProof: "profile_declared",
              pathHash: "abc123",
              endpoint: { host: "127.0.0.1", port: 9222 },
              lease: {
                acquiredAt: "2026-07-04T00:00:00.000Z",
                lastSeenAt: "2026-07-04T00:00:01.000Z",
                active: true
              }
            },
            cookieBootstrap: {
              attempted: true,
              disabled: false,
              importedCount: 2,
              rejectedCount: 1,
              skippedGoogleSensitiveCount: 3,
              googleSensitiveCookiePolicy: "skip",
              sourceBrowserName: "Chrome"
            }
          }
        }
      },
      targets: {
        activeTargetId: "target-1",
        targets: [
          { targetId: "target-1", type: "page", title: "Root" },
          {
            targetId: "target-2",
            type: "page",
            title: "Account chooser",
            openerTargetId: "target-1",
            ownershipSource: "action_sync",
            popupKind: "oauth_or_account_chooser",
            safeUrlSummary: {
              scheme: "https",
              host: "accounts.example.com",
              origin: "https://accounts.example.com"
            }
          }
        ]
      }
    });

    const result = await inspectSession(handle, {
      sessionId: "session-capabilities",
      relayStatus: makeRelayStatus({
        extensionConnected: false,
        opsConnected: false,
        cdpConnected: true
      })
    });

    expect(result.capabilities.transport).toEqual({
      mode: "cdpConnect",
      boundary: "explicit_local_cdp",
      extensionRelay: false,
      opsRelay: false,
      relayCdp: true,
      directCdp: true,
      managed: false,
      liveActiveTabReuse: "extension_ops_required"
    });
    expect(result.capabilities.profile).toMatchObject({
      source: "cdp_connected_profile",
      kind: "explicit_cdp_profile",
      scope: "explicit_local_cdp",
      persistent: true,
      headless: false,
      authCapability: "explicit_cdp_profile",
      authProof: "profile_declared",
      leaseActive: true,
      pathHashPresent: true
    });
    expect(result.capabilities.auth).toMatchObject({
      googleUserOwnedAuth: "extension_ops_required",
      cookieContinuityIsLoginProof: false,
      providerVerified: false,
      explicitCookieImportAttempted: false
    });
    expect(result.capabilities.browserPrimitives.popupOwnershipMetadata).toBe("observed");
    expect(JSON.stringify(result.capabilities)).not.toContain("/Users/");
    expect(JSON.stringify(result.capabilities)).not.toContain("wsEndpoint");
  });

  it("normalizes unsupported blocker-state strings to clear", async () => {
    const { handle } = makeHandle({
      session: {
        meta: {
          blockerState: "resolving",
          dialog: { open: false }
        }
      },
      trace: makeTrace({
        requestId: "",
        generatedAt: "",
        meta: {
          blockerState: "unknown"
        },
        page: {}
      })
    });

    const result = await inspectSession(handle, {
      sessionId: "session-invalid-blocker"
    });

    expect(result.proofArtifact.blockerState).toBe("clear");
    expect(result.healthState).toBe("ok");
  });

  it("omits proof url and title when neither trace nor session provides them", async () => {
    const { handle } = makeHandle({
      session: {
        url: undefined,
        title: undefined,
        meta: undefined
      },
      trace: makeTrace({
        requestId: "",
        generatedAt: "",
        channels: {
          console: {
            events: [{ message: "plain message" }],
            nextSeq: 1
          }
        },
        meta: {},
        page: {
          url: "",
          title: ""
        }
      })
    });

    const result = await inspectSession(handle, {
      sessionId: "session-no-proof-fields"
    });

    expect(result.proofArtifact).toEqual({
      source: "debug_trace_snapshot",
      requestId: null,
      generatedAt: null,
      blockerState: "clear"
    });
    expect(result.console.latest).toEqual([{ level: "log", message: "plain message" }]);
    expect(result.healthState).toBe("ok");
  });

  it("redacts raw trace URLs from default proof, network, target, and exception summaries", async () => {
    const { handle } = makeHandle({
      session: {
        url: "https://app.example.com/private/inbox?token=session-secret"
      },
      targets: {
        activeTargetId: "target-1",
        targets: [
          {
            targetId: "target-1",
            type: "page",
            title: "Private App",
            url: "https://app.example.com/private/inbox?target=secret"
          }
        ]
      },
      trace: makeTrace({
        page: {
          url: "https://app.example.com/private/inbox?token=trace-secret",
          title: "Private App"
        },
        channels: {
          console: {
            events: [
              {
                level: "error",
                text: "Navigation failed at https://app.example.com/private/inbox?token=console-secret token=raw-console-secret"
              }
            ],
            nextSeq: 1,
            truncated: false
          },
          network: {
            events: [
              {
                error: "blocked token=network-error-secret",
                method: "GET",
                url: "https://api.example.com/v1/accounts/user-123?access_token=network-secret"
              }
            ] as unknown as InspectorTrace["channels"]["network"]["events"]
          },
          exception: {
            events: [
              {
                message: "OAuth callback failed",
                sourceUrl: "https://accounts.example.com/oauth/callback?code=oauth-secret",
                lineNumber: 2
              }
            ] as unknown as InspectorTrace["channels"]["exception"]["events"]
          }
        }
      })
    });

    const result = await inspectSession(handle, {
      sessionId: "session-redacted-default"
    });
    const serialized = JSON.stringify(result);

    expect(handle.listTargets).toHaveBeenCalledWith("session-redacted-default", false);
    expect(result.targets.items[0]).not.toHaveProperty("url");
    expect(result.proofArtifact.url).toBe("https://app.example.com/[redacted]");
    expect(result.console.latest[0]?.message).toBe("Navigation failed at https://app.example.com/[redacted] token=[REDACTED]");
    expect(result.network.latestFailures[0]?.url).toBe("https://api.example.com/[redacted]");
    expect(result.network.latestFailures[0]?.error).toBe("blocked token=[REDACTED]");
    expect(result.exception.latest[0]?.url).toBe("https://accounts.example.com/[redacted]");
    expect(serialized).not.toContain("trace-secret");
    expect(serialized).not.toContain("console-secret");
    expect(serialized).not.toContain("raw-console-secret");
    expect(serialized).not.toContain("network-secret");
    expect(serialized).not.toContain("network-error-secret");
    expect(serialized).not.toContain("oauth-secret");
    expect(serialized).not.toContain("/private/inbox");
    expect(serialized).not.toContain("/oauth/callback");
  });

  it("redacts raw target URLs even when includeUrls requests target details", async () => {
    const { handle } = makeHandle({
      targets: {
        activeTargetId: "target-1",
        targets: [
          {
            targetId: "target-1",
            type: "page",
            title: "Private App",
            url: "https://app.example.com/private/inbox?token=target-secret"
          }
        ]
      }
    });

    const result = await inspectSession(handle, {
      sessionId: "session-redacted-targets",
      includeUrls: true
    });
    const serialized = JSON.stringify(result);

    expect(handle.listTargets).toHaveBeenCalledWith("session-redacted-targets", true);
    expect(result.targets.items[0]).not.toHaveProperty("url");
    expect(result.targets.items[0]?.safeUrlSummary).toEqual({
      scheme: "https",
      host: "app.example.com",
      origin: "https://app.example.com"
    });
    expect(serialized).not.toContain("target-secret");
    expect(serialized).not.toContain("/private/inbox");
  });

  it("treats an open dialog as blocked before warning-level trace noise", async () => {
    const { handle } = makeHandle({
      session: {
        meta: {
          blockerState: "clear",
          dialog: { open: true }
        }
      },
      trace: {
        channels: {
          console: {
            events: [{ level: "error", text: "still blocked" }],
            nextSeq: 1,
            truncated: false
          }
        },
        meta: {
          blockerState: "clear"
        },
        page: {}
      } as InspectorTrace
    });

    const result = await inspectSession(handle, {
      sessionId: "session-3",
      relayStatus: makeRelayStatus({
        health: {
          ok: false,
          reason: "discovery_unavailable",
          detail: "Reconnect relay"
        }
      })
    });

    expect(result.healthState).toBe("blocked");
    expect(result.suggestedNextAction).toBe(
      "Handle the open dialog before continuing any page interaction."
    );
  });

  it.each([
    {
      name: "extension handshake incomplete",
      handleOptions: {
        session: { mode: "extension" }
      },
      relayStatus: makeRelayStatus({
        extensionConnected: true,
        extensionHandshakeComplete: false
      }),
      expected: "Re-establish a clean daemon-extension handshake: open the extension popup, click Connect again, confirm `status --daemon` shows ext=on and handshake=on, then retry the next page action."
    },
    {
      name: "active blocker",
      handleOptions: {
        session: {
          meta: {
            blockerState: "active",
            dialog: { open: false }
          }
        }
      },
      relayStatus: null,
      expected: "Resolve the active blocker or challenge before issuing more page actions."
    },
    {
      name: "missing active target",
      handleOptions: {
        targets: {
          activeTargetId: null,
          targets: []
        }
      },
      relayStatus: null,
      expected: "Create or select a target before continuing the next automation step."
    }
  ] satisfies Array<{
    name: string;
    handleOptions: Parameters<typeof makeHandle>[0];
    relayStatus: RelayStatus | null;
    expected: string;
  }>)("marks the session blocked for $name", async ({ handleOptions, relayStatus, expected }) => {
    const { handle } = makeHandle(handleOptions);
    const result = await inspectSession(handle, {
      sessionId: "session-4",
      ...(relayStatus ? { relayStatus } : {})
    });

    expect(result.healthState).toBe("blocked");
    expect(result.suggestedNextAction).toBe(expected);
  });

  it("returns a relay-health warning without blocking when the trace is otherwise clean", async () => {
    const { handle } = makeHandle();
    const result = await inspectSession(handle, {
      sessionId: "session-5",
      relayStatus: makeRelayStatus({
        health: {
          ok: false,
          reason: "extension_disconnected",
          detail: "Wait for relay health to recover"
        }
      })
    });

    expect(result.relay).toMatchObject({
      running: true,
      health: {
        ok: false,
        reason: "extension_disconnected",
        detail: "Wait for relay health to recover"
      }
    });
    expect("port" in (result.relay ?? {})).toBe(false);
    expect(result.healthState).toBe("warning");
    expect(result.suggestedNextAction).toBe(
      "Capture snapshot or review and continue the normal snapshot -> action -> snapshot loop."
    );
  });

  it("ignores unrelated extension handshake drift for managed sessions", async () => {
    const { handle } = makeHandle({
      session: {
        mode: "managed"
      }
    });

    const result = await inspectSession(handle, {
      sessionId: "session-5-managed",
      relayStatus: makeRelayStatus({
        extensionConnected: true,
        extensionHandshakeComplete: false
      })
    });

    expect(result.healthState).toBe("ok");
    expect(result.suggestedNextAction).toBe(
      "Capture snapshot or review and continue the normal snapshot -> action -> snapshot loop."
    );
  });

  it("redacts empty, about, non-http, and invalid inspector URLs", async () => {
    const { handle } = makeHandle({
      session: {
        url: ""
      },
      trace: makeTrace({
        channels: {
          exception: {
            events: [
              {
                message: "Blank page exception",
                sourceUrl: "about:blank"
              },
              {
                message: "Srcdoc exception",
                sourceUrl: "about:srcdoc"
              },
              {
                message: "File URL exception",
                sourceUrl: "file:///Users/alice/secret-profile/app.js"
              },
              {
                message: "Malformed URL exception",
                sourceUrl: "not a url"
              }
            ],
            nextSeq: 12,
            truncated: false
          }
        },
        meta: {
          blockerState: "clear"
        },
        page: {}
      })
    });

    const result = await inspectSession(handle, {
      sessionId: "session-redacted-url-variants"
    });

    expect(result.session).not.toHaveProperty("url");
    expect(result.exception.eventCount).toBe(4);
    expect(result.exception.latest).toEqual([
      {
        message: "Malformed URL exception",
        url: "[invalid-url]"
      },
      {
        message: "File URL exception",
        url: "file:[redacted]"
      },
      {
        message: "Srcdoc exception",
        url: "about:[redacted]"
      }
    ]);
    expect(JSON.stringify(result)).not.toContain("/Users/alice");
    expect(JSON.stringify(result)).not.toContain("secret-profile");
  });

  it("summarizes exception events and treats them as warning-level trace instability", async () => {
    const { handle } = makeHandle({
      trace: makeTrace({
        channels: {
          exception: {
            events: [
              {
                message: "ReferenceError: missingWidget is not defined",
                sourceUrl: "https://example.com/app.js",
                lineNumber: 17,
                columnNumber: 4
              },
              {
                text: "Unhandled promise rejection"
              }
            ],
            nextSeq: 11,
            truncated: true
          }
        },
        meta: {
          blockerState: "clear"
        },
        page: {}
      })
    });

    const result = await inspectSession(handle, {
      sessionId: "session-exception"
    });

    expect(result.exception).toEqual({
      eventCount: 2,
      nextSeq: 11,
      truncated: true,
      latest: [
        { message: "Unhandled promise rejection" },
        {
          message: "ReferenceError: missingWidget is not defined",
          url: "https://example.com/[redacted]",
          line: 17,
          column: 4
        }
      ]
    });
    expect(result.healthState).toBe("warning");
    expect(result.suggestedNextAction).toBe(
      "Inspect the summarized trace failures, fix the page instability, then rerun snapshot or review."
    );
  });

  it("drops empty exception payloads and falls back to a default message when only location data is present", async () => {
    const { handle } = makeHandle({
      trace: {
        channels: {
          exception: {
            events: [
              {},
              {
                sourceURL: "https://example.com/app.js"
              }
            ],
            nextSeq: 4,
            truncated: false
          }
        },
        meta: {
          blockerState: "clear"
        },
        page: {}
      } as InspectorTrace
    });

    const result = await inspectSession(handle, {
      sessionId: "session-exception-fallback"
    });

    expect(result.exception).toEqual({
      eventCount: 2,
      nextSeq: 4,
      truncated: false,
      latest: [
        {
          message: "Unhandled exception",
          url: "https://example.com/[redacted]"
        }
      ]
    });
  });
});

describe("buildCorrelatedAuditBundle", () => {
  it("uses an explicit requestId and omits optional bundle fields when they are absent", async () => {
    const { handle } = makeHandle({
      trace: {
        channels: {},
        meta: {},
        page: {}
      } as InspectorTrace
    });

    const result = await buildCorrelatedAuditBundle({
      handle,
      browserSessionId: "session-1",
      observation,
      review,
      challengePlan: makeChallengePlan(),
      requestId: "manual-request-id"
    });

    expect(result.requestId).toBe("manual-request-id");
    expect(result).not.toHaveProperty("targetId");
    expect(result).not.toHaveProperty("challengeId");
  });

  it("prefers proof-artifact request ids and preserves target and challenge ids when present", async () => {
    const { handle } = makeHandle({
      trace: {
        requestId: "trace-request-id",
        channels: {},
        meta: {},
        page: {}
      } as InspectorTrace
    });

    const result = await buildCorrelatedAuditBundle({
      handle,
      browserSessionId: "session-1",
      targetId: "target-1",
      observation,
      review,
      challengePlan: makeChallengePlan({
        challengeId: "challenge-1"
      })
    });

    expect(result.requestId).toBe("trace-request-id");
    expect(result.targetId).toBe("target-1");
    expect(result.challengeId).toBe("challenge-1");
  });

  it("falls back to the explicit requestId when the proof artifact omits one", async () => {
    const { handle } = makeHandle({
      trace: {
        channels: {},
        meta: {},
        page: {}
      } as InspectorTrace
    });

    const result = await buildCorrelatedAuditBundle({
      handle,
      browserSessionId: "session-1",
      observation,
      review,
      challengePlan: makeChallengePlan(),
      requestId: "manual-fallback-id"
    });

    expect(result.requestId).toBe("manual-fallback-id");
  });

  it("generates a bundle requestId when trace and caller ids are absent", async () => {
    const { handle } = makeHandle({
      trace: {
        channels: {},
        meta: {},
        page: {}
      } as InspectorTrace
    });

    const result = await buildCorrelatedAuditBundle({
      handle,
      browserSessionId: "session-1",
      observation,
      review,
      challengePlan: makeChallengePlan()
    });

    expect(result.requestId).toEqual(expect.any(String));
    expect(result.requestId).not.toBe("");
  });
});
