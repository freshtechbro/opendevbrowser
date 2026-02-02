import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");
  const toolFn = (input: { description: string; args: unknown; execute: (...args: unknown[]) => unknown }) => input;
  toolFn.schema = z;
  return { tool: toolFn };
});

vi.mock("fs", () => ({
  promises: {
    writeFile: vi.fn()
  }
}));

vi.mock("os", () => {
  const tmpdir = vi.fn();
  return {
    default: { tmpdir },
    tmpdir
  };
});

vi.mock("crypto", () => ({
  randomUUID: vi.fn()
}));

const parse = (value: string) => JSON.parse(value) as { ok: boolean } & Record<string, unknown>;

const createDeps = () => {
  const manager = {
    status: vi.fn().mockResolvedValue({ mode: "extension", activeTargetId: "t1", url: "https://", title: "Title" })
  };
  const annotationManager = {
    requestAnnotation: vi.fn()
  };
  return { manager, annotationManager };
};

const buildPayload = (overrides?: Partial<Record<string, unknown>>) => ({
  url: "https://example.com",
  title: "Example",
  timestamp: "2026-01-31T00:00:00Z",
  context: "Check header",
  screenshotMode: "visible",
  screenshots: [
    {
      id: "shot-1",
      label: "Hero Shot",
      base64: Buffer.from("hello").toString("base64"),
      mime: "image/png"
    }
  ],
  annotations: [
    {
      id: "a1",
      selector: "#submit",
      tag: "button",
      idAttr: "submit",
      classes: ["btn"],
      text: "Click me",
      rect: { x: 10.2, y: 20.7, width: 100.4, height: 30.6 },
      attributes: { class: "btn" },
      a11y: { role: "button", label: "Send" },
      styles: { color: "red" },
      note: "Primary CTA",
      screenshotId: "shot-1"
    }
  ],
  ...overrides
});

describe("annotate tool", () => {
  beforeEach(async () => {
    const os = await import("os");
    const crypto = await import("crypto");
    vi.mocked(os.tmpdir).mockReturnValue("/tmp/annotate-tests");
    vi.mocked(crypto.randomUUID).mockReturnValue("abcd1234efgh5678");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("formats annotation output with summary details and screenshots", async () => {
    const deps = createDeps();
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-1",
      status: "ok",
      payload: buildPayload()
    });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(true);
    expect(String(result.message)).toContain("# Annotation Summary");
    expect(String(result.message)).toContain("- URL: https://example.com");
    expect(String(result.message)).toContain("- Title: Example");
    expect(String(result.message)).toContain("- Timestamp: 2026-01-31T00:00:00Z");
    expect(String(result.message)).toContain("- Screenshot mode: visible");
    expect(String(result.message)).toContain("- Context: Check header");
    expect(String(result.message)).toContain("## 1. button#submit");
    expect(String(result.message)).toContain("> Primary CTA");
    expect(String(result.message)).toContain("- Selector: `#submit`");
    expect(String(result.message)).toContain("x=10, y=21, w=100, h=31");
    expect(String(result.message)).toContain("A11y: role=button, label=Send");
    expect(String(result.message)).toContain("- Text: Click me");
    expect(String(result.message)).toContain("- Screenshot: /tmp/annotate-tests/opendevbrowser-annotate-Hero-Shot-abcd1234.png");
  });

  it("redacts sensitive annotation attributes, notes, and text", async () => {
    const deps = createDeps();
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-2",
      status: "ok",
      payload: buildPayload({
        annotations: [
          {
            id: "a2",
            selector: "#secret",
            tag: "input",
            rect: { x: 1, y: 2, width: 3, height: 4 },
            attributes: {
              class: "keep",
              "data-token": "MY-SUPER-SECRET-TOKEN-1234567890",
              value: "password1234567890"
            },
            a11y: { role: "textbox" },
            styles: {},
            note: "password=supersecret",
            text: "TOKEN12345678901234567890"
          }
        ],
        screenshots: []
      })
    });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(true);
    const details = result.details as { annotations: Array<{ attributes: Record<string, string>; note?: string; text?: string }> };
    expect(details.annotations[0]?.attributes).toEqual({ class: "keep" });
    expect(details.annotations[0]?.note).toBe("[redacted]");
    expect(details.annotations[0]?.text).toBe("[redacted]");
    expect(String(result.message)).toContain("> [redacted]");
    expect(String(result.message)).not.toContain("supersecret");
  });

  it("writes screenshots to the tmp directory", async () => {
    const deps = createDeps();
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-3",
      status: "ok",
      payload: buildPayload()
    });

    const fs = await import("fs");
    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(true);
    expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fs.promises.writeFile).mock.calls[0] ?? [];
    expect(String(call[0])).toContain("/tmp/annotate-tests/opendevbrowser-annotate-");
    expect((result.screenshots as Array<{ id: string; path: string }>)[0]?.path).toContain("/tmp/annotate-tests/");
  });

  it("propagates timeout errors and forwards timeoutMs to the annotation manager", async () => {
    const deps = createDeps();
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-4",
      status: "error",
      error: { code: "timeout", message: "Annotation request timed out." }
    });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1", timeoutMs: 5000 } as never));

    expect(deps.annotationManager.requestAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", timeoutMs: 5000 })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "timeout" });
  });

  it("returns an error when relay annotation is requested outside extension mode", async () => {
    const deps = createDeps();
    deps.manager.status.mockResolvedValue({ mode: "managed" });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1", transport: "relay" } as never));

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "annotate_requires_extension" });
  });

  it("allows relay annotations when session is in extension mode", async () => {
    const deps = createDeps();
    deps.manager.status.mockResolvedValue({ mode: "extension" });
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-relay-ok",
      status: "ok",
      payload: buildPayload({
        url: "https://example.com",
        screenshots: [],
        annotations: [
          {
            id: "a-relay",
            selector: "#cta",
            tag: "button",
            rect: { x: 1, y: 2, width: 3, height: 4 },
            attributes: {},
            a11y: {},
            styles: {}
          }
        ]
      })
    });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1", transport: "relay" } as never));

    expect(result.ok).toBe(true);
    expect(deps.manager.status).toHaveBeenCalledWith("s1");
    expect(deps.annotationManager.requestAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", transport: "relay" })
    );
  });

  it("omits optional fields when payload values are missing", async () => {
    const deps = createDeps();
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-5",
      status: "ok",
      payload: buildPayload({
        title: undefined,
        context: undefined,
        screenshots: [],
        annotations: [
          {
            id: "a3",
            selector: "#title",
            tag: "h1",
            rect: { x: 1, y: 2, width: 3, height: 4 },
            attributes: {},
            a11y: {},
            styles: {}
          }
        ]
      })
    });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(true);
    expect(String(result.message)).not.toContain("- Title:");
    expect(String(result.message)).not.toContain("- Context:");
    expect(String(result.message)).not.toContain("A11y:");
  });

  it("uses fallback error details when the response lacks error fields", async () => {
    const deps = createDeps();
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-fallback",
      status: "error",
      error: {}
    });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "annotate_failed", message: "Annotation failed." });
  });

  it("fails when the response is ok but missing a payload", async () => {
    const deps = createDeps();
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-missing-payload",
      status: "ok"
    });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "annotate_failed", message: "Annotation failed." });
  });

  it("returns annotate_failed when the annotation manager throws", async () => {
    const deps = createDeps();
    deps.annotationManager.requestAnnotation.mockRejectedValue(new Error("boom"));

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "annotate_failed", message: "boom" });
  });

  it("redacts sensitive attribute values and base64-like notes", async () => {
    const deps = createDeps();
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-6",
      status: "ok",
      payload: buildPayload({
        annotations: [
          {
            id: "a4",
            selector: "#meta",
            tag: "div",
            rect: { x: 1, y: 2, width: 3, height: 4 },
            attributes: {
              "data-info": "AAAAAAAAAAAAAAAAAAAA",
              "data-safe": "safe-value-1234567890"
            },
            a11y: {},
            styles: {},
            note: "QWxhZGRpbjpvcGVuIHNlc2FtZQ=="
          }
        ],
        screenshots: []
      })
    });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(true);
    const details = result.details as { annotations: Array<{ attributes: Record<string, string>; note?: string }> };
    expect(details.annotations[0]?.attributes).toEqual({ "data-safe": "safe-value-1234567890" });
    expect(details.annotations[0]?.note).toBe("[redacted]");
  });

  it("truncates long annotation text in the markdown output", async () => {
    const deps = createDeps();
    const longText = "lorem ipsum dolor sit amet ".repeat(10);
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-8",
      status: "ok",
      payload: buildPayload({
        annotations: [
          {
            id: "a5",
            selector: "#long",
            tag: "p",
            rect: { x: 1, y: 2, width: 3, height: 4 },
            attributes: {},
            a11y: {},
            styles: {},
            text: longText
          }
        ],
        screenshots: []
      })
    });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(true);
    expect(String(result.message)).toContain(`${longText.slice(0, 160)}...`);
  });

  it("renders a11y labels even when role is missing", async () => {
    const deps = createDeps();
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-a11y",
      status: "ok",
      payload: buildPayload({
        annotations: [
          {
            id: "a6",
            selector: "#label-only",
            tag: "span",
            rect: { x: 1, y: 2, width: 3, height: 4 },
            attributes: {},
            a11y: { label: "Label Only" },
            styles: {}
          }
        ],
        screenshots: undefined
      })
    });

    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(true);
    expect(String(result.message)).toContain("A11y: role=n/a, label=Label Only");
  });

  it("skips empty or oversized screenshots and sanitizes labels", async () => {
    const deps = createDeps();
    const bigBase64 = Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64");
    deps.annotationManager.requestAnnotation.mockResolvedValue({
      version: 1,
      requestId: "req-7",
      status: "ok",
      payload: buildPayload({
        screenshots: [
          { id: "s1", label: "", base64: Buffer.from("ok").toString("base64"), mime: "image/png" },
          { id: "s2", label: "big", base64: bigBase64, mime: "image/png" },
          { id: "s3", label: "empty", base64: "", mime: "image/png" }
        ],
        annotations: []
      })
    });

    const fs = await import("fs");
    const { createAnnotateTool } = await import("../src/tools/annotate");
    const tool = createAnnotateTool(deps as never);
    const result = parse(await tool.execute({ sessionId: "s1" } as never));

    expect(result.ok).toBe(true);
    expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    const screenshotPaths = result.screenshots as Array<{ id: string; path: string }>;
    expect(screenshotPaths).toHaveLength(1);
    expect(screenshotPaths[0]?.path).toContain("opendevbrowser-annotate-annotation-");
  });
});
