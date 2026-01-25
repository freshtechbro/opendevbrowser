import { randomUUID } from "crypto";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { Mutex } from "async-mutex";
import type { OpenDevBrowserConfig } from "../config";
import { resolveCachePaths } from "../cache/paths";
import { findChromeExecutable } from "../cache/chrome-locator";
import { downloadChromeForTesting } from "../cache/downloader";
import { ConsoleTracker } from "../devtools/console-tracker";
import { NetworkTracker } from "../devtools/network-tracker";
import { captureDom } from "../export/dom-capture";
import { extractCss } from "../export/css-extract";
import { emitReactComponent, type ReactExport } from "../export/react-emitter";
import { RefStore } from "../snapshot/refs";
import { Snapshotter } from "../snapshot/snapshotter";
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
  networkTracker: NetworkTracker;
};

export class BrowserManager {
  private store = new SessionStore();
  private sessions = new Map<string, ManagedSession>();
  private sessionMutexes = new Map<string, Mutex>();
  private worktree: string;
  private config: OpenDevBrowserConfig;
  private pageListeners = new WeakMap<Page, () => void>();

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
      const networkTracker = new NetworkTracker(300, { showFullUrls: this.config.devtools.showFullUrls });

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
        networkTracker
      };

      this.store.add({ id: sessionId, mode: "managed", browser, context });
      this.sessions.set(sessionId, managed);

      this.attachTrackers(managed);
      this.attachRefInvalidation(managed);

      const wsEndpointProvider = browser as unknown as { wsEndpoint?: () => string };
      const wsEndpoint = typeof wsEndpointProvider.wsEndpoint === "function"
        ? wsEndpointProvider.wsEndpoint()
        : undefined;

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

  async connectRelay(wsEndpoint: string): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string }> {
    this.ensureLocalEndpoint(wsEndpoint);
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
      const page = await managed.context.newPage();
      targetId = managed.targets.registerPage(page, name);
      managed.targets.setActiveTarget(targetId);
      this.attachRefInvalidationForPage(managed, targetId, page);
      created = true;
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
    await managed.targets.closeTarget(targetId);
    managed.refStore.clearTarget(targetId);
    this.attachTrackers(managed);
  }

  async goto(sessionId: string, url: string, waitUntil: "domcontentloaded" | "load" | "networkidle" = "load", timeoutMs = 30000, sessionOverride?: { browser: Browser; context: BrowserContext; targets: TargetManager }): Promise<{ finalUrl?: string; status?: number; timingMs: number }> {
    const startTime = Date.now();
    const managed = sessionOverride ? this.buildOverrideSession(sessionOverride) : this.getManaged(sessionId);
    const page = managed.targets.getActivePage();
    const response = await page.goto(url, { waitUntil, timeout: timeoutMs });

    return {
      finalUrl: page.url(),
      status: response?.status(),
      timingMs: Date.now() - startTime
    };
  }

  async waitForLoad(sessionId: string, until: "domcontentloaded" | "load" | "networkidle", timeoutMs = 30000): Promise<{ timingMs: number }> {
    const startTime = Date.now();
    const managed = this.getManaged(sessionId);
    const page = managed.targets.getActivePage();
    await page.waitForLoadState(until, { timeout: timeoutMs });
    return { timingMs: Date.now() - startTime };
  }

  async waitForRef(sessionId: string, ref: string, state: "attached" | "visible" | "hidden" = "attached", timeoutMs = 30000): Promise<{ timingMs: number }> {
    const startTime = Date.now();
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const page = managed.targets.getActivePage();
    await page.locator(selector).waitFor({ state, timeout: timeoutMs });
    return { timingMs: Date.now() - startTime };
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

  async screenshot(sessionId: string, path?: string): Promise<{ path?: string; base64?: string }> {
    const managed = this.getManaged(sessionId);
    const page = managed.targets.getActivePage();
    if (path) {
      await page.screenshot({ path, type: "png" });
      return { path };
    }
    const buffer = await page.screenshot({ type: "png" });
    return { base64: buffer.toString("base64") };
  }

  async consolePoll(sessionId: string, sinceSeq?: number, max = 50): Promise<{ events: ReturnType<ConsoleTracker["poll"]>["events"]; nextSeq: number }> {
    const managed = this.getManaged(sessionId);
    return managed.consoleTracker.poll(sinceSeq, max);
  }

  async networkPoll(sessionId: string, sinceSeq?: number, max = 50): Promise<{ events: ReturnType<NetworkTracker["poll"]>["events"]; nextSeq: number }> {
    const managed = this.getManaged(sessionId);
    return managed.networkTracker.poll(sinceSeq, max);
  }

  private buildOverrideSession(input: { browser: Browser; context: BrowserContext; targets: TargetManager }): ManagedSession {
    const refStore = new RefStore();
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
      networkTracker: new NetworkTracker(300, { showFullUrls: this.config.devtools.showFullUrls })
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

  private attachTrackers(managed: ManagedSession): void {
    const activeTargetId = managed.targets.getActiveTargetId();
    if (!activeTargetId) return;
    const page = managed.targets.getActivePage();
    managed.consoleTracker.attach(page);
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
      this.ensureLocalEndpoint(options.wsEndpoint);
      return options.wsEndpoint;
    }

    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 9222;
    const url = `http://${host}:${port}/json/version`;
    this.ensureLocalEndpoint(url);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch CDP endpoint from ${url}`);
    }

    const data = await response.json() as { webSocketDebuggerUrl?: string };
    if (!data.webSocketDebuggerUrl) {
      throw new Error("webSocketDebuggerUrl missing from /json/version response");
    }

    this.ensureLocalEndpoint(data.webSocketDebuggerUrl);

    return data.webSocketDebuggerUrl;
  }

  private ensureLocalEndpoint(endpoint: string): void {
    if (this.config.security.allowNonLocalCdp) return;
    
    const ALLOWED_PROTOCOLS = new Set(["ws:", "wss:", "http:", "https:"]);
    const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new Error("Invalid CDP endpoint URL.");
    }
    
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(`Disallowed protocol "${parsed.protocol}" for CDP endpoint. Allowed: ws, wss, http, https.`);
    }
    
    const hostname = parsed.hostname.toLowerCase();
    if (!LOCAL_HOSTNAMES.has(hostname) && !hostname.toLowerCase().startsWith("::ffff:127.")) {
      throw new Error("Non-local CDP endpoints are disabled by default.");
    }
  }

  private async connectWithEndpoint(
    connectWsEndpoint: string,
    mode: BrowserMode,
    reportedWsEndpoint?: string
  ): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string }> {
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(connectWsEndpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("401") || message.toLowerCase().includes("unauthorized")) {
        throw new Error("Relay /cdp rejected the connection (unauthorized). Check relayToken configuration and ensure clients use the current token.");
      }
      throw error;
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
      }

      const refStore = new RefStore();
      const snapshotter = new Snapshotter(refStore);
      const consoleTracker = new ConsoleTracker(200, { showFullConsole: this.config.devtools.showFullConsole });
      const networkTracker = new NetworkTracker(300, { showFullUrls: this.config.devtools.showFullUrls });

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
        networkTracker
      };

      this.store.add({ id: sessionId, mode, browser, context });
      this.sessions.set(sessionId, managed);
      this.attachTrackers(managed);
      this.attachRefInvalidation(managed);

      const wsEndpoint = reportedWsEndpoint ?? connectWsEndpoint;
      return { sessionId, mode, activeTargetId: targets.getActiveTargetId(), warnings: [], wsEndpoint };
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
    const baseUrl = new URL(wsEndpoint);
    baseUrl.search = "";
    baseUrl.hash = "";

    const httpProtocol = baseUrl.protocol === "wss:" ? "https:" : "http:";
    const configBase = new URL(`${httpProtocol}//${baseUrl.hostname}:${baseUrl.port}`);
    const configUrl = new URL("/config", configBase);
    this.ensureLocalEndpoint(configUrl.toString());

    const configResponse = await fetch(configUrl.toString());
    if (!configResponse.ok) {
      throw new Error("Failed to fetch relay config. Ensure the relay is running and reachable.");
    }
    const config = await configResponse.json() as { relayPort?: number; pairingRequired?: boolean; instanceId?: string };
    const relayPort = typeof config.relayPort === "number" ? config.relayPort : null;
    if (!relayPort || relayPort <= 0 || relayPort > 65535) {
      throw new Error("Relay config missing relayPort. Ensure the relay is running.");
    }

    const relayWsBase = new URL(`${baseUrl.protocol}//${baseUrl.hostname}:${relayPort}/cdp`);
    const reportedEndpoint = this.sanitizeWsEndpointForOutput(relayWsBase.toString());

    const pairingRequired = Boolean(config.pairingRequired);
    if (!pairingRequired) {
      return { connectEndpoint: relayWsBase.toString(), reportedEndpoint };
    }

    const pairBase = new URL(`${httpProtocol}//${baseUrl.hostname}:${relayPort}`);
    const pairUrl = new URL("/pair", pairBase);
    this.ensureLocalEndpoint(pairUrl.toString());

    const pairResponse = await fetch(pairUrl.toString());
    if (!pairResponse.ok) {
      throw new Error("Failed to fetch relay pairing token. Ensure the relay is running.");
    }
    const pairData = await pairResponse.json() as { token?: string; instanceId?: string };
    if (config.instanceId && typeof pairData.instanceId === "string" && pairData.instanceId !== config.instanceId) {
      throw new Error("Relay pairing mismatch detected. Restart the plugin and retry.");
    }
    if (!pairData.token || typeof pairData.token !== "string") {
      throw new Error("Relay pairing token missing from /pair response.");
    }

    const connectUrl = new URL(relayWsBase.toString());
    connectUrl.searchParams.set("token", pairData.token);
    return { connectEndpoint: connectUrl.toString(), reportedEndpoint };
  }

  private sanitizeWsEndpointForOutput(wsEndpoint: string): string {
    try {
      const url = new URL(wsEndpoint);
      url.searchParams.delete("token");
      url.searchParams.delete("pairingToken");
      url.hash = "";
      const value = url.toString();
      return value.replace(/\?$/, "");
    } catch {
      return wsEndpoint;
    }
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

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, maxChars), truncated: true };
}
