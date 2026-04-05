import { describe, expect, it } from "vitest";

import { isAttachBlockedError } from "../extension/src/services/attach-errors";

describe("attach-errors", () => {
  it("matches raw debugger payload objects that carry a blocked-attach message", () => {
    expect(isAttachBlockedError({ code: -32000, message: "Not allowed" })).toBe(true);
    expect(isAttachBlockedError({ code: -32000, message: "Another debugger is already attached" })).toBe(true);
  });

  it("ignores object payloads without a blocked-attach message", () => {
    expect(isAttachBlockedError({ code: -32000, message: "Different debugger error" })).toBe(false);
    expect(isAttachBlockedError({ code: -32000 })).toBe(false);
  });
});
