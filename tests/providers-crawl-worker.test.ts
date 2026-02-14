import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (payload?: unknown) => void;

const createHarness = async (options?: {
  throwOnConstruct?: boolean;
  isMainThread?: boolean;
}) => {
  vi.resetModules();

  class FakeWorker {
    readonly listeners: Record<string, Listener[]> = {
      message: [],
      error: [],
      exit: []
    };

    readonly postMessage = vi.fn((_: unknown) => undefined);
    readonly terminate = vi.fn(async () => 0);

    on(event: "message" | "error" | "exit", handler: Listener): this {
      this.listeners[event].push(handler);
      return this;
    }

    emit(event: "message" | "error" | "exit", payload?: unknown): void {
      for (const handler of this.listeners[event]) {
        handler(payload);
      }
    }
  }

  const instances: FakeWorker[] = [];
  let constructCalls = 0;
  class Worker {
    constructor() {
      constructCalls += 1;
      if (options?.throwOnConstruct) {
        throw new Error("spawn-failed");
      }
      const worker = new FakeWorker();
      instances.push(worker);
      return worker;
    }
  }

  vi.doMock("node:worker_threads", () => ({
    Worker,
    isMainThread: options?.isMainThread ?? true
  }));

  const mod = await import("../src/providers/web/crawl-worker");
  return {
    mod,
    instances,
    getConstructCalls: () => constructCalls
  };
};

afterEach(() => {
  vi.doUnmock("node:worker_threads");
  vi.resetModules();
  vi.clearAllMocks();
});

describe("crawl worker pool", () => {
  it("falls back inline when worker emits malformed payloads", async () => {
    const { mod, instances } = await createHarness();
    const pool = mod.createCrawlWorkerPool({ workerThreads: 1, queueMax: 4 });

    const first = pool.extract({
      url: "https://example.com",
      html: "<html><body><h1>Hello</h1></body></html>",
      selectors: ["h1"]
    });

    const worker = instances[0];
    expect(worker).toBeDefined();

    worker?.emit("message", { ok: true });
    await expect(first).resolves.toMatchObject({
      text: "Hello",
      selectors: { h1: ["Hello"] }
    });

    const second = pool.extract({
      url: "https://example.com/two",
      html: "<html><body><p>Second</p></body></html>",
      selectors: ["p"]
    });

    worker?.emit("message", {
      id: 2,
      ok: true,
      extracted: {
        text: "Second",
        links: ["https://example.com/two", 1, null],
        selectors: { p: ["Second", 1] }
      }
    });

    await expect(second).resolves.toEqual({
      text: "Second",
      links: ["https://example.com/two"],
      selectors: { p: ["Second"] }
    });

    await pool.close();
  });

  it("enforces queue limits and overflows deterministically", async () => {
    const { mod, instances } = await createHarness();
    const pool = mod.createCrawlWorkerPool({ workerThreads: 1, queueMax: 2 });

    const first = pool.extract({
      url: "https://queue.example/1",
      html: "<html><body>one</body></html>",
      selectors: []
    });
    const second = pool.extract({
      url: "https://queue.example/2",
      html: "<html><body>two</body></html>",
      selectors: []
    });

    await expect(pool.extract({
      url: "https://queue.example/3",
      html: "<html><body>three</body></html>",
      selectors: []
    })).rejects.toThrow("crawl_worker_queue_overflow:2");

    const worker = instances[0];
    worker?.emit("message", {
      id: 1,
      ok: true,
      extracted: { text: "one", links: [], selectors: {} }
    });
    worker?.emit("message", {
      id: 2,
      ok: true,
      extracted: { text: "two", links: [], selectors: {} }
    });

    await expect(first).resolves.toMatchObject({ text: "one" });
    await expect(second).resolves.toMatchObject({ text: "two" });
    await pool.close();
  });

  it("falls back inline when postMessage throws and when workers fail", async () => {
    const { mod, instances } = await createHarness();
    const pool = mod.createCrawlWorkerPool({ workerThreads: 1, queueMax: 4 });
    const worker = instances[0];

    worker?.postMessage.mockImplementationOnce(() => {
      throw new Error("post failed");
    });

    const postThrow = await pool.extract({
      url: "https://post.example/fallback",
      html: "<html><body><h2>Post throw</h2></body></html>",
      selectors: ["h2"]
    });
    expect(postThrow.selectors.h2).toEqual(["Post throw"]);

    const inFlight = pool.extract({
      url: "https://fail.example/active",
      html: "<html><body>active</body></html>",
      selectors: []
    });
    const queued = pool.extract({
      url: "https://fail.example/queued",
      html: "<html><body>queued</body></html>",
      selectors: []
    });

    worker?.emit("error", new Error("boom"));

    await expect(inFlight).resolves.toMatchObject({ text: "active" });
    await expect(queued).resolves.toMatchObject({ text: "queued" });

    const inlineAfterFailure = await pool.extract({
      url: "https://fail.example/after",
      html: "<html><body>after</body></html>",
      selectors: []
    });
    expect(inlineAfterFailure.text).toContain("after");

    await pool.close();
  });

  it("rejects queued and in-flight work on close and rejects extract after close", async () => {
    const { mod } = await createHarness();
    const pool = mod.createCrawlWorkerPool({ workerThreads: 1, queueMax: 4 });

    const inFlight = pool.extract({
      url: "https://close.example/one",
      html: "<html><body>one</body></html>",
      selectors: []
    });
    const queued = pool.extract({
      url: "https://close.example/two",
      html: "<html><body>two</body></html>",
      selectors: []
    });

    await pool.close();

    await expect(inFlight).rejects.toThrow("crawl_worker_pool_closed");
    await expect(queued).rejects.toThrow("crawl_worker_pool_closed");
    await expect(pool.extract({
      url: "https://close.example/three",
      html: "<html><body>three</body></html>",
      selectors: []
    })).rejects.toThrow("crawl_worker_pool_closed");
  });

  it("supports inline-only mode and constructor fallback when workers are unavailable", async () => {
    const inlineHarness = await createHarness({ isMainThread: false });
    const inlinePool = inlineHarness.mod.createCrawlWorkerPool({ workerThreads: 2, queueMax: 2 });
    const inlineResult = await inlinePool.extract({
      url: "https://inline.example",
      html: "<html><body><a href=\"/next\">n</a></body></html>",
      selectors: ["a"]
    });
    expect(inlineResult.links).toEqual(["https://inline.example/next"]);
    await inlinePool.close();

    const spawnFailureHarness = await createHarness({ throwOnConstruct: true });
    const fallbackPool = spawnFailureHarness.mod.createCrawlWorkerPool({ workerThreads: 1, queueMax: 2 });
    const fallbackResult = await fallbackPool.extract({
      url: "https://spawn.example",
      html: "<html><body><p>spawn-fallback</p></body></html>",
      selectors: ["p"]
    });
    expect(fallbackResult.selectors.p).toEqual(["spawn-fallback"]);
    expect(spawnFailureHarness.getConstructCalls()).toBeGreaterThan(0);
    await fallbackPool.close();
  });

  it("exports inline extraction helper", async () => {
    const { mod } = await createHarness();
    expect(mod.extractCrawlContentInline({
      url: "https://helper.example",
      html: "<html><body><h3>helper</h3></body></html>",
      selectors: ["h3"]
    })).toEqual({
      text: "helper",
      links: [],
      selectors: { h3: ["helper"] }
    });
  });

  it("covers internal parser and worker-handler edge branches", async () => {
    const { mod } = await createHarness();
    const pool = mod.createCrawlWorkerPool({ workerThreads: 1, queueMax: 2 });
    const internals = pool as unknown as {
      workers: Array<{ busy: boolean; taskId?: number }>;
      queue: unknown[];
      parseWorkerResponse: (message: unknown) => unknown;
      handleWorkerMessage: (handle: { busy: boolean; taskId?: number }, message: unknown) => void;
      handleWorkerFailure: (handle: { busy: boolean; taskId?: number }, error: unknown) => void;
    };

    expect(internals.parseWorkerResponse(null)).toBeNull();
    expect(internals.parseWorkerResponse({})).toBeNull();
    expect(internals.parseWorkerResponse({ id: 1, ok: true })).toBeNull();
    expect(internals.parseWorkerResponse({
      id: 1,
      ok: true,
      extracted: {
        text: 1,
        links: [],
        selectors: {}
      }
    })).toBeNull();
    expect(internals.parseWorkerResponse({
      id: 1,
      ok: true,
      extracted: {
        text: "ok",
        links: [],
        selectors: null
      }
    })).toBeNull();
    expect(internals.parseWorkerResponse({
      id: 1,
      ok: false,
      error: 123
    })).toEqual({
      id: 1,
      ok: false,
      error: "worker_parse_failed"
    });

    const handle = internals.workers[0];
    expect(handle).toBeDefined();

    if (handle) {
      internals.handleWorkerMessage(handle, { id: 999, ok: true, extracted: { text: "x", links: [], selectors: {} } });
    }

    if (handle) {
      handle.taskId = undefined;
      handle.busy = true;
      internals.handleWorkerMessage(handle, { nonsense: true });
      expect(handle.busy).toBe(false);
    }

    internals.queue.push(undefined as unknown);
    if (handle) {
      internals.handleWorkerFailure(handle, "failure");
      expect(handle.busy).toBe(false);
    }

    await pool.close();
  });

  it("covers worker helper exports and idempotent close/dispatch branches", async () => {
    const { mod } = await createHarness({ isMainThread: true });
    const defaultsPool = mod.createCrawlWorkerPool();
    const helpers = mod.__test__ as {
      supportsWorkerThreads: () => boolean;
      toError: (error: unknown, fallback: string) => Error;
    };

    expect(typeof helpers.supportsWorkerThreads()).toBe("boolean");
    const wrapped = helpers.toError("boom", "fallback");
    expect(wrapped.message).toBe("boom");
    const existing = new Error("existing");
    expect(helpers.toError(existing, "fallback")).toBe(existing);

    const internals = defaultsPool as unknown as {
      closed: boolean;
      dispatch: () => void;
    };
    await defaultsPool.close();
    await defaultsPool.close();
    expect(internals.closed).toBe(true);
    expect(() => internals.dispatch()).not.toThrow();
  });

  it("covers toError fallback, parse branches, and multi-worker failure recovery paths", async () => {
    const { mod, instances } = await createHarness();
    const helpers = mod.__test__ as {
      toError: (error: unknown, fallback: string) => Error;
    };
    expect(helpers.toError(undefined, "fallback").message).toBe("fallback");

    const pool = mod.createCrawlWorkerPool({ workerThreads: 2, queueMax: 4 });
    const internals = pool as unknown as {
      parseWorkerResponse: (message: unknown) => unknown;
    };

    expect(internals.parseWorkerResponse({
      id: 1,
      ok: true,
      extracted: {
        text: "ok",
        links: "not-array",
        selectors: {}
      }
    })).toBeNull();

    expect(internals.parseWorkerResponse({
      id: 1,
      ok: true,
      extracted: {
        text: "ok",
        links: [],
        selectors: {
          p: "not-array"
        }
      }
    })).toEqual({
      id: 1,
      ok: true,
      extracted: {
        text: "ok",
        links: [],
        selectors: {
          p: []
        }
      }
    });

    expect(internals.parseWorkerResponse({
      id: 2,
      ok: false,
      error: "worker-failed"
    })).toEqual({
      id: 2,
      ok: false,
      error: "worker-failed"
    });

    const first = pool.extract({
      url: "https://multi.example/one",
      html: "<html><body>one</body></html>",
      selectors: []
    });
    const second = pool.extract({
      url: "https://multi.example/two",
      html: "<html><body>two</body></html>",
      selectors: []
    });

    const workerOne = instances[0];
    const workerTwo = instances[1];
    expect(workerOne).toBeDefined();
    expect(workerTwo).toBeDefined();

    workerOne?.emit("error", new Error("worker-one-down"));
    workerTwo?.emit("message", {
      id: 2,
      ok: true,
      extracted: {
        text: "two",
        links: [],
        selectors: {}
      }
    });

    await expect(first).resolves.toMatchObject({ text: "one" });
    await expect(second).resolves.toMatchObject({ text: "two" });
    await pool.close();
  });

  it("covers mapped in-flight task resolution on direct worker failure handling", async () => {
    const { mod } = await createHarness();
    const pool = mod.createCrawlWorkerPool({ workerThreads: 1, queueMax: 2 });
    const internals = pool as unknown as {
      workers: Array<{ busy: boolean; taskId?: number }>;
      inFlight: Map<number, {
        id: number;
        input: { url: string; html: string; selectors: string[] };
        resolve: (value: { text: string }) => void;
        reject: (reason: unknown) => void;
      }>;
      handleWorkerFailure: (handle: { busy: boolean; taskId?: number }, error: unknown) => void;
    };

    const handle = internals.workers[0];
    expect(handle).toBeDefined();

    let resolvedText = "";
    internals.inFlight.set(77, {
      id: 77,
      input: {
        url: "https://mapped.example",
        html: "<html><body>mapped-task</body></html>",
        selectors: []
      },
      resolve: (value) => {
        resolvedText = value.text;
      },
      reject: () => undefined
    });

    if (handle) {
      handle.taskId = 77;
      handle.busy = true;
      internals.handleWorkerFailure(handle, new Error("direct-worker-failure"));
    }

    expect(resolvedText).toBe("mapped-task");
    await pool.close();
  });

  it("covers stale task-id worker failure branch when in-flight task is missing", async () => {
    const { mod } = await createHarness();
    const pool = mod.createCrawlWorkerPool({ workerThreads: 1, queueMax: 2 });
    const internals = pool as unknown as {
      workers: Array<{ busy: boolean; taskId?: number }>;
      inFlight: Map<number, unknown>;
      handleWorkerFailure: (handle: { busy: boolean; taskId?: number }, error: unknown) => void;
    };

    const handle = internals.workers[0];
    expect(handle).toBeDefined();
    if (handle) {
      handle.taskId = 999;
      handle.busy = true;
      expect(internals.inFlight.has(999)).toBe(false);
      internals.handleWorkerFailure(handle, new Error("stale-task-id"));
      expect(handle.busy).toBe(false);
    }

    await pool.close();
  });
});
