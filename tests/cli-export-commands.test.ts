import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { __test__ as cloneComponentTest, runCloneComponent } from "../src/cli/commands/export/clone-component";
import { __test__ as clonePageTest, runClonePage } from "../src/cli/commands/export/clone-page";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (command: string, rawArgs: string[]): ParsedArgs => ({
  command,
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("export CLI commands", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("parses target-id for clone-page", () => {
    expect(clonePageTest.parseClonePageArgs([
      "--session-id=s1",
      "--target-id=tab-7"
    ])).toEqual({
      sessionId: "s1",
      targetId: "tab-7"
    });
  });

  it("passes target-id through clone-page daemon calls", async () => {
    callDaemon.mockResolvedValue({ component: "export default function Example() {}" });

    const result = await runClonePage(makeArgs("clone-page", [
      "--session-id",
      "s1",
      "--target-id",
      "tab-7"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("export.clonePage", {
      sessionId: "s1",
      targetId: "tab-7"
    });
    expect(result).toEqual({
      success: true,
      message: "Page cloned.",
      data: { component: "export default function Example() {}" }
    });
  });

  it("parses target-id for clone-component", () => {
    expect(cloneComponentTest.parseCloneComponentArgs([
      "--session-id=s1",
      "--ref=r4",
      "--target-id=tab-9"
    ])).toEqual({
      sessionId: "s1",
      ref: "r4",
      targetId: "tab-9"
    });
  });

  it("passes target-id through clone-component daemon calls", async () => {
    callDaemon.mockResolvedValue({ component: "export default function Piece() {}" });

    const result = await runCloneComponent(makeArgs("clone-component", [
      "--session-id",
      "s1",
      "--ref",
      "r4",
      "--target-id",
      "tab-9"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("export.cloneComponent", {
      sessionId: "s1",
      ref: "r4",
      targetId: "tab-9"
    });
    expect(result).toEqual({
      success: true,
      message: "Component cloned.",
      data: { component: "export default function Piece() {}" }
    });
  });
});
