import { describe, it, expect } from "vitest";
import {
  createUsageError,
  formatErrorPayload,
  resolveExitCode,
  toCliError,
  EXIT_DISCONNECTED,
  EXIT_EXECUTION,
  EXIT_SUCCESS,
  EXIT_USAGE
} from "../src/cli/errors";

describe("cli error helpers", () => {
  it("creates usage errors with exit code 1", () => {
    const error = createUsageError("bad flags");
    expect(error.exitCode).toBe(EXIT_USAGE);
  });

  it("coerces unknown errors with fallback exit codes", () => {
    const error = toCliError(new Error("boom"), EXIT_EXECUTION);
    expect(error.exitCode).toBe(EXIT_EXECUTION);
    expect(error.message).toBe("boom");
  });

  it("formats JSON error payloads", () => {
    const error = createUsageError("bad flags");
    expect(formatErrorPayload(error)).toEqual({
      success: false,
      error: "bad flags",
      exitCode: EXIT_USAGE
    });
  });

  it("resolves exit codes from command results", () => {
    expect(resolveExitCode({ success: true })).toBe(EXIT_SUCCESS);
    expect(resolveExitCode({ success: false })).toBe(EXIT_EXECUTION);
    expect(resolveExitCode({ success: false, exitCode: EXIT_DISCONNECTED })).toBe(EXIT_DISCONNECTED);
    expect(resolveExitCode({ success: true, exitCode: null })).toBeNull();
  });
});
