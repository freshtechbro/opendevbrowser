import { describe, it, expect, vi } from "vitest";
import { TargetManager } from "../src/browser/target-manager";

const createPage = (title: string, url: string) => ({
  title: async () => title,
  url: () => url,
  close: async () => undefined
});

describe("TargetManager", () => {
  it("registers pages and switches active target", async () => {
    const manager = new TargetManager();
    const page1 = createPage("One", "https://one");
    const page2 = createPage("Two", "https://two");

    const id1 = manager.registerPage(page1 as never);
    const id2 = manager.registerPage(page2 as never);

    expect(manager.getActiveTargetId()).toBe(id1);
    manager.setActiveTarget(id2);
    expect(manager.getActiveTargetId()).toBe(id2);

    const targets = await manager.listTargets(true);
    expect(targets.length).toBe(2);
  });

  it("closes targets", async () => {
    const manager = new TargetManager();
    const page1 = createPage("One", "https://one");
    const id1 = manager.registerPage(page1 as never);

    await manager.closeTarget(id1);
    expect(manager.getActiveTargetId()).toBe(null);
  });

  it("throws on unknown targets", () => {
    const manager = new TargetManager();
    expect(() => manager.setActiveTarget("missing")).toThrow("Unknown targetId");
    expect(() => manager.getPage("missing")).toThrow("Unknown targetId");
    expect(() => manager.getActivePage()).toThrow("No active target");
  });

  it("throws when active target is missing", () => {
    const manager = new TargetManager();
    const page = createPage("One", "https://one");
    const id1 = manager.registerPage(page as never);

    (manager as { targets: Map<string, unknown> }).targets.delete(id1);
    expect(() => manager.getActivePage()).toThrow("Missing active target");
  });

  it("handles title lookup errors", async () => {
    const manager = new TargetManager();
    const page = {
      title: async () => {
        throw new Error("fail");
      },
      url: () => {
        throw new Error("fail");
      },
      close: async () => undefined
    };

    manager.registerPage(page as never);
    const targets = await manager.listTargets(true);
    expect(targets[0].title).toBeUndefined();
    expect(targets[0].url).toBeUndefined();
  });

  it("tracks named pages", async () => {
    const manager = new TargetManager();
    const page = createPage("Named", "https://named");

    const id = manager.registerPage(page as never, "main");
    expect(manager.getTargetIdByName("main")).toBe(id);
    expect(manager.getName(id)).toBe("main");

    const list = manager.listNamedTargets();
    expect(list).toEqual([{ name: "main", targetId: id }]);
  });

  it("removes name mappings when closing targets", async () => {
    const manager = new TargetManager();
    const page = createPage("Named", "https://named");
    const id = manager.registerPage(page as never, "main");

    await manager.closeTarget(id);
    expect(manager.getTargetIdByName("main")).toBeNull();
  });

  it("rejects duplicate page names", () => {
    const manager = new TargetManager();
    const page1 = createPage("One", "https://one");
    const page2 = createPage("Two", "https://two");

    manager.registerPage(page1 as never, "main");
    const id2 = manager.registerPage(page2 as never);
    expect(() => manager.setName(id2, "main")).toThrow("Name already in use");
  });

  it("validates and renames target names", () => {
    const manager = new TargetManager();
    const page = createPage("One", "https://one");
    const id = manager.registerPage(page as never);

    expect(() => manager.setName(id, "   ")).toThrow("Name must be non-empty");
    expect(() => manager.setName("missing", "main")).toThrow("Unknown targetId");

    manager.setName(id, "main");
    manager.setName(id, "secondary");
    expect(manager.getTargetIdByName("main")).toBeNull();
    expect(manager.getTargetIdByName("secondary")).toBe(id);
  });

  it("ignores missing names and skips url lookups when excluded", async () => {
    const manager = new TargetManager();
    const page = {
      title: async () => "Title",
      url: vi.fn(() => {
        throw new Error("no url");
      }),
      close: async () => undefined
    };

    manager.registerPage(page as never, "main");
    manager.removeName("missing");
    manager.removeName("main");
    expect(manager.getTargetIdByName("main")).toBeNull();

    const targets = await manager.listTargets(false);
    expect(targets[0].url).toBeUndefined();
  });
});
