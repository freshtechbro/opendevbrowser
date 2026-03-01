import { describe, expect, it } from "vitest";
import {
  RELEASE_GATE_GROUPS,
  parseGroupArgs,
  resolveSelectedGroups
} from "../scripts/release-gate-test-groups.mjs";

describe("release-gate test groups", () => {
  it("parses --group", () => {
    const parsed = parseGroupArgs(["--group", "3"]);
    expect(parsed.group).toBe("3");
    expect(parsed.list).toBe(false);
  });

  it("resolves all groups by default", () => {
    const selected = resolveSelectedGroups({ group: null, list: false }, RELEASE_GATE_GROUPS);
    expect(selected).toHaveLength(RELEASE_GATE_GROUPS.length);
  });

  it("resolves one group when selected", () => {
    const selected = resolveSelectedGroups({ group: "2", list: false }, RELEASE_GATE_GROUPS);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("2");
  });

  it("throws for unknown group", () => {
    expect(() => resolveSelectedGroups({ group: "99", list: false }, RELEASE_GATE_GROUPS)).toThrow(
      "Unknown release-gate group: 99"
    );
  });
});

