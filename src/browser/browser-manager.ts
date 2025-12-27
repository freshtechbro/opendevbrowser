import { randomUUID } from "crypto";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
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
  private worktree: string;
  private config: OpenDevBrowserConfig;
  private pageListeners = new WeakMap<Page, () => void>();

  constructor(worktree: string, config: OpenDevBrowserConfig) {
    this.worktree = worktree;
    this.config = config;
  }

  updateConfig(config: OpenDevBrowserConfig): void {
    this.config = config;
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

    const context = await chromium.launchPersistentContext(profileDir, {
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
    const consoleTracker = new ConsoleTracker();
    const networkTracker = new NetworkTracker();

    const managed: ManagedSession = {
      sessionId,
      mode: "A",
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

    this.store.add({ id: sessionId, mode: "A", browser, context });
    this.sessions.set(sessionId, managed);

    this.attachTrackers(managed);
    this.attachRefInvalidation(managed);

    const wsEndpointProvider = browser as unknown as { wsEndpoint?: () => string };
    const wsEndpoint = typeof wsEndpointProvider.wsEndpoint === "function"
      ? wsEndpointProvider.wsEndpoint()
      : undefined;

    return { sessionId, mode: "A", activeTargetId, warnings, wsEndpoint: wsEndpoint || undefined };
  }

  async connect(options: ConnectOptions): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string }> {
    const wsEndpoint = await this.resolveWsEndpoint(options);
    return this.connectWithEndpoint(wsEndpoint, "B");
  }

  async connectRelay(wsEndpoint: string): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string }> {
    this.ensureLocalEndpoint(wsEndpoint);
    return this.connectWithEndpoint(wsEndpoint, "C");
  }

  async disconnect(sessionId: string, closeBrowser = false): Promise<void> {
    const managed = this.getManaged(sessionId);
    if (closeBrowser) {
      await managed.browser.close();
    } else {
      await managed.context.close();
    }
    managed.consoleTracker.detach();
    managed.networkTracker.detach();
    if (!managed.persistProfile && managed.profileDir) {
      await rm(managed.profileDir, { recursive: true, force: true });
    }
    this.sessions.delete(sessionId);
    this.store.delete(sessionId);
  }

  async status(sessionId: string): Promise<{ mode: BrowserMode; activeTargetId: string | null; url?: string; title?: string }> {
    const managed = this.getManaged(sessionId);
    const activeTargetId = managed.targets.getActiveTargetId();
    const page = activeTargetId ? managed.targets.getPage(activeTargetId) : null;
    let title: string | undefined;
    let url: string | undefined;
    try {
      title = page ? await page.title() : undefined;
    } catch {
      title = undefined;
    }
    try {
      url = page ? page.url() : undefined;
    } catch {
      url = undefined;
    }

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
    let title: string | undefined;
    let finalUrl: string | undefined;
    try {
      title = await page.title();
    } catch {
      title = undefined;
    }
    try {
      finalUrl = page.url();
    } catch {
      finalUrl = undefined;
    }

    return { targetId, created, url: finalUrl, title };
  }

  async listPages(sessionId: string): Promise<{ pages: Array<{ name: string; targetId: string; url?: string; title?: string }> }> {
    const managed = this.getManaged(sessionId);
    const named = managed.targets.listNamedTargets();
    const pages: Array<{ name: string; targetId: string; url?: string; title?: string }> = [];

    for (const entry of named) {
      const page = managed.targets.getPage(entry.targetId);
      let title: string | undefined;
      let url: string | undefined;
      try {
        title = await page.title();
      } catch {
        title = undefined;
      }
      try {
        url = page.url();
      } catch {
        url = undefined;
      }
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
    let title: string | undefined;
    try {
      title = await page.title();
    } catch {
      title = undefined;
    }

    return {
      activeTargetId: targetId,
      url: page.url(),
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

  async snapshot(sessionId: string, mode: "outline" | "actionables", maxChars: number, cursor?: string): Promise<ReturnType<Snapshotter["snapshot"]>> {
    const managed = this.getManaged(sessionId);
    const targetId = managed.targets.getActiveTargetId();
    if (!targetId) {
      throw new Error("No active target for snapshot");
    }
    const page = managed.targets.getActivePage();
    return managed.snapshotter.snapshot(page, targetId, { mode, maxChars, cursor });
  }

  async click(sessionId: string, ref: string): Promise<{ timingMs: number; navigated: boolean }> {
    const startTime = Date.now();
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const page = managed.targets.getActivePage();
    const previousUrl = page.url();
    await page.locator(selector).click();
    const navigated = page.url() !== previousUrl;
    return { timingMs: Date.now() - startTime, navigated };
  }

  async type(sessionId: string, ref: string, text: string, clear = false, submit = false): Promise<{ timingMs: number }> {
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

  async clonePage(sessionId: string): Promise<ReactExport> {
    const managed = this.getManaged(sessionId);
    const page = managed.targets.getActivePage();
    const capture = await captureDom(page, "body");
    const css = extractCss(capture);
    return emitReactComponent(capture, css);
  }

  async cloneComponent(sessionId: string, ref: string): Promise<ReactExport> {
    const managed = this.getManaged(sessionId);
    const selector = this.resolveSelector(managed, ref);
    const capture = await captureDom(managed.targets.getActivePage(), selector);
    const css = extractCss(capture);
    return emitReactComponent(capture, css);
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

  consolePoll(sessionId: string, sinceSeq?: number, max = 50): { events: ReturnType<ConsoleTracker["poll"]>["events"]; nextSeq: number } {
    const managed = this.getManaged(sessionId);
    return managed.consoleTracker.poll(sinceSeq, max);
  }

  networkPoll(sessionId: string, sinceSeq?: number, max = 50): { events: ReturnType<NetworkTracker["poll"]>["events"]; nextSeq: number } {
    const managed = this.getManaged(sessionId);
    return managed.networkTracker.poll(sinceSeq, max);
  }

  private buildOverrideSession(input: { browser: Browser; context: BrowserContext; targets: TargetManager }): ManagedSession {
    const refStore = new RefStore();
    return {
      sessionId: "override",
      mode: "A",
      browser: input.browser,
      context: input.context,
      profileDir: "",
      persistProfile: true,
      targets: input.targets,
      refStore,
      snapshotter: new Snapshotter(refStore),
      consoleTracker: new ConsoleTracker(),
      networkTracker: new NetworkTracker()
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

    return data.webSocketDebuggerUrl;
  }

  private ensureLocalEndpoint(endpoint: string): void {
    if (this.config.security.allowNonLocalCdp) return;
    const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    let hostname: string;
    try {
      const parsed = new URL(endpoint);
      hostname = parsed.hostname;
    } catch {
      throw new Error("Invalid CDP endpoint URL.");
    }
    if (!LOCAL_HOSTNAMES.has(hostname) && !hostname.startsWith("::ffff:127.")) {
      throw new Error("Non-local CDP endpoints are disabled by default.");
    }
  }

  private async connectWithEndpoint(wsEndpoint: string, mode: BrowserMode): Promise<{ sessionId: string; mode: BrowserMode; activeTargetId: string | null; warnings: string[]; wsEndpoint?: string }> {
    const browser = await chromium.connectOverCDP(wsEndpoint);
    const contexts = browser.contexts();
    const context = contexts[0] ?? await browser.newContext();

    const sessionId = randomUUID();
    const targets = new TargetManager();
    const pages = context.pages();

    if (pages.length === 0) {
      const page = await context.newPage();
      targets.registerPage(page);
    } else {
      targets.registerExistingPages(pages);
    }

    const refStore = new RefStore();
    const snapshotter = new Snapshotter(refStore);
    const consoleTracker = new ConsoleTracker();
    const networkTracker = new NetworkTracker();

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

    return { sessionId, mode, activeTargetId: targets.getActiveTargetId(), warnings: [], wsEndpoint };
  }
}

function truncateHtml(value: string, maxChars: number): { outerHTML: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { outerHTML: value, truncated: false };
  }
  return { outerHTML: value.slice(0, maxChars), truncated: true };
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, maxChars), truncated: true };
}
