import { describe, expect, it, vi } from "vitest";
import { TargetManager } from "../src/browser/target-manager";

function createStubPage(
  label: string,
  overrides: Partial<{
    isClosed: () => boolean;
    title: () => Promise<string>;
    url: () => Promise<string>;
    close: () => Promise<void>;
  }> = {}
) {
  return {
    isClosed: overrides.isClosed ?? vi.fn(() => false),
    title: overrides.title ?? vi.fn(async () => label),
    url: overrides.url ?? vi.fn(async () => `https://example.com/${label}`),
    close: overrides.close ?? vi.fn(async () => undefined)
  };
}

describe("TargetManager", () => {
  it("registers pages, tracks the active target, and lists urls when requested", async () => {
    const manager = new TargetManager();
    const page1 = createStubPage("one");
    const page2 = createStubPage("two");

    const id1 = manager.registerPage(page1 as never);
    manager.registerExistingPages([page2 as never]);

    const id2 = manager.listPageEntries().find((entry) => entry.page === (page2 as never))?.targetId;

    expect(id2).toBeTruthy();
    expect(manager.getActiveTargetId()).toBe(id1);
    manager.setActiveTarget(id2 ?? "");
    expect(manager.getActiveTargetId()).toBe(id2);
    expect(manager.getActivePage()).toBe(page2);

    const targets = await manager.listTargets(true);
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: id1,
        title: "one",
        url: "https://example.com/one",
        type: "page"
      }),
      expect.objectContaining({
        targetId: id2,
        title: "two",
        url: "https://example.com/two",
        type: "page"
      })
    ]));
  });

  it("validates, renames, lists, and removes target names", () => {
    const manager = new TargetManager();
    const page1 = createStubPage("named-one");
    const page2 = createStubPage("named-two");
    const id1 = manager.registerPage(page1 as never);
    const id2 = manager.registerPage(page2 as never);

    expect(() => manager.setName(id1, "   ")).toThrow("Name must be non-empty");
    expect(() => manager.setName("missing", "main")).toThrow("Unknown targetId: missing");

    manager.setName(id1, " main ");
    expect(manager.getTargetIdByName("main")).toBe(id1);
    expect(manager.getTargetIdByName(" main ")).toBe(id1);
    expect(manager.getName(id1)).toBe("main");
    expect(manager.getName("missing")).toBeNull();

    expect(() => manager.setName(id2, "main")).toThrow("Name already in use: main");

    manager.setName(id1, "secondary");
    expect(manager.getTargetIdByName("main")).toBeNull();
    expect(manager.getTargetIdByName("secondary")).toBe(id1);
    expect(manager.listNamedTargets()).toEqual([{ name: "secondary", targetId: id1 }]);

    manager.removeName(" secondary ");
    expect(manager.getTargetIdByName("secondary")).toBeNull();
    manager.removeName("missing");
    expect(manager.getName(id1)).toBeNull();
  });

  it("throws for unknown targets and missing active pages", () => {
    const manager = new TargetManager();
    const page = createStubPage("only");
    const id = manager.registerPage(page as never);

    expect(() => manager.setActiveTarget("missing")).toThrow("Unknown targetId: missing");
    expect(() => manager.getPage("missing")).toThrow("Unknown targetId: missing");

    const internal = manager as unknown as { activeTargetId: string | null; targets: Map<string, unknown> };
    internal.activeTargetId = null;
    expect(() => manager.getActivePage()).toThrow("No active target");

    internal.activeTargetId = id;
    internal.targets.delete(id);
    expect(() => manager.getActivePage()).toThrow(`Missing active target: ${id}`);
  });

  it("keeps the requested target id when rebinding to an already-registered page", () => {
    const manager = new TargetManager();
    const primaryPage = createStubPage("primary");
    const replacementPage = createStubPage("replacement");
    const primaryTargetId = manager.registerPage(primaryPage as never);
    const replacementTargetId = manager.registerPage(replacementPage as never);

    manager.replacePage(primaryTargetId, replacementPage as never);

    expect(manager.getPage(primaryTargetId)).toBe(replacementPage);
    expect(() => manager.getPage(replacementTargetId)).toThrow(`Unknown targetId: ${replacementTargetId}`);
    expect(manager.getActiveTargetId()).toBe(primaryTargetId);
  });

  it("preserves an existing target name when rebinding to a named replacement page", () => {
    const manager = new TargetManager();
    const primaryPage = createStubPage("primary");
    const replacementPage = createStubPage("replacement");
    const primaryTargetId = manager.registerPage(primaryPage as never, "primary");
    const replacementTargetId = manager.registerPage(replacementPage as never, "replacement");

    manager.setActiveTarget(replacementTargetId);
    manager.replacePage(primaryTargetId, replacementPage as never);

    expect(manager.getPage(primaryTargetId)).toBe(replacementPage);
    expect(manager.getTargetIdByName("primary")).toBe(primaryTargetId);
    expect(manager.getTargetIdByName("replacement")).toBeNull();
    expect(manager.getName(primaryTargetId)).toBe("primary");
    expect(manager.getActiveTargetId()).toBe(primaryTargetId);
  });

  it("adopts an existing replacement name when the requested target has none", () => {
    const manager = new TargetManager();
    const unnamedPage = createStubPage("unnamed");
    const namedReplacement = createStubPage("named-replacement");
    const unnamedTargetId = manager.registerPage(unnamedPage as never);
    const replacementTargetId = manager.registerPage(namedReplacement as never, "replacement");

    manager.setActiveTarget(replacementTargetId);
    manager.replacePage(unnamedTargetId, namedReplacement as never);

    expect(manager.getPage(unnamedTargetId)).toBe(namedReplacement);
    expect(manager.getTargetIdByName("replacement")).toBe(unnamedTargetId);
    expect(manager.getName(unnamedTargetId)).toBe("replacement");
    expect(() => manager.getPage(replacementTargetId)).toThrow(`Unknown targetId: ${replacementTargetId}`);
    expect(manager.getActiveTargetId()).toBe(unnamedTargetId);
  });

  it("can create a target slot while rebinding after target state is rebuilt", () => {
    const manager = new TargetManager();
    const reboundPage = createStubPage("rebound");

    manager.replacePage("target-rebound", reboundPage as never);

    expect(manager.getPage("target-rebound")).toBe(reboundPage);
    expect(manager.getActiveTargetId()).toBe("target-rebound");
  });

  it("skips url lookups when includeUrls is false and tolerates closed or rejected reads", async () => {
    const manager = new TargetManager();
    const closedPage = createStubPage("closed", {
      isClosed: vi.fn(() => true)
    });
    const brokenPage = createStubPage("broken", {
      title: vi.fn(async () => {
        throw new Error("title failed");
      }),
      url: vi.fn(async () => {
        throw new Error("url failed");
      })
    });

    manager.registerPage(closedPage as never);
    manager.registerPage(brokenPage as never);

    const withoutUrls = await manager.listTargets(false);
    expect(withoutUrls).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: undefined, url: undefined }),
      expect.objectContaining({ title: undefined, url: undefined })
    ]));
    expect(brokenPage.url).not.toHaveBeenCalled();

    const withUrls = await manager.listTargets(true);
    expect(withUrls).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: undefined, url: undefined }),
      expect.objectContaining({ title: undefined, url: undefined })
    ]));
    expect(brokenPage.url).toHaveBeenCalledTimes(1);
  });

  it("falls back to undefined metadata when page closure probes throw", async () => {
    const manager = new TargetManager();
    const unstablePage = createStubPage("unstable", {
      isClosed: vi.fn(() => {
        throw new Error("isClosed failed");
      })
    });

    manager.registerPage(unstablePage as never);

    const targets = await manager.listTargets(true);
    expect(targets).toEqual([
      expect.objectContaining({
        title: undefined,
        url: undefined
      })
    ]);
  });

  it("closes targets, clears names, and reassigns the active target", async () => {
    const manager = new TargetManager();
    const page1 = createStubPage("one");
    const page2 = createStubPage("two");
    const id1 = manager.registerPage(page1 as never, "main");
    const id2 = manager.registerPage(page2 as never, "secondary");
    manager.setActiveTarget(id1);

    await manager.closeTarget(id1);

    expect(page1.close).toHaveBeenCalledTimes(1);
    expect(manager.getTargetIdByName("main")).toBeNull();
    expect(manager.getActiveTargetId()).toBe(id2);
    expect(manager.getActivePage()).toBe(page2);

    await manager.closeTarget(id2);
    expect(manager.getActiveTargetId()).toBeNull();
    expect(manager.listPageEntries()).toEqual([]);
  });

  it("cleans up targets even when close throws", async () => {
    const manager = new TargetManager();
    const page = createStubPage("broken-close", {
      close: vi.fn(async () => {
        throw new Error("close failed");
      })
    });
    const id = manager.registerPage(page as never, "broken");

    await expect(manager.closeTarget(id)).rejects.toThrow("close failed");
    expect(manager.getActiveTargetId()).toBeNull();
    expect(manager.getTargetIdByName("broken")).toBeNull();
  });

  it("syncs pages by removing closed or missing entries, cleaning names, and registering new pages", () => {
    const manager = new TargetManager();
    const retained = createStubPage("retained");
    const removedClosed = createStubPage("removed-closed", {
      isClosed: vi.fn(() => true)
    });
    const added = createStubPage("added");

    const retainedId = manager.registerPage(retained as never, "retained");
    const removedId = manager.registerPage(removedClosed as never, "removed");
    manager.setActiveTarget(removedId);

    manager.syncPages([retained as never, added as never]);

    const pages = manager.listPageEntries();
    const addedEntry = pages.find((entry) => entry.page === (added as never));

    expect(manager.getTargetIdByName("removed")).toBeNull();
    expect(manager.getName(removedId)).toBeNull();
    expect(manager.getTargetIdByName("retained")).toBe(retainedId);
    expect(pages.map((entry) => entry.page)).toEqual(expect.arrayContaining([retained as never, added as never]));
    expect(manager.getActiveTargetId()).toBe(retainedId);
    expect(addedEntry?.targetId).toBeTruthy();

    manager.syncPages([]);
    expect(manager.listPageEntries()).toEqual([]);
    expect(manager.getTargetIdByName("retained")).toBeNull();
    expect(manager.getActiveTargetId()).toBeNull();
  });

  it("tracks popup ownership metadata and removes it with closed targets", async () => {
    const manager = new TargetManager();
    const opener = createStubPage("opener");
    const popup = createStubPage("popup", {
      url: vi.fn(async () => "https://accounts.example.com/oauth/private?token=redacted")
    });
    const openerId = manager.registerPage(opener as never);
    const popupId = manager.registerPage(popup as never, undefined, {
      openerTargetId: openerId,
      lifecycleState: "open",
      popupKind: "oauth_or_account_chooser",
      ownershipSource: "cdp_target_event",
      safeUrlSummary: {
        scheme: "https",
        host: "accounts.example.com",
        origin: "https://accounts.example.com"
      }
    });

    const listed = await manager.listTargets(false);
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: popupId,
        openerTargetId: openerId,
        lifecycleState: "open",
        popupKind: "oauth_or_account_chooser",
        ownershipSource: "cdp_target_event"
      })
    ]));
    expect(listed.find((target) => target.targetId === popupId)?.url).toBeUndefined();
    expect(listed.find((target) => target.targetId === popupId)?.safeUrlSummary).toBeUndefined();
    expect(JSON.stringify(listed)).not.toContain("token=redacted");

    await expect(manager.listTargets(true)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: popupId,
        safeUrlSummary: {
          scheme: "https",
          host: "accounts.example.com",
          origin: "https://accounts.example.com"
        }
      })
    ]));

    await manager.closeTarget(popupId);
    expect(manager.getTargetMetadata(popupId)).toBeNull();
  });

  it("sets and merges target metadata with default ownership and formatted optional fields", async () => {
    const manager = new TargetManager();
    const page = createStubPage("metadata");
    const targetId = manager.registerPage(page as never);

    expect(() => manager.setTargetMetadata("missing", {
      ownershipSource: "manual"
    })).toThrow("Unknown targetId: missing");
    expect(() => manager.mergeTargetMetadata("missing", {
      ownershipSource: "manual"
    })).toThrow("Unknown targetId: missing");

    manager.mergeTargetMetadata(targetId, {
      cdpTargetId: "cdp-1",
      openerCdpTargetId: "cdp-root",
      openerTargetId: "root",
      lifecycleState: "open",
      popupKind: "popup",
      safeUrlSummary: {
        scheme: "https",
        host: "example.com",
        origin: "https://example.com"
      }
    });

    expect(manager.getTargetMetadata(targetId)).toEqual({
      ownershipSource: "manual",
      cdpTargetId: "cdp-1",
      openerCdpTargetId: "cdp-root",
      openerTargetId: "root",
      lifecycleState: "open",
      popupKind: "popup",
      safeUrlSummary: {
        scheme: "https",
        host: "example.com",
        origin: "https://example.com"
      }
    });
    await expect(manager.listTargets(false)).resolves.toEqual([
      expect.objectContaining({
        cdpTargetId: "cdp-1",
        openerCdpTargetId: "cdp-root",
        openerTargetId: "root",
        lifecycleState: "open",
        popupKind: "popup",
        ownershipSource: "manual"
      })
    ]);
    await expect(manager.listTargets(true)).resolves.toEqual([
      expect.objectContaining({
        safeUrlSummary: {
          scheme: "https",
          host: "example.com",
          origin: "https://example.com"
        }
      })
    ]);

    manager.setTargetMetadata(targetId, {
      ownershipSource: "action_sync"
    });

    await expect(manager.listTargets(false)).resolves.toEqual([
      expect.objectContaining({
        ownershipSource: "action_sync"
      })
    ]);
  });

  it("carries metadata forward when rebinding to a page that already had metadata", () => {
    const manager = new TargetManager();
    const primaryPage = createStubPage("primary");
    const replacementPage = createStubPage("replacement");
    const primaryTargetId = manager.registerPage(primaryPage as never);
    const replacementTargetId = manager.registerPage(replacementPage as never, undefined, {
      cdpTargetId: "replacement-cdp",
      lifecycleState: "open",
      ownershipSource: "cdp_target_event"
    });

    manager.replacePage(primaryTargetId, replacementPage as never);

    expect(manager.getTargetMetadata(primaryTargetId)).toEqual({
      cdpTargetId: "replacement-cdp",
      lifecycleState: "open",
      ownershipSource: "cdp_target_event"
    });
    expect(manager.getTargetMetadata(replacementTargetId)).toBeNull();
  });

  it("lets replacement page metadata win when rebinding over stale metadata", () => {
    const manager = new TargetManager();
    const primaryPage = createStubPage("primary");
    const replacementPage = createStubPage("replacement");
    const primaryTargetId = manager.registerPage(primaryPage as never, undefined, {
      cdpTargetId: "stale-cdp",
      lifecycleState: "open",
      ownershipSource: "manual"
    });
    const replacementTargetId = manager.registerPage(replacementPage as never, undefined, {
      cdpTargetId: "replacement-cdp",
      openerCdpTargetId: "root-cdp",
      lifecycleState: "open",
      popupKind: "popup",
      ownershipSource: "cdp_target_event"
    });

    manager.replacePage(primaryTargetId, replacementPage as never);

    expect(manager.getTargetMetadata(primaryTargetId)).toEqual({
      cdpTargetId: "replacement-cdp",
      openerCdpTargetId: "root-cdp",
      lifecycleState: "open",
      popupKind: "popup",
      ownershipSource: "cdp_target_event"
    });
    expect(manager.getTargetMetadata(replacementTargetId)).toBeNull();
  });

  it("applies sync metadata only to new pages and cleans stale metadata", () => {
    const manager = new TargetManager();
    const retained = createStubPage("retained");
    const removed = createStubPage("removed");
    const popup = createStubPage("popup");
    const retainedId = manager.registerPage(retained as never);
    const removedId = manager.registerPage(removed as never, undefined, {
      openerTargetId: retainedId,
      lifecycleState: "open",
      popupKind: "popup",
      ownershipSource: "manual"
    });

    manager.syncPages([retained as never, popup as never], {
      newTargetMetadata: {
        openerTargetId: retainedId,
        lifecycleState: "open",
        popupKind: "popup",
        ownershipSource: "action_sync"
      }
    });

    const popupEntry = manager.listPageEntries().find((entry) => entry.page === (popup as never));
    expect(manager.getTargetMetadata(retainedId)).toBeNull();
    expect(manager.getTargetMetadata(removedId)).toBeNull();
    expect(popupEntry?.targetId).toBeTruthy();
    expect(manager.getTargetMetadata(popupEntry?.targetId ?? "")).toEqual({
      openerTargetId: retainedId,
      lifecycleState: "open",
      popupKind: "popup",
      ownershipSource: "action_sync"
    });
  });
});
