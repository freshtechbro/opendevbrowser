// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { RefStore } from "../src/snapshot/refs";
import { Snapshotter, selectorFunction } from "../src/snapshot/snapshotter";
import { selectorFunction as extensionSelectorFunction } from "../extension/src/ops/snapshot-shared";

type HappyDomSettings = {
  fetch: {
    interceptor: unknown;
  };
};

const getHappyDomSettings = (): HappyDomSettings | null => {
  const happyDom = window as unknown as { happyDOM?: { settings: HappyDomSettings } };
  return happyDom.happyDOM?.settings ?? null;
};

let originalInterceptor: unknown = null;

beforeAll(() => {
  const settings = getHappyDomSettings();
  if (!settings) return;
  originalInterceptor = settings.fetch.interceptor;
  settings.fetch.interceptor = {
    beforeAsyncRequest: async () => new Response("", { status: 200 })
  };
});

afterAll(() => {
  const settings = getHappyDomSettings();
  if (!settings) return;
  settings.fetch.interceptor = originalInterceptor;
});

type AxNode = {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: unknown };
  chromeRole?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
  backendDOMNodeId?: number;
  frameId?: string;
};

const createSession = (
  nodes: AxNode[],
  options?: { missingObjectIds?: Set<number>; emptySelectors?: Set<number>; rawNodes?: unknown }
) => {
  let lastBackendNodeId = 0;
  return {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Accessibility.getFullAXTree") {
        return { nodes: typeof options?.rawNodes !== "undefined" ? options.rawNodes : nodes };
      }
      if (method === "DOM.resolveNode") {
        const backendNodeId = typeof params?.backendNodeId === "number" ? params.backendNodeId : 0;
        lastBackendNodeId = backendNodeId;
        if (options?.missingObjectIds?.has(backendNodeId)) {
          return { object: {} };
        }
        return { object: { objectId: `obj-${backendNodeId}` } };
      }
      if (method === "Runtime.callFunctionOn") {
        if (options?.emptySelectors?.has(lastBackendNodeId)) {
          return { result: { value: " " } };
        }
        return { result: { value: `#node-${lastBackendNodeId}` } };
      }
      return {};
    }),
    detach: vi.fn(async () => undefined)
  };
};

const createPage = (
  nodes: AxNode[],
  options?: { failUrl?: boolean; failTitle?: boolean; missingObjectIds?: Set<number>; emptySelectors?: Set<number>; rawNodes?: AxNode[] | null }
) => {
  const session = createSession(nodes, options);
  return {
    context: () => ({
      newCDPSession: async () => session
    }),
    url: () => {
      if (options?.failUrl) {
        throw new Error("url fail");
      }
      return "https://example.com";
    },
    title: async () => {
      if (options?.failTitle) {
        throw new Error("title fail");
      }
      return "Example";
    }
  };
};

describe("Snapshotter", () => {
  it("formats and paginates snapshot output", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "button" }, name: { value: "password" }, backendDOMNodeId: 101 },
      { nodeId: "2", role: { value: "link" }, name: { value: "Home" }, backendDOMNodeId: 102 },
      { nodeId: "3", role: { value: "heading" }, name: { value: "Title" }, backendDOMNodeId: 103 }
    ];

    const refStore = new RefStore();
    const snapshotter = new Snapshotter(refStore);
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-1", {
      mode: "outline",
      maxChars: 30
    });

    expect(result.content).toContain("\"password\"");
    expect(result.truncated).toBe(true);
    expect(result.nextCursor).toBe("1");
  });

  it("returns full snapshot when under limit", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 201 }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-2", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.truncated).toBe(false);
    expect(result.nextCursor).toBeUndefined();
    expect(result.refCount).toBe(1);
  });

  it("handles invalid cursor values", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "link" }, name: { value: "token_abcdefghijklmnopqrstuvwxyz0123456789" }, backendDOMNodeId: 301 },
      { nodeId: "2", role: { value: "link" }, name: { value: "Next" }, backendDOMNodeId: 302 }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-3", {
      mode: "outline",
      maxChars: 200,
      cursor: "-1"
    });

    expect(result.content).toContain("[redacted]");
    expect(result.truncated).toBe(false);
  });

  it("renders type, disabled, and checked flags", async () => {
    const nodes: AxNode[] = [
      {
        nodeId: "1",
        role: { value: "checkbox" },
        name: { value: "Option" },
        backendDOMNodeId: 401,
        properties: [
          { name: "disabled", value: { value: true } },
          { name: "checked", value: { value: true } }
        ]
      }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-4", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.content).toContain("disabled");
    expect(result.content).toContain("checked");
  });

  it("respects positive cursor offsets", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "link" }, name: { value: "First" }, backendDOMNodeId: 501 },
      { nodeId: "2", role: { value: "link" }, name: { value: "Second" }, backendDOMNodeId: 502 }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-5", {
      mode: "outline",
      maxChars: 200,
      cursor: "1"
    });

    expect(result.content).toContain("Second");
    expect(result.content).not.toContain("First");
  });

  it("ignores empty names", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "link" }, name: { value: "   " }, backendDOMNodeId: 601 }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-6", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.content).not.toContain("\"\"");
  });

  it("omits url and title when page queries fail", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 701 }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes, { failTitle: true, failUrl: true });

    const result = await snapshotter.snapshot(page as never, "target-7", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.url).toBeUndefined();
    expect(result.title).toBeUndefined();
  });

  it("filters non-actionable roles in actionables mode", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 801 },
      { nodeId: "2", role: { value: "heading" }, name: { value: "Title" }, backendDOMNodeId: 802 }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-8", {
      mode: "actionables",
      maxChars: 200
    });

    expect(result.content).toContain("button");
    expect(result.content).not.toContain("heading");
    expect(result.refCount).toBe(1);
  });

  it("skips ignored nodes and uses chromeRole fallback", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", ignored: true, role: { value: "button" }, backendDOMNodeId: 901 },
      { nodeId: "2", role: { value: "" }, chromeRole: { value: "link" }, name: { value: "Doc" }, backendDOMNodeId: 902 },
      { nodeId: "3", role: { value: "heading" } },
      { nodeId: "4", role: { value: "" }, chromeRole: { value: "" }, backendDOMNodeId: 903 },
      { nodeId: "5", role: { value: "generic" }, name: { value: "Skip" }, backendDOMNodeId: 904 }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-9", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.refCount).toBe(1);
    expect(result.content).toContain("link");
    expect(result.content).toContain("Doc");
    expect(result.content).not.toContain("Skip");
  });

  it("skips nodes when selector resolution fails", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 1001 },
      { nodeId: "2", role: { value: "link" }, name: { value: "Skip" }, backendDOMNodeId: 1002 }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes, { missingObjectIds: new Set([1002]) });

    const result = await snapshotter.snapshot(page as never, "target-10", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.refCount).toBe(1);
    expect(result.content).toContain("OK");
    expect(result.content).not.toContain("Skip");
  });

  it("includes value and handles disabled/checked flags from strings and numbers", async () => {
    const nodes: AxNode[] = [
      {
        nodeId: "1",
        role: { value: "checkbox" },
        name: { value: "Option" },
        value: { value: true },
        backendDOMNodeId: 1101,
        properties: [
          { name: "disabled", value: { value: "true" } },
          { name: "checked", value: { value: 1 } }
        ]
      }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-11", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.content).toContain("disabled");
    expect(result.content).toContain("checked");
    expect(result.content).toContain("value=\"true\"");
  });

  it("skips nodes when selector is empty", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "button" }, name: { value: "Hidden" }, backendDOMNodeId: 1201 }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes, { emptySelectors: new Set([1201]) });

    const result = await snapshotter.snapshot(page as never, "target-12", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.refCount).toBe(0);
    expect(result.content).not.toContain("Hidden");
  });

  it("caps snapshot output at the max node limit", async () => {
    const nodes: AxNode[] = Array.from({ length: 401 }, (_, index) => ({
      nodeId: String(index + 1),
      role: { value: "button" },
      name: { value: `Node ${index + 1}` },
      backendDOMNodeId: 2000 + index
    }));

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-14", {
      mode: "outline",
      maxChars: 50000,
      maxNodes: 400
    });

    expect(result.refCount).toBe(400);
  });

  it("handles non-array AX tree responses", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2101 }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes, { rawNodes: null });

    const result = await snapshotter.snapshot(page as never, "target-15", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.refCount).toBe(0);
  });

  it("redacts empty values", async () => {
    const nodes: AxNode[] = [
      {
        nodeId: "1",
        role: { value: "link" },
        name: { value: "   " },
        value: { value: "   " },
        backendDOMNodeId: 2201
      }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-16", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.content).not.toContain("value=");
  });

  it("ignores complex values for value and properties", async () => {
    const nodes: AxNode[] = [
      {
        nodeId: "1",
        role: { value: "button" },
        name: { value: "Complex" },
        value: { value: { nested: true } },
        backendDOMNodeId: 1301,
        properties: [
          { name: "disabled", value: { value: { nested: true } } }
        ]
      }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-13", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.content).toContain("Complex");
    expect(result.content).not.toContain("disabled");
    expect(result.content).not.toContain("value=");
  });

  it("warns when iframe nodes are skipped", async () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: { value: "button" }, name: { value: "Main" }, backendDOMNodeId: 3001 },
      { nodeId: "2", role: { value: "button" }, name: { value: "Frame" }, backendDOMNodeId: 3002, frameId: "frame-1" }
    ];

    const snapshotter = new Snapshotter(new RefStore());
    const page = createPage(nodes);

    const result = await snapshotter.snapshot(page as never, "target-17", {
      mode: "outline",
      maxChars: 200
    });

    expect(result.warnings?.[0]).toContain("Skipped 1 iframe");
  });

  it("prefers unique test-id/aria selectors and falls back for collisions", () => {
    document.body.innerHTML = `
      <div id="root">
        <button data-testid="cta">Buy</button>
        <button aria-label="Close">Close</button>
        <button id="primary">Primary</button>
        <div><span>Nested</span></div>
        <section>
          <button data-testid="dup">First</button>
          <button data-testid="dup">Second</button>
          <button aria-label="dup-label">Third</button>
          <button aria-label="dup-label">Fourth</button>
        </section>
      </div>
    `;

    const testId = document.querySelector("[data-testid=\"cta\"]") as Element;
    const aria = document.querySelector("[aria-label=\"Close\"]") as Element;
    const idButton = document.querySelector("#primary") as Element;
    const nested = document.querySelector("#root div span") as Element;
    const duplicateTestId = document.querySelector("section button[data-testid=\"dup\"]") as Element;
    const duplicateAria = document.querySelector("section button[aria-label=\"dup-label\"]") as Element;

    expect(selectorFunction.call(testId)).toBe("[data-testid=\"cta\"]");
    expect(selectorFunction.call(aria)).toBe("[aria-label=\"Close\"]");
    expect(selectorFunction.call(idButton)).toBe("button#primary");
    expect(selectorFunction.call(nested)).toContain("div:nth-child");

    const duplicateTestSelector = selectorFunction.call(duplicateTestId);
    expect(duplicateTestSelector).not.toBe("[data-testid=\"dup\"]");
    expect(duplicateTestSelector).toContain(":nth-child");

    const duplicateAriaSelector = selectorFunction.call(duplicateAria);
    expect(duplicateAriaSelector).not.toBe("[aria-label=\"dup-label\"]");
    expect(duplicateAriaSelector).toContain(":nth-child");

    expect(extensionSelectorFunction.call(testId)).toBe("[data-testid=\"cta\"]");
    expect(extensionSelectorFunction.call(duplicateTestId)).toBe(duplicateTestSelector);
    expect(extensionSelectorFunction.call(duplicateAria)).toBe(duplicateAriaSelector);
  });

  it("falls back to manual escaping when CSS.escape is unavailable", () => {
    const originalCSS = globalThis.CSS;
    // @ts-expect-error allow removing CSS for fallback path
    delete globalThis.CSS;

    const element = document.createElement("div");
    element.setAttribute("data-testid", "hello world");
    document.body.appendChild(element);
    const selector = selectorFunction.call(element);

    expect(selector).toBe("[data-testid=\"hello\\ world\"]");

    element.remove();
    globalThis.CSS = originalCSS;
  });

  it("builds selector when element has no parent", () => {
    const element = document.createElement("span");
    const selector = selectorFunction.call(element);
    expect(selector).toBe("span");
  });

  it("returns null when selector helper is called with a non-element receiver", () => {
    const selector = selectorFunction.call({} as Element);
    expect(selector).toBeNull();
  });

  it("falls back to path selector when id selector is not unique", () => {
    document.body.innerHTML = `
      <div>
        <button id="dup-id">One</button>
        <button id="dup-id">Two</button>
      </div>
    `;
    const duplicateId = document.querySelector("button#dup-id") as Element;
    const selector = selectorFunction.call(duplicateId);
    expect(selector).not.toBe("button#dup-id");
    expect(selector).toContain(":nth-child");
  });
});
