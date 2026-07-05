import { randomUUID } from "crypto";
import type { Page } from "playwright-core";
import {
  buildSafeTargetUrlSummary,
  type TargetLifecycleState,
  type TargetOwnershipMetadata,
  type TargetOwnershipSource,
  type TargetPopupKind,
  type TargetSafeUrlSummary
} from "./cdp-target-ownership";

export type TargetInfo = {
  targetId: string;
  title?: string;
  url?: string;
  type: "page";
  cdpTargetId?: string;
  openerCdpTargetId?: string;
  openerTargetId?: string;
  lifecycleState?: TargetLifecycleState;
  popupKind?: TargetPopupKind;
  ownershipSource?: TargetOwnershipSource;
  safeUrlSummary?: TargetSafeUrlSummary;
};

export type NamedTargetInfo = {
  name: string;
  targetId: string;
};

const TARGET_INFO_TIMEOUT_MS = 2000;

export type TargetSyncOptions = {
  newTargetMetadata?: TargetOwnershipMetadata;
  newTargetMetadataForPage?: (page: Page) => TargetOwnershipMetadata | undefined;
};

export class TargetManager {
  private targets = new Map<string, Page>();
  private activeTargetId: string | null = null;
  private nameToTarget = new Map<string, string>();
  private targetToName = new Map<string, string>();
  private targetMetadata = new Map<string, TargetOwnershipMetadata>();

  registerPage(page: Page, name?: string, metadata?: TargetOwnershipMetadata): string {
    const targetId = randomUUID();
    this.targets.set(targetId, page);
    if (metadata) {
      this.targetMetadata.set(targetId, metadata);
    }
    if (!this.activeTargetId) {
      this.activeTargetId = targetId;
    }
    if (name) {
      this.setName(targetId, name);
    }
    return targetId;
  }

  registerExistingPages(pages: Page[]): void {
    for (const page of pages) {
      this.registerPage(page);
    }
  }

  setTargetMetadata(targetId: string, metadata: TargetOwnershipMetadata): void {
    if (!this.targets.has(targetId)) {
      throw new Error(`Unknown targetId: ${targetId}`);
    }
    this.targetMetadata.set(targetId, metadata);
  }

  mergeTargetMetadata(targetId: string, metadata: Partial<TargetOwnershipMetadata>): void {
    if (!this.targets.has(targetId)) {
      throw new Error(`Unknown targetId: ${targetId}`);
    }
    const current = this.targetMetadata.get(targetId);
    this.targetMetadata.set(targetId, {
      ownershipSource: current?.ownershipSource ?? metadata.ownershipSource ?? "manual",
      ...current,
      ...metadata
    });
  }

  getTargetMetadata(targetId: string): TargetOwnershipMetadata | null {
    return this.targetMetadata.get(targetId) ?? null;
  }

  setName(targetId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Name must be non-empty");
    }
    if (!this.targets.has(targetId)) {
      throw new Error(`Unknown targetId: ${targetId}`);
    }
    const existing = this.nameToTarget.get(trimmed);
    if (existing && existing !== targetId) {
      throw new Error(`Name already in use: ${trimmed}`);
    }
    const previousName = this.targetToName.get(targetId);
    if (previousName && previousName !== trimmed) {
      this.nameToTarget.delete(previousName);
    }
    this.nameToTarget.set(trimmed, targetId);
    this.targetToName.set(targetId, trimmed);
  }

  getTargetIdByName(name: string): string | null {
    return this.nameToTarget.get(name.trim()) ?? null;
  }

  getName(targetId: string): string | null {
    return this.targetToName.get(targetId) ?? null;
  }

  listNamedTargets(): NamedTargetInfo[] {
    return Array.from(this.nameToTarget.entries()).map(([name, targetId]) => ({
      name,
      targetId
    }));
  }

  removeName(name: string): void {
    const trimmed = name.trim();
    const targetId = this.nameToTarget.get(trimmed);
    if (targetId) {
      this.nameToTarget.delete(trimmed);
      this.targetToName.delete(targetId);
    }
  }

  setActiveTarget(targetId: string): void {
    if (!this.targets.has(targetId)) {
      throw new Error(`Unknown targetId: ${targetId}`);
    }
    this.activeTargetId = targetId;
  }

  getActiveTargetId(): string | null {
    return this.activeTargetId;
  }

  getActivePage(): Page {
    if (!this.activeTargetId) {
      throw new Error("No active target");
    }
    const page = this.targets.get(this.activeTargetId);
    if (!page) {
      throw new Error(`Missing active target: ${this.activeTargetId}`);
    }
    return page;
  }

  getPage(targetId: string): Page {
    const page = this.targets.get(targetId);
    if (!page) {
      throw new Error(`Unknown targetId: ${targetId}`);
    }
    return page;
  }

  replacePage(targetId: string, page: Page): void {
    const previousName = this.targetToName.get(targetId) ?? null;

    for (const [existingTargetId, existingPage] of this.targets.entries()) {
      if (existingTargetId === targetId || existingPage !== page) {
        continue;
      }
      this.targets.delete(existingTargetId);
      const existingMetadata = this.targetMetadata.get(existingTargetId) ?? null;
      this.targetMetadata.delete(existingTargetId);
      if (existingMetadata) {
        this.targetMetadata.set(targetId, existingMetadata);
      }
      const existingName = this.targetToName.get(existingTargetId) ?? null;
      if (existingName) {
        this.nameToTarget.delete(existingName);
        this.targetToName.delete(existingTargetId);
        if (!previousName) {
          this.nameToTarget.set(existingName, targetId);
          this.targetToName.set(targetId, existingName);
        }
      }
      if (this.activeTargetId === existingTargetId) {
        this.activeTargetId = targetId;
      }
    }

    this.targets.set(targetId, page);
    if (!this.activeTargetId) {
      this.activeTargetId = targetId;
    }
  }

  async listTargets(includeUrls = false): Promise<TargetInfo[]> {
    const entries = Array.from(this.targets.entries());
    return Promise.all(entries.map(async ([targetId, page]) => {
      const metadata = this.targetMetadata.get(targetId) ?? null;
      const info: TargetInfo = {
        targetId,
        title: undefined,
        url: undefined,
        type: "page",
        ...formatTargetMetadata(metadata, includeUrls)
      };

      try {
        if (!page.isClosed()) {
          info.title = await readWithTimeout(() => page.title());
        }
      } catch {
        info.title = undefined;
      }

      if (includeUrls) {
        try {
          if (!page.isClosed()) {
            info.url = await readWithTimeout(async () => page.url());
            info.safeUrlSummary = metadata?.safeUrlSummary ?? buildSafeTargetUrlSummary(info.url);
          }
        } catch {
          info.url = undefined;
        }
      }

      return info;
    }));
  }

  async closeTarget(targetId: string): Promise<void> {
    const page = this.getPage(targetId);
    let closeError: unknown;
    try {
      await page.close();
    } catch (error) {
      closeError = error;
    } finally {
      this.targets.delete(targetId);
      this.targetMetadata.delete(targetId);
      const name = this.targetToName.get(targetId);
      if (name) {
        this.nameToTarget.delete(name);
        this.targetToName.delete(targetId);
      }

      if (this.activeTargetId === targetId) {
        const remaining = Array.from(this.targets.keys());
        this.activeTargetId = remaining[0] ?? null;
      }
    }

    if (closeError) {
      throw closeError;
    }
  }

  listPageEntries(): Array<{ targetId: string; page: Page }> {
    return Array.from(this.targets.entries()).map(([targetId, page]) => ({
      targetId,
      page
    }));
  }

  syncPages(pages: Page[], options: TargetSyncOptions = {}): void {
    const current = new Set(pages);

    for (const [targetId, page] of this.targets.entries()) {
      if (page.isClosed() || !current.has(page)) {
        this.targets.delete(targetId);
        this.targetMetadata.delete(targetId);
        const name = this.targetToName.get(targetId);
        if (name) {
          this.nameToTarget.delete(name);
          this.targetToName.delete(targetId);
        }
      }
    }

    for (const page of pages) {
      let exists = false;
      for (const existing of this.targets.values()) {
        if (existing === page) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        const metadata = options.newTargetMetadataForPage?.(page) ?? options.newTargetMetadata;
        this.registerPage(page, undefined, metadata);
      }
    }

    if (this.activeTargetId && !this.targets.has(this.activeTargetId)) {
      this.activeTargetId = this.targets.keys().next().value ?? null;
    }
  }
}

function formatTargetMetadata(metadata: TargetOwnershipMetadata | null, includeUrlSummaries: boolean): Partial<TargetInfo> {
  if (!metadata) {
    return {};
  }
  return {
    ...(metadata.cdpTargetId ? { cdpTargetId: metadata.cdpTargetId } : {}),
    ...(metadata.openerCdpTargetId ? { openerCdpTargetId: metadata.openerCdpTargetId } : {}),
    ...(metadata.openerTargetId ? { openerTargetId: metadata.openerTargetId } : {}),
    ...(metadata.lifecycleState ? { lifecycleState: metadata.lifecycleState } : {}),
    ...(metadata.popupKind ? { popupKind: metadata.popupKind } : {}),
    ownershipSource: metadata.ownershipSource,
    ...(includeUrlSummaries && metadata.safeUrlSummary ? { safeUrlSummary: metadata.safeUrlSummary } : {})
  };
}

const readWithTimeout = async <T>(reader: () => Promise<T>, timeoutMs: number = TARGET_INFO_TIMEOUT_MS): Promise<T | undefined> => {
  return await new Promise<T | undefined>((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), timeoutMs);
    reader().then((value) => {
      clearTimeout(timeoutId);
      resolve(value);
    }).catch(() => {
      clearTimeout(timeoutId);
      resolve(undefined);
    });
  });
};
