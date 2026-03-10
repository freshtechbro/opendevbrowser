import { describe, it, expect } from "vitest";
import { failure, ok, serializeError } from "../src/tools/response";

describe("response helpers", () => {
  it("serializes ok payloads", () => {
    const text = ok({ foo: "bar" });
    expect(JSON.parse(text)).toEqual({ ok: true, foo: "bar" });
  });

  it("serializes failures", () => {
    const text = failure("bad", "code");
    expect(JSON.parse(text)).toEqual({
      ok: false,
      error: { message: "bad", code: "code" }
    });
  });

  it("serializes errors", () => {
    expect(serializeError(new Error("boom"))).toEqual({ message: "boom" });
    expect(serializeError("unknown")).toEqual({ message: "Unknown error" });
  });

  it("serializes structured error details and blockers", () => {
    const detailsError = Object.assign(new Error("with details"), {
      code: "detail_error",
      details: { auditId: "CANVAS-01" }
    });
    expect(serializeError(detailsError)).toEqual({
      message: "with details",
      code: "detail_error",
      details: { auditId: "CANVAS-01" }
    });

    const blockerError = Object.assign(new Error("with blocker"), {
      code: "blocked",
      blocker: { code: "plan_required", retryable: false }
    });
    expect(serializeError(blockerError)).toEqual({
      message: "with blocker",
      code: "blocked",
      details: {
        blocker: { code: "plan_required", retryable: false }
      }
    });
  });
});
