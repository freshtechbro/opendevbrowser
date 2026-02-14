import { randomUUID } from "crypto";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { Mutex } from "async-mutex";
import type { OpenDevBrowserConfig } from "../config";
import { resolveCachePaths } from "../cache/paths";
import { findChromeExecutable } from "../cache/chrome-locator";
import { downloadChromeForTesting } from "../cache/downloader";
import { createLogger, createRequestId } from "../core/logging";
import { ConsoleTracker } from "../devtools/console-tracker";
import { ExceptionTracker } from "../devtools/exception-tracker";
import { NetworkTracker } from "../devtools/network-tracker";
import { captureDom } from "../export/dom-capture";
import { extractCss } from "../export/css-extract";
import { emitReactComponent, type ReactExport } from "../export/react-emitter";
import { RefStore } from "../snapshot/refs";
import { Snapshotter } from "../snapshot/snapshotter";
import { resolveRelayEndpoint, sanitizeWsEndpoint } from "../relay/relay-endpoints";
import { ensureLocalEndpoint } from "../utils/endpoint-validation";
import { buildBlockerArtifacts, classifyBlockerSignal } from "../providers/blocker";
import type { BlockerSignalV1 } from "../providers/types";
import {
  evaluateTier1Coherence,
  formatTier1Warnings,
  type Tier1CoherenceResult
} from "./fingerprint/tier1-coherence";
import {
  applyTier2NetworkEvent,
  createTier2RuntimeState,
  type Tier2RuntimeState
} from "./fingerprint/tier2-runtime";
import {
  createTier3RuntimeState,
  evaluateTier3Adaptive,
  type Tier3RuntimeState
} from "./fingerprint/tier3-adaptive";
import { SessionStore, type BrowserMode } from "./session-store";
import { TargetManager, type TargetInfo } from "./target-manager";

export type LaunchOptions = {
  profile?: string;
  headless?: boolean;
  startUrl?: string;
  chromePath?: string;
  flags?: string[];
  persistProfile?: boolean;
  // Used by hub/daemon callers to force managed launch when routing through relay.
  noExtension?: boolean;
};

export type ConnectOptions = {
  wsEndpoint?: string;
  host?: string;
  port?: number;
};

export type ManagedSession = {
  sessionId: string;
  mode: BrowserMode;
  browser: Browser;
  context: BrowserContext;
  profileDir: string;
  persistProfile: boolean;
  targets: TargetManager;
  refStore: RefStore;
  snapshotter: Snapshotter;
  consoleTracker: ConsoleTracker;
  exceptionTracker: ExceptionTracker;
  networkTracker: NetworkTracker;
  fingerprint: {
    tier1: Tier1CoherenceResult;
    tier2: Tier2RuntimeState;
    tier3: Tier3RuntimeState;
    lastAppliedNetworkSeq: number;
  };
};

type FingerprintSignalApplyOptions = {
  applyTier2?: boolean;
  applyTier3?: boolean;
  source?: "debug-trace" | "continuous";
};

type CookieImportRecord = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export class BrowserManager {
  private store = new SessionStore();
  private sessions = new Map<string, ManagedSession>();
  private sessionMutexes = new Map<string, Mutex>();
  private networkSignalSubscriptions = new Map<string, () => void>();
  private worktree: string;
  private config: OpenDevBrowserConfig;
  private pageListeners = new WeakMap<Page, () => void>();
  private logger = createLogger("browser-manager");

  constructor(worktree: string, config: OpenDevBrowserConfig) {
    this.worktree = worktree;
    this.config = config;
  }

  private getMutex(sessionId: string): Mutex {
    let mutex = this.sessionMutexes.get(sessionId);
    if (!mutex) {
      mutex = new Mutex();
      this.sessionMutexes.set(sessionId, mutex);
    }
    return mutex;
  }

  updateConfig(config: OpenDevBrowserConfig): void {
    this.config = config;
    for (const managed of this.sessions.values()) {
      managed.consoleTracker.setOptions({ showFullConsole: config.devtools.showFullConsole });
      managed.networkTracker.setOptions({ showFullUrls: config.devtools.showFullUrls });
      managed.fingerprint.tier2.enabled = config.fingerprint.tier2.enabled;
      managed.fingerprint.tier2.mode = config.fingerprint.tier2.mode;
      managed.fingerprint.tier3.enabled = config.fingerprint.tier3.enabled;
      managed.fingerprint.tier3.fallbackTier = config.fingerprint.tier3.fallbackTier;
    }
  }

  async launch(options: LaunchOptions): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string }> {
    const resolvedProfile = options.profile ?? this.config.profile;
    const resolvedHeadless = options.headless ?? this.config.headless;
    const persistProfile = options.persistProfile ?? this.config.persistProfile;

    const cachePaths = await resolveCachePaths(this.worktree, resolvedProfile);
    const executable = await findChromeExecutable(options.chromePath ?? this.config.chromePath);
    const warnings: string[] = [];

    let executablePath = executable;
    if (!executablePath) {
      const download = await downloadChromeForTesting(cachePaths.chromeDir);
      warnings.push("System Chrome not found. Downloaded Chrome for Testing.");
      executablePath = download.executablePath;
    }

    const profileDir = persistProfile
      ? cachePaths.profileDir
      : join(cachePaths.projectRoot, "temp-profiles", randomUUID());

    await mkdir(profileDir, { recursive: true });

    let context: BrowserContext | null = null;

    try {
      context = await chromium.launchPersistentContext(profileDir, {
        headless: resolvedHeadless,
        executablePath: executablePath ?? undefined,
        args: options.flags ?? this.config.flags,
        viewport: null
      });

      const browser = context.browser();
      if (!browser) {
        throw new Error("Browser instance unavailable");
      }
      const sessionId = randomUUID();
      const targets = new TargetManager();
      const pages = context.pages();

      if (pages.length === 0) {
        const page = await context.newPage();
        targets.registerPage(page);
      } else {
        targets.registerExistingPages(pages);
      }

      const activeTargetId = targets.getActiveTargetId();

      if (options.startUrl && activeTargetId) {
        await this.goto(sessionId, options.startUrl, "load", 30000, { browser, context, targets });
      }

      const refStore = new RefStore();
      const snapshotter = new Snapshotter(refStore);
      const consoleTracker = new ConsoleTracker(200, { showFullConsole: this.config.devtools.showFullConsole });
      const exceptionTracker = new ExceptionTracker(200);
      const networkTracker = new NetworkTracker(300, { showFullUrls: this.config.devtools.showFullUrls });
      const fingerprint = this.initializeFingerprintState(
        sessionId,
        resolvedProfile,
        options.flags ?? this.config.flags
      );
      warnings.push(...formatTier1Warnings(fingerprint.tier1));

      const managed: ManagedSession = {
        sessionId,
        mode: "managed",
        browser,
        context,
        profileDir,
        persistProfile,
        targets,
        refStore,
        snapshotter,
        consoleTracker,
        exceptionTracker,
        networkTracker,
        fingerprint
      };

      this.store.add({ id: sessionId, mode: "managed", browser, context });
      this.sessions.set(sessionId, managed);

      this.attachContinuousFingerprintSignals(managed);
      this.attachTrackers(managed);
      this.attachRefInvalidation(managed);

      const wsEndpointProvider = browser as unknown as { wsEndpoint?: () => string };
      const wsEndpoint = typeof wsEndpointProvider.wsEndpoint === "function"
        ? wsEndpointProvider.wsEndpoint()
        : undefined;

      if (!fingerprint.tier1.ok) {
        this.logger.warn("fingerprint.tier1.mismatch", {
          sessionId,
          data: { issues: fingerprint.tier1.issues }
        });
      }

      return { sessionId, mode: "managed", activeTargetId, warnings, wsEndpoint: wsEndpoint || undefined };
    } catch (error) {
      const launchMessage = error instanceof Error ? error.message : "Unknown error";
      const cleanupErrors: unknown[] = [];

      if (context) {
        try {
          await context.close();
        } catch (closeError) {
          cleanupErrors.push(closeError);
        }
      }

      if (!persistProfile) {
        try {
          await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }

      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          `Failed to launch browser context: ${launchMessage}. Cleanup failed.`
        );
      }

      throw new Error(`Failed to launch browser context: ${launchMessage}`, { cause: error });
    }
  }

  async connect(options: ConnectOptions): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string }> {
    const wsEndpoint = await this.resolveWsEndpoint(options);
    return this.connectWithEndpoint(wsEndpoint, "cdpConnect");
  }

  async connectRelay(wsEndpoint: string): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string; leaseId?: string }> {
    ensureLocalEndpoint(wsEndpoint, this.config.security.allowNonLocalCdp);
    const { connectEndpoint, reportedEndpoint } = await this.resolveRelayEndpoints(wsEndpoint);
    return this.connectWithEndpoint(connectEndpoint, "extension", reportedEndpoint);
  }

  async closeAll(): Promise<void> {
    const sessions = Array.from(this.sessions.keys());
    await Promise.allSettled(sessions.map(id => this.disconnect(id, true)));
  }

  async disconnect(sessionId: string, closeBrowser = false): Promise<void> {
    const managed = this.getManaged(sessionId);
    const cleanupErrors: unknown[] = [];

    try {
      for (const entry of managed.targets.listPageEntries()) {
        const cleanup = this.pageListeners.get(entry.page);
        if (cleanup) {
          try {
            cleanup();
          } catch (error) {
            cleanupErrors.push(error);
          }
          this.pageListeners.delete(entry.page);
        }
      }

      try {
        const unsubscribeSignals = this.networkSignalSubscriptions.get(sessionId);
        if (unsubscribeSignals) {
          unsubscribeSignals();
          this.networkSignalSubscriptions.delete(sessionId);
        }
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        const shouldCloseBrowser = closeBrowser || managed.mode !== "managed";
        if (shouldCloseBrowser) {
          if (managed.mode !== "managed") {
            const closePromise = managed.browser.close();
            const result = await Promise.race([
              closePromise.then(() => "closed"),
              delay(5000).then(() => "timeout")
            ]);
            if (result === "timeout") {
              closePromise.catch(() => {});
              console.warn("BrowserManager.disconnect: timed out closing CDP connection; continuing cleanup.");
            }
          } else {
            await managed.browser.close();
          }
        } else {
          await managed.context.close();
        }
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        managed.consoleTracker.detach();
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        managed.exceptionTracker.detach();
      } catch (error) {
        cleanupErrors.push(error);
      }

      try {
        managed.networkTracker.detach();
      } catch (error) {
        cleanupErrors.push(error);
      }

      if (!managed.persistProfile && managed.profileDir) {
        try {
          await rm(managed.profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    } finally {
      this.sessions.delete(sessionId);
      this.sessionMutexes.delete(sessionId);
      this.store.delete(sessionId);
    }

    if (cleanupErrors.length === 1) {
      throw cleanupErrors[0];
    }
    if (cleanupErrors.length > 1) {
      throw new AggregateError(cleanupErrors, "Failed to disconnect browser session.");
    }
  }

  async status(sessionId: string): Promise<{ mode: BrowserMode; activeTargetId: string | null; url?: string; title?: string }> {
    const managed = this.getManaged(sessionId);
    const activeTargetId = managed.targets.getActiveTargetId();
    const page = activeTargetId ? managed.targets.getPage(activeTargetId) : null;
    const title = await this.safePageTitle(page, "BrowserManager.status");
    const url = this.safePageUrl(page, "BrowserManager.status");

    return {
      mode: managed.mode,
      activeTargetId,
      url,
      title
    };
  }

  async withPage<T>(
    sessionId: string,
    targetId: string | null,
    fn: (page: Page) => Promise<T>
  ): Promise<T> {
    const managed = this.getManaged(sessionId);
    const page = targetId ? managed.targets.getPage(targetId) : managed.targets.getActivePage();
    if (managed.mode === "extension") {
      await this.waitForExtensionTargetReady(page, "withPage");
    }
    return await fn(page);
  }

  async listTargets(sessionId: string, includeUrls = false): Promise<{ activeTargetId: string | null; targets: TargetInfo[] }> {
    const managed = this.getManaged(sessionId);
    const targets = await managed.targets.listTargets(includeUrls);
    return {
      activeTargetId: managed.targets.getActiveTargetId(),
      targets
    };
  }

  async page(sessionId: string, name: string, url?: string): Promise<{ targetId: string; created: boolean; url?: string; title?: string }> {
    const managed = this.getManaged(sessionId);
    const existingTargetId = managed.targets.getTargetIdByName(name);
    let targetId = existingTargetId;
    let created = false;

    if (targetId) {
      managed.targets.setActiveTarget(targetId);
    } else {
      if (managed.mode === "extension") {
        try {
          const page = await this.createExtensionPage(managed, "page");
          targetId = managed.targets.registerPage(page, name);
          managed.targets.setActiveTarget(targetId);
          this.attachRefInvalidationForPage(managed, targetId, page);
          created = true;
        } catch (error) {
          if (!this.isDetachedFrameError(error)) {
            throw error;
          }
          const activeTargetId = managed.targets.getActiveTargetId();
          if (!activeTargetId) {
            throw error;
          }
          managed.targets.setName(activeTargetId, name);
          targetId = activeTargetId;
          created = true;
        }
      } else {
        const page = await managed.context.newPage();
        targetId = managed.targets.registerPage(page, name);
        managed.targets.setActiveTarget(targetId);
        this.attachRefInvalidationForPage(managed, targetId, page);
        created = true;
      }
    }

    this.attachTrackers(managed);

    if (url) {
      await this.goto(sessionId, url, "load", 30000);
    }

    const page = managed.targets.getPage(targetId);
    const title = await this.safePageTitle(page, "BrowserManager.page");
    const finalUrl = this.safePageUrl(page, "BrowserManager.page");

    return { targetId, created, url: finalUrl, title };
  }

  async listPages(sessionId: string): Promise<{ pages: Array<{ name: string; targetId: string; url?: string; title?: string }> }> {
    const managed = this.getManaged(sessionId);
    const named = managed.targets.listNamedTargets();
    const pages: Array<{ name: string; targetId: string; url?: string; title?: string }> = [];

    for (const entry of named) {
      const page = managed.targets.getPage(entry.targetId);
      const title = await this.safePageTitle(page, "BrowserManager.listPages");
      const url = this.safePageUrl(page, "BrowserManager.listPages");
      pages.push({ name: entry.name, targetId: entry.targetId, url, title });
    }

    return { pages };
  }

  async closePage(sessionId: string, name: string): Promise<void> {
    const managed = this.getManaged(sessionId);
    const targetId = managed.targets.getTargetIdByName(name);
    if (!targetId) {
      throw new Error(`Unknown page name: ${name}`);
    }
    if (managed.mode === "extension") {
      const entries = managed.targets.listPageEntries();
      if (entries.length <= 1) {
        managed.targets.removeName(name);
        managed.refStore.clearTarget(targetId);
        return;
      }
    }
    await managed.targets.closeTarget(targetId);
    managed.refStore.clearTarget(targetId);
    this.attachTrackers(managed);
  }

  async useTarget(sessionId: string, targetId: string): Promise<{ activeTargetId: string; url?: string; title?: string }> {
    const managed = this.getManaged(sessionId);
    managed.targets.setActiveTarget(targetId);
    this.attachTrackers(managed);

    const page = managed.targets.getPage(targetId);
    const title = await this.safePageTitle(page, "BrowserManager.useTarget");

    return {
      activeTargetId: targetId,
      url: this.safePageUrl(page, "BrowserManager.useTarget"),
      title
    };
  }

  async newTarget(sessionId: string, url?: string): Promise<{ targetId: string }> {
    const managed = this.getManaged(sessionId);
    if (managed.mode === "extension") {
      const previousTargetId = managed.targets.getActiveTargetId();
      let createdTargetId: string | null = null;
      try {
        const page = await this.createExtensionPage(managed, "target-new");
        const targetId = managed.targets.registerPage(page);
        createdTargetId = targetId;
        this.attachRefInvalidationForPage(managed, targetId, page);
        if (url) {
          await this.waitForExtensionTargetReady(page, "target-new");
          try {
            await page.goto(url, { waitUntil: "load" });
          } catch (error) {
            if (!this.isDetachedFrameError(error)) {
              throw error;
            }
            await delay(200);
            await this.waitForExtensionTargetReady(page, "target-new");
            await page.goto(url, { waitUntil: "load" });
          }
        }
        managed.targets.setActiveTarget(targetId);
        this.attachTrackers(managed);
        return { targetId };
      } catch (error) {
        if (!this.isDetachedFrameError(error)) {
          throw error;
        }
        if (createdTargetId) {
          try {
            await managed.targets.closeTarget(createdTargetId);
          } catch {
            // Best-effort cleanup; fall back to the existing tab.
          }
        }
        const fallbackTargetId = previousTargetId ?? managed.targets.getActiveTargetId();
        if (!fallbackTargetId) {
          throw error;
        }
        managed.targets.setActiveTarget(fallbackTargetId);
        const page = managed.targets.getPage(fallbackTargetId);
        if (url) {
          try {
            await page.goto(url, { waitUntil: "load" });
          } catch (retryError) {
            if (!this.isDetachedFrameError(retryError)) {
              throw retryError;
            }
            await delay(200);
            await page.goto(url, { waitUntil: "load" });
          }
        }
        this.attachTrackers(managed);
        return { targetId: fallbackTargetId };
      }
    }

    const page = await managed.context.newPage();
    const targetId = managed.targets.registerPage(page);
    managed.targets.setActiveTarget(targetId);
    this.attachRefInvalidationForPage(managed, targetId, page);
    if (url) {
      await page.goto(url, { waitUntil: "load" });
    }
    this.attachTrackers(managed);
    return { targetId };
  }

  async closeTarget(sessionId: string, targetId: string): Promise<void> {
    const managed = this.getManaged(sessionId);
    if (managed.mode === "extension") {
      const entries = managed.targets.listPageEntries();
      if (entries.length <= 1) {
        managed.refStore.clearTarget(targetId);
        return;
      }
    }
    await managed.targets.closeTarget(targetId);
    managed.refStore.clearTarget(targetId);
    this.attachTrackers(managed);
  }

  async goto(
    sessionId: string,
    url: string,
    waitUntil: "domcontentloaded" | "load" | "networkidle" = "load",
    timeoutMs = 30000,
    sessionOverride?: { browser: Browser; context: BrowserContext; targets: TargetManager }
  ): Promise<{
    finalUrl?: string;
    status?: number;
    timingMs: number;
    meta?: {
      blocker?: BlockerSignalV1;
      blockerState: "clear" | "active" | "resolving";
      blockerUpdatedAt?: string;
    };
  }> {
    const startTime = Date.now();
    const managed = sessionOverride ? this.buildOverrideSession(sessionOverride) : this.getManaged(sessionId);
    let page = managed.targets.getActivePage();
    const syncExtensionTargets = (): void => {
      try {
        managed.targets.syncPages(managed.context.pages());
      } catch {
        // Best-effort sync only.
      }
    };
    const pickStableExtensionEntry = (): { targetId: string; page: Page } | null => {
      syncExtensionTargets();
      for (const entry of managed.targets.listPageEntries()) {
        try {
          const candidateUrl = entry.page.url();
          if (candidateUrl.startsWith("http://") || candidateUrl.startsWith("https://")) {
            return entry;
          }
        } catch {
          // Ignore pages that cannot report a URL.
        }
      }
      return null;
    };
    const selectFallbackExtensionPage = (): Page | null => {
      syncExtensionTargets();
      const entries = managed.targets.listPageEntries().filter((entry) => !entry.page.isClosed());
      if (entries.length === 0) {
        return null;
      }
      const stable = entries.find((entry) => {
        try {
          const candidateUrl = entry.page.url();
          return candidateUrl.startsWith("http://") || candidateUrl.startsWith("https://");
        } catch {
          return false;
        }
      }) ?? entries[0]!;
      managed.targets.setActiveTarget(stable.targetId);
      return stable.page;
    };
    const ensureActiveExtensionPage = async (): Promise<Page> => {
      const newPage = await this.createExtensionPage(managed, "goto");
      const targetId = managed.targets.registerPage(newPage);
      managed.targets.setActiveTarget(targetId);
      this.attachRefInvalidationForPage(managed, targetId, newPage);
      this.attachTrackers(managed);
      try {
        await this.waitForExtensionTargetReady(newPage, "goto", Math.min(timeoutMs, 5000));
      } catch (error) {
        if (!this.isExtensionTargetReadyTimeout(error)) {
          throw error;
        }
        console.warn("BrowserManager.goto: extension target readiness timed out; continuing.");
      }
      return newPage;
    };

    if (managed.mode === "extension") {
      try {
        const currentUrl = page.url();
        if (!currentUrl || currentUrl === "about:blank" || currentUrl.startsWith("chrome://") || currentUrl.startsWith("chrome-extension://")) {
          const stable = pickStableExtensionEntry();
          if (stable) {
            managed.targets.setActiveTarget(stable.targetId);
            page = stable.page;
          } else {
            try {
              page = await ensureActiveExtensionPage();
            } catch (error) {
              if (!this.isTargetNotAllowedError(error)) {
                throw error;
              }
            }
          }
        }
      } catch {
        try {
          page = await ensureActiveExtensionPage();
        } catch (error) {
          if (!this.isTargetNotAllowedError(error)) {
            throw error;
          }
        }
      }
      try {
        await this.waitForExtensionTargetReady(page, "goto", Math.min(timeoutMs, 5000));
      } catch (error) {
        if (this.isDetachedFrameError(error)) {
          try {
            page = await ensureActiveExtensionPage();
          } catch (retryError) {
            if (!this.isTargetNotAllowedError(retryError)) {
              throw retryError;
            }
            page = selectFallbackExtensionPage() ?? page;
          }
        } else if (this.isExtensionTargetReadyTimeout(error)) {
          page = selectFallbackExtensionPage() ?? page;
        } else {
          throw error;
        }
      }
    }

    let response;
    if (managed.mode === "extension") {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await page.goto(url, { waitUntil, timeout: timeoutMs });
          lastError = null;
          break;
        } catch (error) {
          if (!this.isDetachedFrameError(error)) {
            throw error;
          }
          lastError = error;
          try {
            page = await ensureActiveExtensionPage();
          } catch (retryError) {
            if (!this.isTargetNotAllowedError(retryError)) {
              throw retryError;
            }
            page = selectFallbackExtensionPage() ?? page;
          }
        }
      }
      if (lastError) {
        throw lastError;
      }
    } else {
      response = await page.goto(url, { waitUntil, timeout: timeoutMs });
    }

    const finalUrl = this.safePageUrl(page, "BrowserManager.goto");
    const status = response?.status();
    const title = await this.safePageTitle(page, "BrowserManager.goto");
    const blockerMeta = sessionOverride
      ? undefined
      : this.reconcileSessionBlocker(sessionId, managed, {
        source: "navigation",
        url,
        finalUrl,
        title,
        status,
        verifier: true
      });

    return {
      finalUrl,
      ...(typeof status === "number" ? { status } : {}),
      timingMs: Date.now() - startTime,
      ...(blockerMeta ? { meta: blockerMeta } : {})
    };
  }

  async waitForLoad(
    sessionId: string,
    until: "domcontentloaded" | "load" | "networkidle",
    timeoutMs = 30000
  ): Promise<{
    timingMs: number;
    meta?: {
      blocker?: BlockerSignalV1;
      blockerState: "clear" | "active" | "resolving";
      blockerUpdatedAt?: string;
    };
  }> {
    const startTime = Date.now();
    const managed = this.getManaged(sessionId);
    const page = managed.targets.getActivePage();
    await page.waitForLoadState(until, { timeout: timeoutMs });
    const blockerMeta = this.reconcileSessionBlocker(sessionId, managed, {
      source: "navigation",
      finalUrl: this.safePageUrl(page, "BrowserManager.waitForLoad"),
      title: await this.safePageTitle(page, "BrowserManager.waitForLoad"),
      verifier: true
    });
    return {
      timingMs: Date.now() - startTime,
      ...(blockerMeta ? { meta: blockerMeta } : {})
    };
  }

  async waitForRef(
    sessionId: string,
    ref: string,
    state: "attached" | "visible" | "hidden" = "attached",
    timeoutMs = 30000
  ): Promise<{
    timingMs: number;
    meta?: {
      blocker?: BlockerSignalV1;
      blockerState: "clear" | "active" | "resolving";
      blockerUpdatedAt?: string;
    };
  }> {
    const startTime = Date.now();
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const page = managed.targets.getActivePage();
    await page.locator(selector).waitFor({ state, timeout: timeoutMs });
    const blockerMeta = this.reconcileSessionBlocker(sessionId, managed, {
      source: "navigation",
      finalUrl: this.safePageUrl(page, "BrowserManager.waitForRef"),
      title: await this.safePageTitle(page, "BrowserManager.waitForRef"),
      verifier: true
    });
    return {
      timingMs: Date.now() - startTime,
      ...(blockerMeta ? { meta: blockerMeta } : {})
    };
  }

  async snapshot(sessionId: string, mode: "outline" | "actionables", maxChars: number, cursor?: string): ReturnType<Snapshotter["snapshot"]> {
    const mutex = this.getMutex(sessionId);
    return mutex.runExclusive(async () => {
      const managed = this.getManaged(sessionId);
      const targetId = managed.targets.getActiveTargetId();
      if (!targetId) {
        throw new Error("No active target for snapshot");
      }
      const page = managed.targets.getActivePage();
      return managed.snapshotter.snapshot(page, targetId, {
        mode,
        maxChars,
        cursor,
        maxNodes: this.config.snapshot.maxNodes
      });
    });
  }

  async click(sessionId: string, ref: string): Promise<{ timingMs: number; navigated: boolean }> {
    const mutex = this.getMutex(sessionId);
    return mutex.runExclusive(async () => {
      const startTime = Date.now();
      const managed = this.getManaged(sessionId);
      const selector = this.resolveSelector(managed, ref);
      const page = managed.targets.getActivePage();
      const previousUrl = page.url();
      await page.locator(selector).click();
      const navigated = page.url() !== previousUrl;
      return { timingMs: Date.now() - startTime, navigated };
    });
  }

  async hover(sessionId: string, ref: string): Promise<{ timingMs: number }> {
    const mutex = this.getMutex(sessionId);
    return mutex.runExclusive(async () => {
      const startTime = Date.now();
      const managed = this.getManaged(sessionId);
      const selector = this.resolveSelector(managed, ref);
      await managed.targets.getActivePage().locator(selector).hover();
      return { timingMs: Date.now() - startTime };
    });
  }

  async press(sessionId: string, key: string, ref?: string): Promise<{ timingMs: number }> {
    const mutex = this.getMutex(sessionId);
    return mutex.runExclusive(async () => {
      const startTime = Date.now();
      const managed = this.getManaged(sessionId);
      const page = managed.targets.getActivePage();
      if (ref) {
        const selector = this.resolveSelector(managed, ref);
        await page.locator(selector).focus();
      }
      await page.keyboard.press(key);
      return { timingMs: Date.now() - startTime };
    });
  }

  async check(sessionId: string, ref: string): Promise<{ timingMs: number }> {
    const mutex = this.getMutex(sessionId);
    return mutex.runExclusive(async () => {
      const startTime = Date.now();
      const managed = this.getManaged(sessionId);
      const selector = this.resolveSelector(managed, ref);
      await managed.targets.getActivePage().locator(selector).check();
      return { timingMs: Date.now() - startTime };
    });
  }

  async uncheck(sessionId: string, ref: string): Promise<{ timingMs: number }> {
    const mutex = this.getMutex(sessionId);
    return mutex.runExclusive(async () => {
      const startTime = Date.now();
      const managed = this.getManaged(sessionId);
      const selector = this.resolveSelector(managed, ref);
      await managed.targets.getActivePage().locator(selector).uncheck();
      return { timingMs: Date.now() - startTime };
    });
  }

  async type(sessionId: string, ref: string, text: string, clear = false, submit = false): Promise<{ timingMs: number }> {
    const mutex = this.getMutex(sessionId);
    return mutex.runExclusive(async () => {
      const startTime = Date.now();
      const managed = this.getManaged(sessionId);
      const selector = this.resolveSelector(managed, ref);
      const locator = managed.targets.getActivePage().locator(selector);
      if (clear) {
        await locator.fill("");
      }
      await locator.fill(text);
      if (submit) {
        await locator.press("Enter");
      }
      return { timingMs: Date.now() - startTime };
    });
  }

  async select(sessionId: string, ref: string, values: string[]): Promise<void> {
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    await managed.targets.getActivePage().locator(selector).selectOption(values);
  }

  async scroll(sessionId: string, dy: number, ref?: string): Promise<void> {
    const managed = this.getManaged(sessionId);
    const page = managed.targets.getActivePage();
    if (ref) {
      const selector = this.resolveSelector(managed, ref);
      await page.locator(selector).evaluate((el, delta) => {
        (el as HTMLElement).scrollBy(0, delta as number);
      }, dy);
    } else {
      await page.mouse.wheel(0, dy);
    }
  }

  async scrollIntoView(sessionId: string, ref: string): Promise<{ timingMs: number }> {
    const mutex = this.getMutex(sessionId);
    return mutex.runExclusive(async () => {
      const startTime = Date.now();
      const managed = this.getManaged(sessionId);
      const selector = this.resolveSelector(managed, ref);
      await managed.targets.getActivePage().locator(selector).scrollIntoViewIfNeeded();
      return { timingMs: Date.now() - startTime };
    });
  }

  async domGetHtml(sessionId: string, ref: string, maxChars = 8000): Promise<{ outerHTML: string; truncated: boolean }> {
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const html = await managed.targets.getActivePage().$eval(selector, (el) => (el as Element).outerHTML);
    return truncateHtml(html, maxChars);
  }

  async domGetText(sessionId: string, ref: string, maxChars = 8000): Promise<{ text: string; truncated: boolean }> {
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const text = await managed.targets.getActivePage().$eval(selector, (el) => (el as HTMLElement).innerText || el.textContent || "");
    return truncateText(text, maxChars);
  }

  async domGetAttr(sessionId: string, ref: string, name: string): Promise<{ value: string | null }> {
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const locator = managed.targets.getActivePage().locator(selector);
    return { value: await locator.getAttribute(name) };
  }

  async domGetValue(sessionId: string, ref: string): Promise<{ value: string }> {
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const locator = managed.targets.getActivePage().locator(selector);
    return { value: await locator.inputValue() };
  }

  async domIsVisible(sessionId: string, ref: string): Promise<{ value: boolean }> {
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const locator = managed.targets.getActivePage().locator(selector);
    return { value: await locator.isVisible() };
  }

  async domIsEnabled(sessionId: string, ref: string): Promise<{ value: boolean }> {
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const locator = managed.targets.getActivePage().locator(selector);
    return { value: await locator.isEnabled() };
  }

  async domIsChecked(sessionId: string, ref: string): Promise<{ value: boolean }> {
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const locator = managed.targets.getActivePage().locator(selector);
    return { value: await locator.isChecked() };
  }

  async clonePage(sessionId: string): Promise<ReactExport> {
    const managed = this.getManaged(sessionId);
    const page = managed.targets.getActivePage();
    const allowUnsafeExport = this.config.security.allowUnsafeExport;
    const exportConfig = this.config.export;
    const capture = await captureDom(page, "body", {
      sanitize: !allowUnsafeExport,
      maxNodes: exportConfig.maxNodes,
      inlineStyles: exportConfig.inlineStyles
    });
    const css = extractCss(capture);
    return emitReactComponent(capture, css, { allowUnsafeExport });
  }

  async cloneComponent(sessionId: string, ref: string): Promise<ReactExport> {
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const allowUnsafeExport = this.config.security.allowUnsafeExport;
    const exportConfig = this.config.export;
    const capture = await captureDom(managed.targets.getActivePage(), selector, {
      sanitize: !allowUnsafeExport,
      maxNodes: exportConfig.maxNodes,
      inlineStyles: exportConfig.inlineStyles
    });
    const css = extractCss(capture);
    return emitReactComponent(capture, css, { allowUnsafeExport });
  }

  async perfMetrics(sessionId: string): Promise<{ metrics: Array<{ name: string; value: number }> }> {
    const managed = this.getManaged(sessionId);
    const page = managed.targets.getActivePage();
    const session = await managed.context.newCDPSession(page);
    const result = await session.send("Performance.getMetrics") as { metrics?: Array<{ name: string; value: number }> };
    await session.detach();
    const metrics = Array.isArray(result.metrics) ? result.metrics : [];
    return { metrics };
  }

  async screenshot(sessionId: string, path?: string): Promise<{ path?: string; base64?: string; warnings?: string[] }> {
    const managed = this.getManaged(sessionId);
    const page = managed.targets.getActivePage();
    if (path) {
      await page.screenshot({ path, type: "png" });
      return { path };
    }
    const buffer = await page.screenshot({ type: "png" });
    return { base64: buffer.toString("base64") };
  }

  async consolePoll(
    sessionId: string,
    sinceSeq?: number,
    max = 50
  ): Promise<{ events: ReturnType<ConsoleTracker["poll"]>["events"]; nextSeq: number; truncated?: boolean }> {
    const managed = this.getManaged(sessionId);
    return managed.consoleTracker.poll(sinceSeq, max);
  }

  async exceptionPoll(
    sessionId: string,
    sinceSeq?: number,
    max = 50
  ): Promise<{ events: ReturnType<ExceptionTracker["poll"]>["events"]; nextSeq: number; truncated?: boolean }> {
    const managed = this.getManaged(sessionId);
    return managed.exceptionTracker.poll(sinceSeq, max);
  }

  async networkPoll(
    sessionId: string,
    sinceSeq?: number,
    max = 50
  ): Promise<{ events: ReturnType<NetworkTracker["poll"]>["events"]; nextSeq: number; truncated?: boolean }> {
    const managed = this.getManaged(sessionId);
    return managed.networkTracker.poll(sinceSeq, max);
  }

  async debugTraceSnapshot(
    sessionId: string,
    options: {
      sinceConsoleSeq?: number;
      sinceNetworkSeq?: number;
      sinceExceptionSeq?: number;
      max?: number;
      requestId?: string;
    } = {}
  ): Promise<{
    requestId: string;
    generatedAt: string;
    page: { mode: BrowserMode; activeTargetId: string | null; url?: string; title?: string };
    channels: {
      console: {
        events: Array<ReturnType<ConsoleTracker["poll"]>["events"][number] & { requestId: string; sessionId: string }>;
        nextSeq: number;
        truncated?: boolean;
      };
      network: {
        events: Array<ReturnType<NetworkTracker["poll"]>["events"][number] & { requestId: string; sessionId: string }>;
        nextSeq: number;
        truncated?: boolean;
      };
      exception: {
        events: Array<ReturnType<ExceptionTracker["poll"]>["events"][number] & { requestId: string; sessionId: string }>;
        nextSeq: number;
        truncated?: boolean;
      };
    };
    fingerprint: ReturnType<BrowserManager["buildFingerprintSummary"]>;
    meta?: {
      blocker?: BlockerSignalV1;
      blockerState: "clear" | "active" | "resolving";
      blockerUpdatedAt?: string;
      blockerArtifacts?: ReturnType<typeof buildBlockerArtifacts>;
    };
  }> {
    const requestId = options.requestId ?? createRequestId();
    const managed = this.getManaged(sessionId);
    const max = options.max ?? 500;
    const status = await this.status(sessionId);
    const consoleChannel = managed.consoleTracker.poll(options.sinceConsoleSeq, max);
    const networkChannel = managed.networkTracker.poll(options.sinceNetworkSeq, max);
    const exceptionChannel = managed.exceptionTracker.poll(options.sinceExceptionSeq, max);

    this.applyFingerprintSignals(managed, networkChannel.events, requestId, { source: "debug-trace" });

    const annotateTraceContext = <T extends Record<string, unknown>>(events: T[]) => (
      events.map((event) => ({
        ...event,
        requestId,
        sessionId
      }))
    );

    const blockerMeta = this.reconcileSessionBlocker(sessionId, managed, {
      source: "network",
      url: status.url,
      finalUrl: status.url,
      title: status.title,
      status: this.latestStatus(networkChannel.events),
      traceRequestId: requestId,
      networkEvents: networkChannel.events,
      consoleEvents: consoleChannel.events,
      exceptionEvents: exceptionChannel.events,
      verifier: true,
      includeArtifacts: true
    });

    return {
      requestId,
      generatedAt: new Date().toISOString(),
      page: status,
      channels: {
        console: {
          nextSeq: consoleChannel.nextSeq,
          truncated: consoleChannel.truncated,
          events: annotateTraceContext(consoleChannel.events)
        },
        network: {
          nextSeq: networkChannel.nextSeq,
          truncated: networkChannel.truncated,
          events: annotateTraceContext(networkChannel.events)
        },
        exception: {
          nextSeq: exceptionChannel.nextSeq,
          truncated: exceptionChannel.truncated,
          events: annotateTraceContext(exceptionChannel.events)
        }
      },
      fingerprint: this.buildFingerprintSummary(managed),
      ...(blockerMeta ? { meta: blockerMeta } : {})
    };
  }

  async cookieImport(
    sessionId: string,
    cookies: CookieImportRecord[],
    strict = true,
    requestId = createRequestId()
  ): Promise<{ requestId: string; imported: number; rejected: Array<{ index: number; reason: string }> }> {
    const managed = this.getManaged(sessionId);
    const normalized: CookieImportRecord[] = [];
    const rejected: Array<{ index: number; reason: string }> = [];

    cookies.forEach((cookie, index) => {
      const validation = this.validateCookieRecord(cookie);
      if (!validation.valid) {
        rejected.push({ index, reason: validation.reason });
        return;
      }
      normalized.push(validation.cookie);
    });

    if (strict && rejected.length > 0) {
      throw new Error(`Cookie import rejected ${rejected.length} entries.`);
    }

    if (normalized.length > 0) {
      await managed.context.addCookies(normalized);
    }

    this.logger.audit("session.cookie_import", {
      requestId,
      sessionId,
      data: {
        imported: normalized.length,
        rejected
      }
    });

    return {
      requestId,
      imported: normalized.length,
      rejected
    };
  }

  private initializeFingerprintState(
    sessionId: string,
    profileName: string,
    flags: string[]
  ): ManagedSession["fingerprint"] {
    const tier1Config = this.config.fingerprint.tier1;
    const languageFlag = readFlagValue(flags, "--lang");
    const timezoneFlag = readFlagValue(flags, "--timezone") ?? readFlagValue(flags, "--timezone-for-testing");
    const proxyFlag = readFlagValue(flags, "--proxy-server");

    const tier1 = evaluateTier1Coherence(
      {
        enabled: tier1Config.enabled,
        warnOnly: tier1Config.warnOnly,
        expectedLocale: tier1Config.locale,
        expectedTimezone: tier1Config.timezone,
        expectedLanguages: tier1Config.languages,
        requireProxy: tier1Config.requireProxy,
        geolocationRequired: tier1Config.geolocationRequired
      },
      {
        locale: tier1Config.locale ?? languageFlag,
        timezone: tier1Config.timezone ?? timezoneFlag,
        languages: tier1Config.languages.length > 0
          ? tier1Config.languages
          : languageFlag
            ? [languageFlag]
            : [],
        proxy: proxyFlag,
        geolocation: tier1Config.geolocation
          ? {
            latitude: tier1Config.geolocation.latitude,
            longitude: tier1Config.geolocation.longitude,
            accuracy: tier1Config.geolocation.accuracy
          }
          : undefined
      }
    );

    const tier2 = createTier2RuntimeState(
      {
        enabled: this.config.fingerprint.tier2.enabled,
        mode: this.config.fingerprint.tier2.mode,
        rotationIntervalMs: this.config.fingerprint.tier2.rotationIntervalMs,
        challengePatterns: this.config.fingerprint.tier2.challengePatterns,
        maxChallengeEvents: this.config.fingerprint.tier2.maxChallengeEvents,
        scorePenalty: this.config.fingerprint.tier2.scorePenalty,
        scoreRecovery: this.config.fingerprint.tier2.scoreRecovery,
        rotationHealthThreshold: this.config.fingerprint.tier2.rotationHealthThreshold
      },
      sessionId,
      profileName
    );

    const tier3 = createTier3RuntimeState({
      enabled: this.config.fingerprint.tier3.enabled,
      fallbackTier: this.config.fingerprint.tier3.fallbackTier,
      canary: {
        windowSize: this.config.fingerprint.tier3.canary.windowSize,
        minSamples: this.config.fingerprint.tier3.canary.minSamples,
        promoteThreshold: this.config.fingerprint.tier3.canary.promoteThreshold,
        rollbackThreshold: this.config.fingerprint.tier3.canary.rollbackThreshold
      }
    });

    return {
      tier1,
      tier2,
      tier3,
      lastAppliedNetworkSeq: 0
    };
  }

  private applyFingerprintSignals(
    managed: ManagedSession,
    events: ReturnType<NetworkTracker["poll"]>["events"],
    requestId: string,
    options: FingerprintSignalApplyOptions = {}
  ): void {
    const applyTier2 = options.applyTier2 ?? true;
    const applyTier3 = options.applyTier3 ?? true;
    if (!applyTier2 && !applyTier3) {
      return;
    }

    const pendingEvents = events.filter((event) => event.seq > managed.fingerprint.lastAppliedNetworkSeq);
    if (pendingEvents.length === 0) {
      return;
    }

    let tier2 = managed.fingerprint.tier2;
    let tier3 = managed.fingerprint.tier3;
    const tier2Config = this.config.fingerprint.tier2;
    const tier3Config = this.config.fingerprint.tier3;
    const signalSource = options.source ?? "debug-trace";

    for (const event of pendingEvents) {
      const evaluationTs = event.ts ?? Date.now();
      let hasChallenge = false;

      if (applyTier2) {
        const tier2Result = applyTier2NetworkEvent(
          tier2,
          {
            enabled: tier2Config.enabled,
            mode: tier2Config.mode,
            rotationIntervalMs: tier2Config.rotationIntervalMs,
            challengePatterns: tier2Config.challengePatterns,
            maxChallengeEvents: tier2Config.maxChallengeEvents,
            scorePenalty: tier2Config.scorePenalty,
            scoreRecovery: tier2Config.scoreRecovery,
            rotationHealthThreshold: tier2Config.rotationHealthThreshold
          },
          {
            url: event.url,
            status: event.status,
            ts: evaluationTs
          },
          evaluationTs
        );
        tier2 = tier2Result.state;
        hasChallenge = Boolean(tier2Result.challenge);

        if (tier2Result.challenge) {
          this.logger.warn("fingerprint.tier2.challenge", {
            requestId,
            sessionId: managed.sessionId,
            data: {
              event: tier2Result.challenge,
              score: tier2.profile.healthScore
            }
          });
        }

        if (tier2Result.rotated) {
          this.logger.info("fingerprint.tier2.rotate", {
            requestId,
            sessionId: managed.sessionId,
            data: {
              reason: tier2Result.reason,
              profileId: tier2.profile.id,
              rotationCount: tier2.profile.rotationCount
            }
          });
        }
      }

      if (!applyTier3) {
        continue;
      }

      const tier3Result = evaluateTier3Adaptive(
        tier3,
        {
          enabled: tier3Config.enabled,
          fallbackTier: tier3Config.fallbackTier,
          canary: {
            windowSize: tier3Config.canary.windowSize,
            minSamples: tier3Config.canary.minSamples,
            promoteThreshold: tier3Config.canary.promoteThreshold,
            rollbackThreshold: tier3Config.canary.rollbackThreshold
          }
        },
        {
          hasChallenge,
          healthScore: tier2.profile.healthScore,
          challengeCount: tier2.profile.challengeCount,
          rotationCount: tier2.profile.rotationCount,
          metadata: {
            url: event.url,
            status: event.status
          }
        },
        undefined,
        evaluationTs
      );

      tier3 = tier3Result.state;
      const targetClass = this.resolveCanaryTargetClass(event.url, event.status);
      const scoreWindow = this.buildCanaryScoreWindow(tier3.canary.samples);
      const thresholdComparison = {
        promoteDelta: tier3Result.decision.score - tier3Config.canary.promoteThreshold,
        rollbackDelta: tier3Result.decision.score - tier3Config.canary.rollbackThreshold
      };

      if (tier3Result.action === "rollback") {
        this.logger.warn("fingerprint.tier3.rollback", {
          requestId,
          sessionId: managed.sessionId,
          data: {
            action: tier3Result.action,
            reason: tier3Result.decision.reason,
            score: tier3Result.decision.score,
            threshold: {
              windowSize: tier3Config.canary.windowSize,
              minSamples: tier3Config.canary.minSamples,
              promoteThreshold: tier3Config.canary.promoteThreshold,
              rollbackThreshold: tier3Config.canary.rollbackThreshold
            },
            canary: {
              level: tier3.canary.level,
              averageScore: tier3.canary.averageScore,
              sampleCount: tier3.canary.samples.length
            },
            targetClass,
            scoreWindow,
            thresholdComparison,
            fallbackTier: tier3.fallbackTier,
            status: tier3.status,
            source: signalSource
          }
        });
      } else if (tier3Result.action === "promote") {
        this.logger.info("fingerprint.tier3.promote", {
          requestId,
          sessionId: managed.sessionId,
          data: {
            action: tier3Result.action,
            reason: tier3Result.decision.reason,
            score: tier3Result.decision.score,
            threshold: {
              windowSize: tier3Config.canary.windowSize,
              minSamples: tier3Config.canary.minSamples,
              promoteThreshold: tier3Config.canary.promoteThreshold,
              rollbackThreshold: tier3Config.canary.rollbackThreshold
            },
            canary: {
              level: tier3.canary.level,
              averageScore: tier3.canary.averageScore,
              sampleCount: tier3.canary.samples.length
            },
            targetClass,
            scoreWindow,
            thresholdComparison,
            source: signalSource
          }
        });
      }
    }

    managed.fingerprint.tier2 = tier2;
    managed.fingerprint.tier3 = tier3;
    managed.fingerprint.lastAppliedNetworkSeq = pendingEvents[pendingEvents.length - 1]?.seq ?? managed.fingerprint.lastAppliedNetworkSeq;

    if (tier3.enabled && tier3.status === "fallback") {
      managed.fingerprint.tier2 = {
        ...tier2,
        enabled: resolveTier3FallbackTarget(tier3.fallbackTier) === "tier2"
      };
    }
  }

  private attachContinuousFingerprintSignals(managed: ManagedSession): void {
    if (this.networkSignalSubscriptions.has(managed.sessionId)) {
      return;
    }

    const unsubscribe = managed.networkTracker.subscribe((event) => {
      const applyTier2 = this.isContinuousSignalsEnabled(this.config.fingerprint.tier2)
        && this.config.fingerprint.tier2.enabled;
      const applyTier3 = this.isContinuousSignalsEnabled(this.config.fingerprint.tier3)
        && this.config.fingerprint.tier3.enabled
        && applyTier2;
      if (!applyTier2 && !applyTier3) {
        return;
      }

      this.applyFingerprintSignals(managed, [event], createRequestId(), {
        applyTier2,
        applyTier3,
        source: "continuous"
      });
    });

    this.networkSignalSubscriptions.set(managed.sessionId, unsubscribe);
  }

  private isContinuousSignalsEnabled(config: { enabled: boolean }): boolean {
    const runtimeConfig = config as { continuousSignals?: unknown };
    if (typeof runtimeConfig.continuousSignals === "boolean") {
      return runtimeConfig.continuousSignals;
    }
    return true;
  }

  private resolveCanaryTargetClass(url: string, status?: number): string {
    if (!this.config.canary?.targets?.enabled) {
      return "disabled";
    }
    if (typeof status === "number" && status >= 400) {
      return "error_surface";
    }

    const lowered = url.toLowerCase();
    if (/(captcha|challenge|auth|login|verify|cf_chl)/.test(lowered)) {
      return "high_friction";
    }
    return "standard";
  }

  private buildCanaryScoreWindow(
    samples: Tier3RuntimeState["canary"]["samples"]
  ): {
    sampleCount: number;
    averageScore: number;
    minScore: number;
    maxScore: number;
    latestScore: number | null;
  } {
    if (samples.length === 0) {
      return {
        sampleCount: 0,
        averageScore: 0,
        minScore: 0,
        maxScore: 0,
        latestScore: null
      };
    }

    let minScore = Number.POSITIVE_INFINITY;
    let maxScore = Number.NEGATIVE_INFINITY;
    let totalScore = 0;
    for (const sample of samples) {
      totalScore += sample.score;
      minScore = Math.min(minScore, sample.score);
      maxScore = Math.max(maxScore, sample.score);
    }

    return {
      sampleCount: samples.length,
      averageScore: totalScore / samples.length,
      minScore: Number.isFinite(minScore) ? minScore : 0,
      maxScore: Number.isFinite(maxScore) ? maxScore : 0,
      latestScore: samples[samples.length - 1]?.score ?? null
    };
  }

  private buildFingerprintSummary(managed: ManagedSession): {
    tier1: {
      ok: boolean;
      warnings: string[];
      issues: Tier1CoherenceResult["issues"];
    };
    tier2: {
      enabled: boolean;
      mode: Tier2RuntimeState["mode"];
      profileId: string;
      healthScore: number;
      challengeCount: number;
      rotationCount: number;
      lastRotationTs: number;
      lastAppliedNetworkSeq: number;
      recentChallenges: Tier2RuntimeState["challengeEvents"];
    };
    tier3: {
      enabled: boolean;
      status: Tier3RuntimeState["status"];
      adapterName: string;
      fallbackTier: Tier3RuntimeState["fallbackTier"];
      fallbackReason?: string;
      canary: {
        level: number;
        averageScore: number;
        lastAction: string;
        sampleCount: number;
      };
    };
  } {
    return {
      tier1: {
        ok: managed.fingerprint.tier1.ok,
        warnings: managed.fingerprint.tier1.warnings,
        issues: managed.fingerprint.tier1.issues
      },
      tier2: {
        enabled: managed.fingerprint.tier2.enabled,
        mode: managed.fingerprint.tier2.mode,
        profileId: managed.fingerprint.tier2.profile.id,
        healthScore: managed.fingerprint.tier2.profile.healthScore,
        challengeCount: managed.fingerprint.tier2.profile.challengeCount,
        rotationCount: managed.fingerprint.tier2.profile.rotationCount,
        lastRotationTs: managed.fingerprint.tier2.lastRotationTs,
        lastAppliedNetworkSeq: managed.fingerprint.lastAppliedNetworkSeq,
        recentChallenges: managed.fingerprint.tier2.challengeEvents.slice(-5)
      },
      tier3: {
        enabled: managed.fingerprint.tier3.enabled,
        status: managed.fingerprint.tier3.status,
        adapterName: managed.fingerprint.tier3.adapterName,
        fallbackTier: managed.fingerprint.tier3.fallbackTier,
        ...(managed.fingerprint.tier3.fallbackReason
          ? { fallbackReason: managed.fingerprint.tier3.fallbackReason }
          : {}),
        canary: {
          level: managed.fingerprint.tier3.canary.level,
          averageScore: managed.fingerprint.tier3.canary.averageScore,
          lastAction: managed.fingerprint.tier3.canary.lastAction,
          sampleCount: managed.fingerprint.tier3.canary.samples.length
        }
      }
    };
  }

  private latestStatus(
    events: Array<{ status?: number }>
  ): number | undefined {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const status = events[index]?.status;
      if (typeof status === "number") {
        return status;
      }
    }
    return undefined;
  }

  private recentNetworkEvents(managed: ManagedSession): ReturnType<NetworkTracker["poll"]>["events"] {
    const max = this.config.blockerArtifactCaps.maxNetworkEvents;
    return managed.networkTracker.poll(undefined, max).events;
  }

  private extractNetworkHosts(events: Array<{ url?: string }>): string[] {
    const hosts: string[] = [];
    const seen = new Set<string>();
    for (const event of events) {
      if (typeof event.url !== "string") continue;
      try {
        const host = new URL(event.url).hostname.toLowerCase();
        if (!host || seen.has(host)) continue;
        seen.add(host);
        hosts.push(host);
        if (hosts.length >= this.config.blockerArtifactCaps.maxHosts) break;
      } catch {
        // Ignore invalid/partial URLs in debug events.
      }
    }
    return hosts;
  }

  private buildTargetKey(managed: ManagedSession, url?: string): string {
    const targetId = managed.targets.getActiveTargetId() ?? "unknown";
    const host = (() => {
      if (!url) return "";
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    return `${targetId}:${host}`;
  }

  private reconcileSessionBlocker(
    sessionId: string,
    managed: ManagedSession,
    input: {
      source: "navigation" | "network";
      url?: string;
      finalUrl?: string;
      title?: string;
      status?: number;
      message?: string;
      providerErrorCode?: string;
      traceRequestId?: string;
      networkEvents?: Array<{ url?: string; status?: number }>;
      consoleEvents?: unknown[];
      exceptionEvents?: unknown[];
      verifier?: boolean;
      includeArtifacts?: boolean;
      envLimited?: boolean;
      restrictedTarget?: boolean;
    }
  ): {
    blocker?: BlockerSignalV1;
    blockerState: "clear" | "active" | "resolving";
    blockerUpdatedAt?: string;
    blockerArtifacts?: ReturnType<typeof buildBlockerArtifacts>;
  } | undefined {
    if (!this.store.has(sessionId)) {
      return undefined;
    }

    const now = Date.now();
    if (input.verifier) {
      this.store.startResolving(sessionId, now);
    }

    const networkEvents = input.networkEvents ?? this.recentNetworkEvents(managed);
    const blocker = classifyBlockerSignal({
      source: input.source,
      url: input.url,
      finalUrl: input.finalUrl,
      title: input.title,
      status: input.status,
      providerErrorCode: input.providerErrorCode,
      message: input.message,
      matchedPatterns: this.config.fingerprint.tier2.challengePatterns,
      networkHosts: this.extractNetworkHosts(networkEvents),
      traceRequestId: input.traceRequestId,
      envLimited: input.envLimited,
      restrictedTarget: input.restrictedTarget,
      promptGuardEnabled: this.config.security.promptInjectionGuard?.enabled ?? true,
      threshold: this.config.blockerDetectionThreshold
    });

    this.store.reconcileBlocker(sessionId, blocker, {
      timeoutMs: this.config.blockerResolutionTimeoutMs,
      verifier: input.verifier,
      targetKey: this.buildTargetKey(managed, input.finalUrl ?? input.url),
      nowMs: now
    });

    const summary = this.store.getBlockerSummary(sessionId);
    const artifacts = input.includeArtifacts && summary.state !== "clear"
      ? buildBlockerArtifacts({
        networkEvents: networkEvents as unknown[],
        consoleEvents: input.consoleEvents,
        exceptionEvents: input.exceptionEvents,
        promptGuardEnabled: this.config.security.promptInjectionGuard?.enabled ?? true,
        caps: this.config.blockerArtifactCaps
      })
      : undefined;

    return {
      blockerState: summary.state,
      ...(summary.blocker ? { blocker: summary.blocker } : {}),
      ...(summary.updatedAt ? { blockerUpdatedAt: summary.updatedAt } : {}),
      ...(artifacts ? { blockerArtifacts: artifacts } : {})
    };
  }

  private validateCookieRecord(cookie: CookieImportRecord): {
    valid: boolean;
    reason: string;
    cookie: CookieImportRecord;
  } {
    const name = cookie.name?.trim();
    if (!name) {
      return { valid: false, reason: "Cookie name is required.", cookie };
    }
    if (!/^[^\s;=]+$/.test(name)) {
      return { valid: false, reason: `Invalid cookie name: ${cookie.name}.`, cookie };
    }

    if (typeof cookie.value !== "string") {
      return { valid: false, reason: `Invalid cookie value for ${name}.`, cookie };
    }

    const value = cookie.value;
    if (/\r|\n|;/.test(value)) {
      return { valid: false, reason: `Invalid cookie value for ${name}.`, cookie };
    }

    const hasUrl = typeof cookie.url === "string" && cookie.url.trim().length > 0;
    const hasDomain = typeof cookie.domain === "string" && cookie.domain.trim().length > 0;
    if (!hasUrl && !hasDomain) {
      return { valid: false, reason: `Cookie ${name} requires url or domain.`, cookie };
    }

    let normalizedUrl: string | undefined;
    if (hasUrl) {
      try {
        const parsedUrl = new URL(cookie.url as string);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          return { valid: false, reason: `Cookie ${name} url must be http(s).`, cookie };
        }
        normalizedUrl = parsedUrl.toString();
      } catch {
        return { valid: false, reason: `Cookie ${name} has invalid url.`, cookie };
      }
    }

    let normalizedDomain: string | undefined;
    if (hasDomain) {
      normalizedDomain = String(cookie.domain).trim().toLowerCase();
      if (!/^\.?[a-z0-9.-]+$/.test(normalizedDomain)) {
        return { valid: false, reason: `Cookie ${name} has invalid domain.`, cookie };
      }
      if (normalizedDomain.includes("..")) {
        return { valid: false, reason: `Cookie ${name} has invalid domain.`, cookie };
      }
    }

    const normalizedPath = typeof cookie.path === "string" ? cookie.path.trim() : undefined;
    if (typeof normalizedPath === "string" && !normalizedPath.startsWith("/")) {
      return { valid: false, reason: `Cookie ${name} path must start with '/'.`, cookie };
    }

    if (typeof cookie.expires !== "undefined") {
      if (!Number.isFinite(cookie.expires)) {
        return { valid: false, reason: `Cookie ${name} has invalid expires.`, cookie };
      }
      if ((cookie.expires as number) < -1) {
        return { valid: false, reason: `Cookie ${name} has invalid expires.`, cookie };
      }
    }

    if (cookie.sameSite === "None" && cookie.secure !== true) {
      return { valid: false, reason: `Cookie ${name} with SameSite=None must set secure=true.`, cookie };
    }

    // Playwright expects either URL-form cookies or domain+path cookies.
    // For URL-form cookies, avoid forcing a synthetic path to preserve runtime compatibility.
    const normalizedCookie: CookieImportRecord = {
      name,
      value,
      ...(typeof cookie.expires === "number" ? { expires: cookie.expires } : {}),
      ...(typeof cookie.httpOnly === "boolean" ? { httpOnly: cookie.httpOnly } : {}),
      ...(typeof cookie.secure === "boolean" ? { secure: cookie.secure } : {}),
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {})
    };

    if (normalizedDomain) {
      normalizedCookie.domain = normalizedDomain;
      normalizedCookie.path = normalizedPath ?? "/";
    } else if (normalizedUrl) {
      normalizedCookie.url = normalizedUrl;
    }

    return {
      valid: true,
      reason: "",
      cookie: normalizedCookie
    };
  }

  private buildOverrideSession(input: { browser: Browser; context: BrowserContext; targets: TargetManager }): ManagedSession {
    const refStore = new RefStore();
    const fingerprint = this.initializeFingerprintState("override", this.config.profile, this.config.flags);
    return {
      sessionId: "override",
      mode: "managed",
      browser: input.browser,
      context: input.context,
      profileDir: "",
      persistProfile: true,
      targets: input.targets,
      refStore,
      snapshotter: new Snapshotter(refStore),
      consoleTracker: new ConsoleTracker(200, { showFullConsole: this.config.devtools.showFullConsole }),
      exceptionTracker: new ExceptionTracker(200),
      networkTracker: new NetworkTracker(300, { showFullUrls: this.config.devtools.showFullUrls }),
      fingerprint
    };
  }

  private getManaged(sessionId: string): ManagedSession {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      throw new Error(`Unknown sessionId: ${sessionId}`);
    }
    return managed;
  }

  private resolveSelector(managed: ManagedSession, ref: string): string {
    const targetId = managed.targets.getActiveTargetId();
    if (!targetId) {
      throw new Error("No active target for ref resolution");
    }
    const entry = managed.refStore.resolve(targetId, ref);
    if (!entry) {
      throw new Error(`Unknown ref: ${ref}. Take a new snapshot first.`);
    }
    return entry.selector;
  }

  private async safePageTitle(page: Page | null, context: string): Promise<string | undefined> {
    if (!page) return undefined;
    try {
      const result = await Promise.race([
        page.title(),
        delay(2000).then(() => null)
      ]);
      if (result === null) {
        console.warn(`${context}: timed out reading page title`);
        return undefined;
      }
      return result;
    } catch {
      console.warn(`${context}: failed to read page title`);
      return undefined;
    }
  }

  private safePageUrl(page: Page | null, context: string): string | undefined {
    if (!page) return undefined;
    try {
      return page.url();
    } catch {
      console.warn(`${context}: failed to read page url`);
      return undefined;
    }
  }

  private async createExtensionPage(managed: ManagedSession, context: string): Promise<Page> {
    try {
      return await managed.context.newPage();
    } catch (error) {
      if (managed.mode !== "extension" || !this.isDetachedFrameError(error)) {
        throw error;
      }
    }

    await delay(200);

    try {
      return await managed.context.newPage();
    } catch (error) {
      throw this.describeExtensionFailure(context, error, managed);
    }
  }

  private async waitForExtensionTargetReady(page: Page, context: string, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: string | null = null;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new Error(`EXTENSION_TARGET_READY_CLOSED: ${context} page closed before navigation.`);
      }
      try {
        const frame = page.mainFrame();
        if (!frame.isDetached()) {
          const remaining = Math.max(250, Math.min(750, deadline - Date.now()));
          await frame.waitForLoadState("domcontentloaded", { timeout: remaining });
          return;
        }
      } catch (error) {
        if (this.isDetachedFrameError(error)) {
          lastError = error instanceof Error ? error.message : String(error);
        } else if (error instanceof Error && error.name === "TimeoutError") {
          // Continue polling until deadline.
        } else {
          throw error;
        }
      }
      await delay(100);
    }

    const detail = lastError ? ` Last error: ${lastError}` : "";
    throw new Error(`EXTENSION_TARGET_READY_TIMEOUT: ${context} exceeded ${timeoutMs}ms.${detail}`);
  }

  private isDetachedFrameError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Frame has been detached");
  }

  private isTargetNotAllowedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Target.createTarget") && message.includes("Not allowed");
  }

  private isExtensionTargetReadyTimeout(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.startsWith("EXTENSION_TARGET_READY_TIMEOUT");
  }

  private describeExtensionFailure(context: string, error: unknown, managed: ManagedSession): Error {
    const message = error instanceof Error ? error.message : String(error);
    let url: string | undefined;
    try {
      url = this.safePageUrl(managed.targets.getActivePage(), `BrowserManager.${context}`);
    } catch {
      url = undefined;
    }
    const urlInfo = url ? ` Active tab: ${url}.` : "";
    return new Error(`Extension mode ${context} failed. Focus a stable http(s) tab and retry.${urlInfo} ${message}`);
  }

  private attachTrackers(managed: ManagedSession): void {
    const activeTargetId = managed.targets.getActiveTargetId();
    if (!activeTargetId) return;
    const page = managed.targets.getActivePage();
    managed.consoleTracker.attach(page);
    managed.exceptionTracker.attach(page);
    managed.networkTracker.attach(page);
  }

  private attachRefInvalidation(managed: ManagedSession): void {
    const entries = managed.targets.listPageEntries();
    for (const entry of entries) {
      this.attachRefInvalidationForPage(managed, entry.targetId, entry.page);
    }
  }

  private attachRefInvalidationForPage(managed: ManagedSession, targetId: string, page: Page): void {
    if (this.pageListeners.has(page)) return;

    const onNavigate = (frame: { parentFrame: () => unknown }) => {
      if (frame.parentFrame() === null) {
        managed.refStore.clearTarget(targetId);
      }
    };

    const onClose = () => {
      managed.refStore.clearTarget(targetId);
    };

    page.on("framenavigated", onNavigate);
    page.on("close", onClose);

    this.pageListeners.set(page, () => {
      page.off("framenavigated", onNavigate);
      page.off("close", onClose);
    });
  }

  private async resolveWsEndpoint(options: ConnectOptions): Promise<string> {
    if (options.wsEndpoint) {
      ensureLocalEndpoint(options.wsEndpoint, this.config.security.allowNonLocalCdp);
      return options.wsEndpoint;
    }

    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 9222;
    const url = `http://${host}:${port}/json/version`;
    ensureLocalEndpoint(url, this.config.security.allowNonLocalCdp);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch CDP endpoint from ${url}`);
    }

    const data = await response.json() as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error("webSocketDebuggerUrl missing from /json/version response");
    }

    ensureLocalEndpoint(data.webSocketDebuggerUrl, this.config.security.allowNonLocalCdp);

    return data.webSocketDebuggerUrl;
  }

  private async connectWithEndpoint(
    connectWsEndpoint: string,
    mode: BrowserMode,
    reportedWsEndpoint?: string
  ): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string }> {
    let browser: Browser;
    const connectStart = Date.now();
    const sanitizedEndpoint = this.sanitizeWsEndpointForOutput(connectWsEndpoint);
    try {
      browser = await chromium.connectOverCDP(connectWsEndpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("401") || message.toLowerCase().includes("unauthorized")) {
        throw new Error("Relay /cdp rejected the connection (unauthorized). Check relayToken configuration and ensure clients use the current token.");
      }
      throw new Error(
        `Relay /cdp connectOverCDP failed after ${Date.now() - connectStart}ms (mode=${mode}, endpoint=${sanitizedEndpoint}): ${message}`,
        { cause: error }
      );
    }
    try {
      const contexts = browser.contexts();
      let context = contexts[0] ?? null;
      if (!context) {
        if (mode === "extension") {
          throw new Error("Extension relay did not expose a browser context. Ensure a normal tab is active and retry.");
        }
        context = await browser.newContext();
      }

      const sessionId = randomUUID();
      const targets = new TargetManager();
      const pages = context.pages();

      if (pages.length === 0) {
        if (mode === "extension") {
          const page = await waitForPage(context, 8000);
          if (!page) {
            throw new Error("Extension relay connected but no page was detected. Focus a normal tab and retry.");
          }
          targets.registerPage(page);
        } else {
          const page = await context.newPage();
          targets.registerPage(page);
        }
      } else {
        targets.registerExistingPages(pages);
        if (mode === "extension") {
          const entries = targets.listPageEntries();
          for (const entry of entries) {
            try {
              const url = entry.page.url();
              if (url.startsWith("http://") || url.startsWith("https://")) {
                targets.setActiveTarget(entry.targetId);
                break;
              }
            } catch {
              // Skip pages that cannot report a URL.
            }
          }
        }
      }

      const refStore = new RefStore();
      const snapshotter = new Snapshotter(refStore);
      const consoleTracker = new ConsoleTracker(200, { showFullConsole: this.config.devtools.showFullConsole });
      const exceptionTracker = new ExceptionTracker(200);
      const networkTracker = new NetworkTracker(300, { showFullUrls: this.config.devtools.showFullUrls });
      const fingerprint = this.initializeFingerprintState(
        sessionId,
        this.config.profile,
        this.config.flags
      );
      const warnings = formatTier1Warnings(fingerprint.tier1);

      const managed: ManagedSession = {
        sessionId,
        mode,
        browser,
        context,
        profileDir: "",
        persistProfile: true,
        targets,
        refStore,
        snapshotter,
        consoleTracker,
        exceptionTracker,
        networkTracker,
        fingerprint
      };

      this.store.add({ id: sessionId, mode, browser, context });
      this.sessions.set(sessionId, managed);
      this.attachContinuousFingerprintSignals(managed);
      this.attachTrackers(managed);
      this.attachRefInvalidation(managed);

      if (!fingerprint.tier1.ok) {
        this.logger.warn("fingerprint.tier1.mismatch", {
          sessionId,
          data: { issues: fingerprint.tier1.issues, mode }
        });
      }

      const wsEndpoint = reportedWsEndpoint ?? connectWsEndpoint;
      return { sessionId, mode, activeTargetId: targets.getActiveTargetId(), warnings, wsEndpoint };
    } catch (error) {
      try {
        await browser.close();
      } catch {
        // Best-effort cleanup to avoid orphaned /cdp connections.
      }
      throw error;
    }
  }

  private async resolveRelayEndpoints(wsEndpoint: string): Promise<{ connectEndpoint: string; reportedEndpoint: string }> {
    const result = await resolveRelayEndpoint({ wsEndpoint, path: "cdp", config: this.config });
    return { connectEndpoint: result.connectEndpoint, reportedEndpoint: result.reportedEndpoint };
  }

  private sanitizeWsEndpointForOutput(wsEndpoint: string): string {
    return sanitizeWsEndpoint(wsEndpoint);
  }
}

const waitForPage = async (context: BrowserContext, timeoutMs: number): Promise<Page | null> => {
  const existing = context.pages()[0];
  if (existing) return existing;
  try {
    return await context.waitForEvent("page", { timeout: timeoutMs });
  } catch {
    return context.pages()[0] ?? null;
  }
};

function truncateHtml(value: string, maxChars: number): { outerHTML: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { outerHTML: value, truncated: false };
  }
  return { outerHTML: value.slice(0, maxChars), truncated: true };
}

function readFlagValue(flags: string[], key: string): string | undefined {
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (!flag) continue;
    if (flag === key) {
      const next = flags[index + 1];
      if (next && !next.startsWith("--")) {
        return next;
      }
      continue;
    }
    if (flag.startsWith(`${key}=`)) {
      const value = flag.slice(key.length + 1);
      return value || undefined;
    }
  }
  return undefined;
}

function resolveTier3FallbackTarget(tier: "tier1" | "tier2"): "tier1" | "tier2" {
  return tier;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, maxChars), truncated: true };
}
