import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigStore, resolveConfig } from "../src/config";
import { PRODUCT_VIDEO_BRIEF_HELPER_PATH } from "../src/providers/workflow-handoff";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

const parse = (value: string): Record<string, unknown> => JSON.parse(value) as Record<string, unknown>;

const makeDeps = () => {
  const manager = {
    launch: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
    cookieImport: vi.fn().mockResolvedValue({ imported: 1, rejected: [] }),
    cookieList: vi.fn().mockResolvedValue({
      count: 1,
      cookies: [{ name: "sid" }]
    }),
    goto: vi.fn().mockResolvedValue({ ok: true }),
    waitForLoad: vi.fn().mockResolvedValue(undefined),
    snapshot: vi.fn().mockResolvedValue({
      content: "snapshot content",
      refCount: 1,
      warnings: []
    }),
    clonePage: vi.fn().mockResolvedValue({
      component: "<section>clone</section>",
      css: ".hero{display:block;}",
      warnings: []
    }),
    clonePageHtmlWithOptions: vi.fn().mockResolvedValue({ html: "<html><body>clone</body></html>" }),
    screenshot: vi.fn().mockResolvedValue({ base64: Buffer.from([1, 2, 3]).toString("base64") }),
    setSessionChallengeAutomationMode: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined)
  };

  const providerRuntime = {
    search: vi.fn(async (input: { query: string }, options?: { source?: string; providerIds?: string[] }) => {
      const source = options?.source ?? "web";
      const providerId = options?.providerIds?.[0] ?? `${source}/default`;
      const price = providerId.includes("others") ? 10 : 20;
      const timestamp = new Date().toISOString();
      return {
        ok: true,
        records: [{
          id: `${providerId}-record`,
          source,
          provider: providerId,
          url: `https://example.com/${providerId}`,
          title: `${input.query} ${providerId}`,
          content: `$${price}`,
          timestamp,
          confidence: 0.8,
          attributes: {
            shopping_offer: {
              provider: providerId,
              product_id: `${providerId}-product`,
              title: `${input.query} ${providerId}`,
              url: `https://example.com/${providerId}`,
              price: { amount: price, currency: "USD", retrieved_at: timestamp },
              shipping: { amount: 0, currency: "USD", notes: "free" },
              availability: "in_stock",
              rating: 4.5,
              reviews_count: 2
            }
          }
        }],
        trace: { requestId: "req", ts: "2026-02-16T00:00:00.000Z" },
        partial: false,
        failures: [],
        metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
        sourceSelection: source,
        providerOrder: [providerId]
      };
    }),
    fetch: vi.fn(async () => ({
      ok: true,
      records: [{
        id: "product-record",
        source: "shopping",
        provider: "shopping/amazon",
        url: "https://example.com/product",
        title: "Product",
        content: "Feature one. Feature two.",
        timestamp: "2026-02-16T00:00:00.000Z",
        confidence: 0.9,
        attributes: {
          links: [],
          shopping_offer: {
            provider: "shopping/amazon",
            product_id: "p1",
            title: "Product",
            url: "https://example.com/product",
            price: { amount: 29.99, currency: "USD", retrieved_at: "2026-02-16T00:00:00.000Z" },
            shipping: { amount: 0, currency: "USD", notes: "free" },
            availability: "in_stock",
            rating: 4.3,
            reviews_count: 20
          }
        }
      }],
      trace: { requestId: "req", ts: "2026-02-16T00:00:00.000Z" },
      partial: false,
      failures: [],
      metrics: { attempted: 1, succeeded: 1, failed: 0, retries: 0, latencyMs: 1 },
      sourceSelection: "shopping",
      providerOrder: ["shopping/amazon"]
    }))
  };

  const baseConfig = resolveConfig({});
  const config = new ConfigStore({ ...baseConfig, relayToken: false });

  return {
    manager,
    annotationManager: {} as never,
    runner: {} as never,
    config,
    skills: {} as never,
    providerRuntime
  };
};

describe("workflow tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes research and shopping workflow tools", async () => {
    const deps = makeDeps();
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const { createShoppingRunTool } = await import("../src/tools/shopping_run");

    const researchTool = createResearchRunTool(deps as never);
    const shoppingTool = createShoppingRunTool(deps as never);

    const research = parse(await researchTool.execute({
      topic: "automation",
      mode: "compact",
      sourceSelection: "auto",
      days: 30
    } as never));

    expect(research.ok).toBe(true);
    expect(research.followthroughSummary).toContain("ranked records");
    expect(research.suggestedNextAction).toContain("artifact path");
    expect(research.suggestedNextAction).toContain("npx opendevbrowser research run");
    expect(research.suggestedSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringContaining("support") }),
        expect.objectContaining({
          reason: expect.stringContaining("narrower timebox"),
          command: expect.stringContaining("npx opendevbrowser research run")
        })
      ])
    );
    expect(research.meta).toEqual(expect.objectContaining({
      followthroughSummary: expect.stringContaining("publishable claim")
    }));
    expect((research.meta as { selection: { resolved_sources: string[] } }).selection.resolved_sources).toEqual([
      "web",
      "community",
      "social"
    ]);

    const shopping = parse(await shoppingTool.execute({
      query: "usb microphone",
      providers: ["shopping/amazon", "shopping/others"],
      mode: "json",
      sort: "lowest_price"
    } as never));

    expect(shopping.ok).toBe(true);
    expect(shopping.followthroughSummary).toContain("offer set");
    expect(shopping.suggestedNextAction).toContain("offerFilterDiagnostics");
    expect(shopping.suggestedNextAction).toContain("npx opendevbrowser shopping run");
    expect(shopping.suggestedSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringContaining("filters") }),
        expect.objectContaining({
          reason: expect.stringContaining("updated budget and region"),
          command: expect.stringContaining("npx opendevbrowser shopping run")
        })
      ])
    );
    expect(shopping.meta).toEqual(expect.objectContaining({
      followthroughSummary: expect.stringContaining("strong deal")
    }));
    const offers = shopping.offers as Array<{ provider: string; price: { amount: number } }>;
    expect(offers[0]?.price.amount).toBeLessThanOrEqual(offers[1]?.price.amount);
  });

  it("executes product-video tool and captures screenshots through manager", async () => {
    const deps = makeDeps();
    const { createProductVideoRunTool } = await import("../src/tools/product_video_run");
    const tool = createProductVideoRunTool(deps as never);

    const response = parse(await tool.execute({
      product_url: "https://example.com/product",
      include_screenshots: true,
      include_all_images: false,
      timeoutMs: 9876
    } as never));

    expect(response.ok).toBe(true);
    expect(response.path).toEqual(expect.any(String));
    expect(response.followthroughSummary).toContain("asset pack");
    expect(response.suggestedNextAction).toContain(PRODUCT_VIDEO_BRIEF_HELPER_PATH);
    expect(response.suggestedSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringContaining("metadata-first") }),
        expect.objectContaining({
          reason: expect.stringContaining("adjusted provider or media flags"),
          command: expect.stringContaining("npx opendevbrowser product-video run")
        })
      ])
    );
    expect((response.suggestedSteps as Array<{ command?: string }>)[1]?.command).toBe(
      `${PRODUCT_VIDEO_BRIEF_HELPER_PATH} <pack>/manifest.json`
    );
    expect((response.suggestedSteps as Array<{ command?: string }>)[2]?.command).toContain(
      "npx opendevbrowser product-video run"
    );
    expect(response.meta).toEqual(expect.objectContaining({
      followthroughSummary: expect.stringContaining("visual-ready")
    }));
    expect(deps.manager.launch).toHaveBeenCalledTimes(1);
    expect(deps.manager.screenshot).toHaveBeenCalledTimes(1);
    expect(deps.manager.disconnect).toHaveBeenCalledTimes(1);
    expect(deps.providerRuntime.fetch).toHaveBeenCalledWith(
      { url: "https://example.com/product" },
      expect.objectContaining({ timeoutMs: 9876 })
    );
  });

  it("executes inspiredesign tool with default capture-mode off when no urls are supplied", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      mode: "json"
    } as never));

    expect(response.ok).toBe(true);
    expect(response.suggestedNextAction).toContain("canvas.plan.set");
    expect(response.followthroughSummary).toContain("canvas-plan.request.json");
    expect(response.meta).toEqual(expect.objectContaining({
      followthroughSummary: expect.stringContaining("OpenDevBrowser Canvas")
    }));
    expect(deps.manager.launch).not.toHaveBeenCalled();
    expect(deps.providerRuntime.fetch).not.toHaveBeenCalled();
  });

  it("forces inspiredesign deep capture through browser manager helpers when urls are supplied", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      urls: ["https://example.com/reference"],
      mode: "compact",
      timeoutMs: 45000
    } as never));

    expect(response.ok).toBe(true);
    expect(deps.manager.launch).toHaveBeenCalledTimes(1);
    expect(deps.manager.goto).toHaveBeenCalledWith(
      "session-1",
      "https://example.com/reference",
      "load",
      expect.any(Number)
    );
    expect(deps.manager.goto.mock.calls[0]?.[3]).toBeGreaterThan(0);
    expect(deps.manager.goto.mock.calls[0]?.[3]).toBeLessThanOrEqual(30000);
    expect(deps.manager.waitForLoad).toHaveBeenCalledTimes(1);
    expect(deps.manager.snapshot).toHaveBeenCalledTimes(1);
    expect(deps.manager.clonePage).toHaveBeenCalledTimes(1);
    expect(deps.manager.clonePageHtmlWithOptions).toHaveBeenCalledTimes(1);
    expect(deps.manager.disconnect).toHaveBeenCalledWith("session-1", true);
  });

  it("keeps inspiredesign deep capture parity with daemon cookie-source imports", async () => {
    const deps = makeDeps();
    const cookieSource = {
      type: "inline" as const,
      value: [{ name: "sid", value: "abc", url: "https://example.com/reference" }]
    };
    deps.config = new ConfigStore({
      ...resolveConfig({}),
      relayToken: false,
      providers: { cookieSource }
    });
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      urls: ["https://example.com/reference"],
      captureMode: "off",
      mode: "compact",
      useCookies: true,
      cookiePolicyOverride: "required",
      challengeAutomationMode: "browser"
    } as never));

    expect(response.ok).toBe(true);
    expect(deps.manager.launch).toHaveBeenCalledTimes(1);
    expect(deps.manager.cookieImport).toHaveBeenCalledWith("session-1", cookieSource.value, false);
    expect(deps.manager.cookieList).toHaveBeenCalledWith("session-1", ["https://example.com/reference"]);
    expect(deps.manager.setSessionChallengeAutomationMode).toHaveBeenCalledWith("session-1", "browser");
  });

  it("defaults inspiredesign tool mode to compact when omitted", async () => {
    const deps = makeDeps();
    const { createInspiredesignRunTool } = await import("../src/tools/inspiredesign_run");
    const tool = createInspiredesignRunTool(deps as never);

    const response = parse(await tool.execute({
      brief: "Design a premium docs website",
      urls: ["https://example.com/reference"]
    } as never));

    expect(response.ok).toBe(true);
    expect(response.mode).toBe("compact");
  });

  it("forwards challengeAutomationMode through workflow tools", async () => {
    const deps = makeDeps();
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const { createShoppingRunTool } = await import("../src/tools/shopping_run");
    const { createProductVideoRunTool } = await import("../src/tools/product_video_run");

    const researchTool = createResearchRunTool(deps as never);
    const shoppingTool = createShoppingRunTool(deps as never);
    const productVideoTool = createProductVideoRunTool(deps as never);

    await researchTool.execute({
      topic: "automation",
      sourceSelection: "web",
      days: 7,
      challengeAutomationMode: "browser_with_helper"
    } as never);
    expect(deps.providerRuntime.search).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          challengeAutomationMode: "browser_with_helper"
        })
      })
    );

    deps.providerRuntime.search.mockClear();
    await shoppingTool.execute({
      query: "usb microphone",
      providers: ["shopping/amazon"],
      challengeAutomationMode: "browser"
    } as never);
    expect(deps.providerRuntime.search).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          challengeAutomationMode: "browser"
        })
      })
    );

    await productVideoTool.execute({
      product_url: "https://example.com/product",
      include_screenshots: false,
      challengeAutomationMode: "off"
    } as never);
    expect(deps.providerRuntime.fetch).toHaveBeenCalledWith(
      { url: "https://example.com/product" },
      expect.objectContaining({
        runtimePolicy: expect.objectContaining({
          challengeAutomationMode: "off"
        })
      })
    );
  });

  it("locks operator surfaces to the canonical challengeAutomationMode enum", async () => {
    const deps = makeDeps();
    const { createStatusCapabilitiesTool } = await import("../src/tools/status_capabilities");
    const { createSessionInspectorPlanTool } = await import("../src/tools/session_inspector_plan");
    const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");

    const operatorTools = [
      createStatusCapabilitiesTool(deps as never),
      createSessionInspectorPlanTool(deps as never),
      createSessionInspectorAuditTool(deps as never)
    ];

    for (const operatorTool of operatorTools) {
      const challengeAutomationMode = operatorTool.args.challengeAutomationMode;
      expect(challengeAutomationMode.safeParse("off").success).toBe(true);
      expect(challengeAutomationMode.safeParse("browser").success).toBe(true);
      expect(challengeAutomationMode.safeParse("browser_with_helper").success).toBe(true);
      expect(challengeAutomationMode.safeParse("invalid").success).toBe(false);
    }
  });

  it("returns structured unavailability errors for operator tools", async () => {
    const deps = makeDeps();
    const { createReviewDesktopTool } = await import("../src/tools/review_desktop");
    const { createStatusCapabilitiesTool } = await import("../src/tools/status_capabilities");
    const { createSessionInspectorPlanTool } = await import("../src/tools/session_inspector_plan");
    const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");

    const review = parse(await createReviewDesktopTool(deps as never).execute({
      sessionId: "session-1"
    } as never));
    const status = parse(await createStatusCapabilitiesTool(deps as never).execute({} as never));
    const plan = parse(await createSessionInspectorPlanTool(deps as never).execute({
      sessionId: "session-1"
    } as never));
    const audit = parse(await createSessionInspectorAuditTool(deps as never).execute({
      sessionId: "session-1"
    } as never));

    expect(review.error).toMatchObject({ code: "automation_coordinator_unavailable" });
    expect(status.error).toMatchObject({ code: "automation_coordinator_unavailable" });
    expect(plan.error).toMatchObject({ code: "automation_coordinator_unavailable" });
    expect(audit.error).toMatchObject({ code: "automation_coordinator_unavailable" });
  });

  it("executes review, status, and inspect-plan operator tools through the coordinator", async () => {
    const deps = makeDeps();
    deps.automationCoordinator = {
      reviewDesktop: vi.fn(async () => ({
        browserSessionId: "session-1",
        observation: { observationId: "obs-1" },
        verification: { observationId: "obs-1" }
      })),
      inspectChallengePlan: vi.fn(async () => ({
        summary: "inspect-plan",
        mode: "browser_with_helper"
      })),
      statusCapabilities: vi.fn(async () => ({
        host: {
          desktopObservation: {
            available: true
          }
        }
      }))
    } as never;
    const { createReviewDesktopTool } = await import("../src/tools/review_desktop");
    const { createStatusCapabilitiesTool } = await import("../src/tools/status_capabilities");
    const { createSessionInspectorPlanTool } = await import("../src/tools/session_inspector_plan");

    const review = parse(await createReviewDesktopTool(deps as never).execute({
      sessionId: "session-1",
      targetId: "target-1"
    } as never));
    const status = parse(await createStatusCapabilitiesTool(deps as never).execute({
      sessionId: "session-1",
      targetId: "target-1"
    } as never));
    const plan = parse(await createSessionInspectorPlanTool(deps as never).execute({
      sessionId: "session-1",
      targetId: "target-1",
      challengeAutomationMode: "browser"
    } as never));

    expect(review.ok).toBe(true);
    expect(status.ok).toBe(true);
    expect(plan.ok).toBe(true);
    expect(deps.automationCoordinator.reviewDesktop).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      reason: undefined,
      maxChars: undefined,
      cursor: undefined
    });
    expect(deps.automationCoordinator.statusCapabilities).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      runMode: undefined
    });
    expect(deps.automationCoordinator.inspectChallengePlan).toHaveBeenCalledWith({
      browserSessionId: "session-1",
      targetId: "target-1",
      runMode: "browser"
    });
  });

  it("reports session-inspector unavailability before composing the audit bundle", async () => {
    const deps = makeDeps();
    deps.automationCoordinator = {
      reviewDesktop: vi.fn(),
      inspectChallengePlan: vi.fn(),
      statusCapabilities: vi.fn()
    } as never;
    const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");

    const audit = parse(await createSessionInspectorAuditTool(deps as never).execute({
      sessionId: "session-1"
    } as never));

    expect(audit.error).toMatchObject({ code: "session_inspector_unavailable" });
    expect(deps.automationCoordinator.reviewDesktop).not.toHaveBeenCalled();
  });

  it("builds correlated audit bundles with and without relay status", async () => {
    const runAudit = async (relayStatus?: Record<string, unknown>) => {
      const deps = makeDeps();
      deps.automationCoordinator = {
        reviewDesktop: vi.fn(async () => ({
          browserSessionId: "session-1",
          observation: {
            observationId: "obs-1",
            requestedAt: "2026-04-15T00:00:00.000Z",
            status: {
              platform: "darwin",
              permissionLevel: "observe",
              available: true,
              capabilities: ["observe.screen"],
              auditArtifactsDir: "/tmp/audit"
            }
          },
          verification: {
            observationId: "obs-1",
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
          }
        })),
        inspectChallengePlan: vi.fn(async () => ({
          challengeId: "challenge-1",
          summary: "inspect-plan",
          mode: "browser_with_helper",
          source: "config",
          helperEligibility: { allowed: true, reason: "helper available" },
          yield: { required: false, reason: "none" },
          decision: {
            lane: "generic_browser_autonomy",
            rationale: "safe",
            attemptBudget: 1,
            noProgressLimit: 1,
            verificationLevel: "full",
            stopConditions: [],
            allowedActionFamilies: ["verification"]
          },
          classification: "auth_required",
          authState: "credentials_required",
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
            helperEligibility: { allowed: true, reason: "helper available" },
            mustYield: false,
            mustDefer: false
          },
          helper: {
            status: "suggested",
            reason: "helper available",
            suggestedSteps: []
          },
          suggestedSteps: [],
          evidence: {
            blockerState: "active",
            loginRefs: [],
            sessionReuseRefs: [],
            humanVerificationRefs: [],
            checkpointRefs: []
          }
        }))
      } as never;
      deps.manager.createSessionInspector = vi.fn(() => ({
        status: vi.fn(async () => ({
          sessionId: "session-1",
          mode: "managed",
          activeTargetId: "target-1",
          url: "https://example.com/session",
          title: "Session",
          meta: { blockerState: "active", dialog: { open: false } }
        })),
        listTargets: vi.fn(async () => ({
          activeTargetId: "target-1",
          targets: [{ targetId: "target-1", type: "page", title: "Session", url: "https://example.com/session" }]
        })),
        debugTraceSnapshot: vi.fn(async () => ({
          channels: {},
          meta: {},
          page: { url: "https://example.com/session", title: "Session" }
        }))
      })) as never;
      deps.relay = relayStatus
        ? {
          refresh: vi.fn(async () => {
            throw new Error("ignored refresh failure");
          }),
          status: vi.fn(() => relayStatus)
        } as never
        : undefined;
      const { createSessionInspectorAuditTool } = await import("../src/tools/session_inspector_audit");
      return parse(await createSessionInspectorAuditTool(deps as never).execute({
        sessionId: "session-1",
        targetId: "target-1",
        challengeAutomationMode: "browser_with_helper"
      } as never));
    };

    const withoutRelay = await runAudit();
    const withRelay = await runAudit({
      running: true,
      extensionConnected: false,
      extensionHandshakeComplete: true,
      annotationConnected: false,
      opsConnected: true,
      canvasConnected: false,
      cdpConnected: false,
      pairingRequired: false,
      health: {
        ok: true,
        challengeState: "clear",
        blockedSessions: [],
        waitingForExtension: false,
        actionable: []
      }
    });

    expect(withoutRelay.ok).toBe(true);
    expect(withRelay.ok).toBe(true);
    expect(withoutRelay.sessionInspector.relay).toBeNull();
    expect(withRelay.sessionInspector.relay).toMatchObject({ running: true, opsConnected: true });
  });

  it("returns structured errors when required workflow input is missing", async () => {
    const deps = makeDeps();
    const { createResearchRunTool } = await import("../src/tools/research_run");
    const tool = createResearchRunTool(deps as never);

    const response = parse(await tool.execute({
      topic: "",
      mode: "compact"
    } as never));

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "research_run_failed"
      }
    });
  });
});
