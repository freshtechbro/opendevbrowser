import { describe, expect, it } from "vitest";
import { runChromeStoreComplianceCheck } from "../scripts/chrome-store-compliance-check.mjs";

describe("chrome-store-compliance-check", () => {
  it("passes manifest/docs/assets compliance checks", () => {
    const result = runChromeStoreComplianceCheck();
    expect(result.ok).toBe(true);
  });
});
