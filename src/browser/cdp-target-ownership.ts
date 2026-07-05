export type TargetPopupKind = "popup" | "oauth_or_account_chooser" | "unknown";

export type TargetOwnershipSource =
  | "cdp_target_event"
  | "playwright_popup"
  | "action_sync"
  | "manual";

export type TargetLifecycleState = "open" | "closed" | "detached";

export type TargetSafeUrlSummary = {
  scheme: "http" | "https" | "about" | "data" | "other";
  host?: string;
  origin?: string;
};

export type CdpTargetOwnershipSession = {
  send: (method: string, params?: Record<string, boolean>) => Promise<unknown>;
  detach: () => Promise<void>;
  on: (event: string, listener: (payload: unknown) => void) => void;
  off?: (event: string, listener: (payload: unknown) => void) => void;
  removeListener?: (event: string, listener: (payload: unknown) => void) => void;
};

export type TargetOwnershipMetadata = {
  cdpTargetId?: string;
  openerCdpTargetId?: string;
  openerTargetId?: string;
  lifecycleState?: TargetLifecycleState;
  popupKind?: TargetPopupKind;
  ownershipSource: TargetOwnershipSource;
  safeUrlSummary?: TargetSafeUrlSummary;
};

export type CdpTargetOwnershipEntry = {
  cdpTargetId: string;
  openerCdpTargetId?: string;
  type?: string;
  url?: string;
  title?: string;
  lifecycleState: TargetLifecycleState;
};

export function buildSafeTargetUrlSummary(url: string | undefined): TargetSafeUrlSummary | undefined {
  if (!url) {
    return undefined;
  }
  if (url.startsWith("about:")) {
    return { scheme: "about" };
  }
  if (url.startsWith("data:")) {
    return { scheme: "data" };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return {
        scheme: parsed.protocol === "https:" ? "https" : "http",
        host: parsed.hostname,
        origin: parsed.origin
      };
    }
  } catch {
    return { scheme: "other" };
  }
  return { scheme: "other" };
}

export function inferTargetPopupKind(input: { url?: string; title?: string }): TargetPopupKind {
  const haystack = `${input.url ?? ""} ${input.title ?? ""}`.toLowerCase();
  if (
    haystack.includes("oauth")
    || haystack.includes("account")
    || haystack.includes("signin")
    || haystack.includes("sign in")
    || haystack.includes("login")
    || haystack.includes("accounts.google.")
  ) {
    return "oauth_or_account_chooser";
  }
  return "popup";
}

export class CdpTargetOwnershipGraph {
  private readonly targets = new Map<string, CdpTargetOwnershipEntry>();
  private readonly sessionToTarget = new Map<string, string>();
  private readonly listeners: Array<{ event: string; listener: (payload: unknown) => void }> = [];

  constructor(
    private readonly session: CdpTargetOwnershipSession,
    private readonly onChange: () => void
  ) {}

  async start(): Promise<void> {
    this.addListener("Target.targetCreated", (payload) => this.upsertFromPayload(payload, "open"));
    this.addListener("Target.targetInfoChanged", (payload) => this.upsertFromPayload(payload, "open"));
    this.addListener("Target.targetDestroyed", (payload) => this.removeTarget(payload));
    this.addListener("Target.attachedToTarget", (payload) => this.upsertAttachedTarget(payload));
    this.addListener("Target.detachedFromTarget", (payload) => this.removeTarget(payload));
    await this.session.send("Target.setDiscoverTargets", { discover: true });
    await this.seedExistingTargets();
  }

  entries(): CdpTargetOwnershipEntry[] {
    return [...this.targets.values()];
  }

  async close(): Promise<void> {
    for (const item of this.listeners) {
      this.removeListener(item.event, item.listener);
    }
    this.listeners.length = 0;
    await this.session.detach();
  }

  private addListener(event: string, listener: (payload: unknown) => void): void {
    this.session.on(event, listener);
    this.listeners.push({ event, listener });
  }

  private async seedExistingTargets(): Promise<void> {
    try {
      const response = await this.session.send("Target.getTargets");
      if (!isRecord(response) || !Array.isArray(response.targetInfos)) {
        return;
      }
      for (const targetInfo of response.targetInfos) {
        this.upsertFromPayload({ targetInfo }, "open");
      }
    } catch {
      return;
    }
  }

  private removeListener(event: string, listener: (payload: unknown) => void): void {
    if (this.session.off) {
      this.session.off(event, listener);
      return;
    }
    this.session.removeListener?.(event, listener);
  }

  private upsertFromPayload(payload: unknown, lifecycleState: TargetLifecycleState): void {
    const targetInfo = readTargetInfo(payload);
    if (!targetInfo) {
      return;
    }
    const previous = this.targets.get(targetInfo.targetId);
    this.targets.set(targetInfo.targetId, {
      cdpTargetId: targetInfo.targetId,
      lifecycleState,
      ...(targetInfo.openerId ?? previous?.openerCdpTargetId ? { openerCdpTargetId: targetInfo.openerId ?? previous?.openerCdpTargetId } : {}),
      ...(targetInfo.type ?? previous?.type ? { type: targetInfo.type ?? previous?.type } : {}),
      ...(targetInfo.url ?? previous?.url ? { url: targetInfo.url ?? previous?.url } : {}),
      ...(targetInfo.title ?? previous?.title ? { title: targetInfo.title ?? previous?.title } : {})
    });
    this.onChange();
  }

  private upsertAttachedTarget(payload: unknown): void {
    if (!isRecord(payload) || typeof payload.sessionId !== "string") {
      return;
    }
    const targetInfo = readTargetInfo(payload);
    if (!targetInfo) {
      return;
    }
    this.sessionToTarget.set(payload.sessionId, targetInfo.targetId);
    this.upsertFromPayload(payload, "open");
  }

  private removeTarget(payload: unknown): void {
    const targetId = this.readTargetId(payload);
    if (!targetId) {
      return;
    }
    this.targets.delete(targetId);
    for (const [sessionId, sessionTargetId] of this.sessionToTarget.entries()) {
      if (sessionTargetId === targetId) {
        this.sessionToTarget.delete(sessionId);
      }
    }
    this.onChange();
  }

  private readTargetId(payload: unknown): string | null {
    if (!isRecord(payload)) {
      return null;
    }
    if (typeof payload.targetId === "string" && payload.targetId.length > 0) {
      return payload.targetId;
    }
    if (typeof payload.sessionId === "string" && payload.sessionId.length > 0) {
      return this.sessionToTarget.get(payload.sessionId) ?? null;
    }
    return null;
  }
}

export function metadataFromCdpTargetEntry(
  entry: CdpTargetOwnershipEntry,
  openerTargetId?: string
): TargetOwnershipMetadata {
  const hasOpener = typeof entry.openerCdpTargetId === "string" || typeof openerTargetId === "string";
  return {
    cdpTargetId: entry.cdpTargetId,
    ...(entry.openerCdpTargetId ? { openerCdpTargetId: entry.openerCdpTargetId } : {}),
    ...(openerTargetId ? { openerTargetId } : {}),
    lifecycleState: entry.lifecycleState,
    ...(hasOpener ? { popupKind: inferTargetPopupKind({ url: entry.url, title: entry.title }) } : {}),
    ownershipSource: "cdp_target_event",
    ...(entry.url ? { safeUrlSummary: buildSafeTargetUrlSummary(entry.url) } : {})
  };
}

function readTargetInfo(payload: unknown): {
  targetId: string;
  openerId?: string;
  type?: string;
  url?: string;
  title?: string;
} | null {
  if (!isRecord(payload) || !isRecord(payload.targetInfo)) {
    return null;
  }
  const info = payload.targetInfo;
  if (typeof info.targetId !== "string" || info.targetId.length === 0) {
    return null;
  }
  return {
    targetId: info.targetId,
    ...(typeof info.openerId === "string" && info.openerId.length > 0 ? { openerId: info.openerId } : {}),
    ...(typeof info.type === "string" && info.type.length > 0 ? { type: info.type } : {}),
    ...(typeof info.url === "string" && info.url.length > 0 ? { url: info.url } : {}),
    ...(typeof info.title === "string" && info.title.length > 0 ? { title: info.title } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
