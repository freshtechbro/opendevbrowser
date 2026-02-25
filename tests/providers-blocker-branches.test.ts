import { describe, expect, it, vi } from "vitest";

vi.mock("../src/core/logging", () => ({
  redactSensitive: (value: unknown) => value
}));

vi.mock("../src/providers/safety/prompt-guard", () => ({
  sanitizePromptGuardText: (text: string) => ({
    text,
    diagnostics: { entries: 0, quarantinedSegments: 0 }
  })
}));

import { __test__, buildBlockerArtifacts } from "../src/providers/blocker";

describe("provider blocker uncovered branches", () => {
  it("covers classifyFromInputs default title/message branches and upstream status path", () => {
    const classified = __test__.classifyFromInputs({
      source: "network",
      providerErrorCode: "network",
      status: 503
    }, [], []);

    expect(classified?.type).toBe("upstream_block");
  });

  it("covers artifact coercion branches for arrays, primitives, and circular references", () => {
    const circular: Record<string, unknown> = {
      list: [1, 2, 3],
      primitive: Symbol("branch")
    };
    circular.self = circular;

    const artifacts = buildBlockerArtifacts({
      networkEvents: [circular]
    });

    expect(artifacts.network[0]).toMatchObject({
      list: [1, 2, 3],
      primitive: "Symbol(branch)",
      self: "[Circular]"
    });
  });

  it("covers promptGuardEnabled nullish fallback branch in artifact builder", () => {
    const artifacts = buildBlockerArtifacts({
      networkEvents: [{ message: "ok" }],
      promptGuardEnabled: undefined
    });
    expect(artifacts.network).toHaveLength(1);
  });
});
