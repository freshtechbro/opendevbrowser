import { describe, it, expect, vi } from "vitest";
import { ScriptRunner } from "../src/browser/script-runner";

const createManager = () => ({
  goto: vi.fn().mockResolvedValue({ ok: true }),
  waitForRef: vi.fn().mockResolvedValue({ ok: true }),
  waitForLoad: vi.fn().mockResolvedValue({ ok: true }),
  snapshot: vi.fn().mockResolvedValue({ content: "snap" }),
  click: vi.fn().mockResolvedValue({ ok: true }),
  hover: vi.fn().mockResolvedValue({ ok: true }),
  press: vi.fn().mockResolvedValue({ ok: true }),
  check: vi.fn().mockResolvedValue({ ok: true }),
  uncheck: vi.fn().mockResolvedValue({ ok: true }),
  type: vi.fn().mockResolvedValue({ ok: true }),
  select: vi.fn().mockResolvedValue({ ok: true }),
  scroll: vi.fn().mockResolvedValue({ ok: true }),
  scrollIntoView: vi.fn().mockResolvedValue({ ok: true }),
  domGetHtml: vi.fn().mockResolvedValue({ outerHTML: "<div/>", truncated: false }),
  domGetText: vi.fn().mockResolvedValue({ text: "hello", truncated: false }),
  domGetAttr: vi.fn().mockResolvedValue({ value: "attr" }),
  domGetValue: vi.fn().mockResolvedValue({ value: "value" }),
  domIsVisible: vi.fn().mockResolvedValue({ value: true }),
  domIsEnabled: vi.fn().mockResolvedValue({ value: true }),
  domIsChecked: vi.fn().mockResolvedValue({ value: false })
});

describe("ScriptRunner", () => {
  it("runs multiple steps", async () => {
    const manager = createManager();
    const runner = new ScriptRunner(manager as never);

    const result = await runner.run("s1", [
      { action: "goto", args: { url: "https://example.com" } },
      { action: "wait", args: { until: "load" } },
      { action: "wait", args: { ref: "r1", state: "visible" } },
      { action: "snapshot", args: { mode: "outline", maxChars: 100 } },
      { action: "click", args: { ref: "r2" } },
      { action: "hover", args: { ref: "r2" } },
      { action: "press", args: { key: "Enter", ref: "r3" } },
      { action: "check", args: { ref: "r7" } },
      { action: "uncheck", args: { ref: "r7" } },
      { action: "type", args: { ref: "r3", text: "hello" } },
      { action: "select", args: { ref: "r4", values: ["one"] } },
      { action: "scroll", args: { dy: 200 } },
      { action: "scroll_into_view", args: { ref: "r8" } },
      { action: "dom_get_html", args: { ref: "r5" } },
      { action: "dom_get_text", args: { ref: "r6" } },
      { action: "dom_get_attr", args: { ref: "r6", name: "id" } },
      { action: "dom_get_value", args: { ref: "r3" } },
      { action: "dom_is_visible", args: { ref: "r6" } },
      { action: "dom_is_enabled", args: { ref: "r6" } },
      { action: "dom_is_checked", args: { ref: "r7" } }
    ]);

    expect(result.results.every((item) => item.ok)).toBe(true);
    expect(manager.goto).toHaveBeenCalled();
    expect(manager.waitForLoad).toHaveBeenCalled();
    expect(manager.waitForRef).toHaveBeenCalled();
  });

  it("handles cursor, ref scroll, and hidden waits", async () => {
    const manager = createManager();
    const runner = new ScriptRunner(manager as never);

    await runner.run("s1", [
      { action: "snapshot", args: { mode: "outline", maxChars: 50, cursor: "2" } },
      { action: "scroll", args: { dy: 10, ref: "r1" } },
      { action: "wait", args: { ref: "r1", state: "hidden" } }
    ]);

    expect(manager.snapshot).toHaveBeenCalledWith("s1", "outline", 50, "2");
    expect(manager.scroll).toHaveBeenCalledWith("s1", 10, "r1");
    expect(manager.waitForRef).toHaveBeenCalledWith("s1", "r1", "hidden", 30000);
  });

  it("stops on error when configured", async () => {
    const manager = createManager();
    const runner = new ScriptRunner(manager as never);

    const result = await runner.run("s1", [
      { action: "unknown" },
      { action: "goto", args: { url: "https://example.com" } }
    ], true);

    expect(result.results[0].ok).toBe(false);
    expect(manager.goto).not.toHaveBeenCalled();
  });

  it("reports non-error failures", async () => {
    const manager = createManager();
    manager.goto.mockRejectedValueOnce("boom" as never);
    const runner = new ScriptRunner(manager as never);

    const result = await runner.run("s1", [
      { action: "goto", args: { url: "https://example.com" } }
    ]);

    expect(result.results[0].error?.message).toBe("Unknown error");
  });

  it("supports snapshot format alias", async () => {
    const manager = createManager();
    const runner = new ScriptRunner(manager as never);

    await runner.run("s1", [
      { action: "snapshot", args: { format: "actionables" } }
    ]);

    expect(manager.snapshot).toHaveBeenCalled();
  });

  it("defaults invalid wait/snapshot inputs", async () => {
    const manager = createManager();
    const runner = new ScriptRunner(manager as never);

    await runner.run("s1", [
      { action: "wait", args: { until: "invalid", timeoutMs: "nope" } as never },
      { action: "snapshot", args: { format: "bad" } }
    ]);

    expect(manager.waitForLoad).toHaveBeenCalledWith("s1", "load", 30000);
    expect(manager.snapshot).toHaveBeenCalledWith("s1", "outline", 16000, undefined);
  });

  it("skips empty steps and defaults wait state", async () => {
    const manager = createManager();
    const runner = new ScriptRunner(manager as never);

    const result = await runner.run("s1", [
      undefined as never,
      { action: "wait", args: { ref: "r1", state: "invalid" } as never }
    ]);

    expect(result.results.length).toBe(1);
    expect(manager.waitForRef).toHaveBeenCalledWith("s1", "r1", "attached", 30000);
  });

  it("validates required args", async () => {
    const manager = createManager();
    const runner = new ScriptRunner(manager as never);

    const result = await runner.run("s1", [
      { action: "goto", args: { url: "" } },
      { action: "select", args: { ref: "r1", values: [1] } as never },
      { action: "press", args: { ref: "r1" } },
      { action: "dom_get_attr", args: { ref: "r1" } }
    ], false);

    expect(result.results[0].ok).toBe(false);
    expect(result.results[1].ok).toBe(false);
    expect(result.results[2].ok).toBe(false);
    expect(result.results[3].ok).toBe(false);
  });

  it("retries transient failures for actions", async () => {
    const manager = createManager();
    manager.click
      .mockRejectedValueOnce(new Error("flaky"))
      .mockResolvedValueOnce({ ok: true });
    const runner = new ScriptRunner(manager as never);

    const result = await runner.run("s1", [
      { action: "click", args: { ref: "r1" } }
    ]);

    expect(manager.click).toHaveBeenCalledTimes(2);
    expect(result.results[0].ok).toBe(true);
  });

  it("retries when error has no message", async () => {
    const manager = createManager();
    manager.click
      .mockRejectedValueOnce("boom" as never)
      .mockResolvedValueOnce({ ok: true });
    const runner = new ScriptRunner(manager as never);

    const result = await runner.run("s1", [
      { action: "click", args: { ref: "r1" } }
    ]);

    expect(manager.click).toHaveBeenCalledTimes(2);
    expect(result.results[0].ok).toBe(true);
  });

  it("does not retry on unknown ref errors", async () => {
    const manager = createManager();
    manager.click.mockRejectedValueOnce(new Error("Unknown ref: r1. Take a new snapshot first."));
    const runner = new ScriptRunner(manager as never);

    const result = await runner.run("s1", [
      { action: "click", args: { ref: "r1" } }
    ]);

    expect(manager.click).toHaveBeenCalledTimes(1);
    expect(result.results[0].ok).toBe(false);
  });
});
