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
});
