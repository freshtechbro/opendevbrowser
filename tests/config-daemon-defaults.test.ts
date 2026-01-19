import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/fs", () => ({
  writeFileAtomic: vi.fn()
}));

import { __test__ } from "../src/config";
import { writeFileAtomic } from "../src/utils/fs";

describe("persistDaemonConfigDefaults", () => {
  beforeEach(() => {
    vi.mocked(writeFileAtomic).mockClear();
  });

  it("skips persistence when raw config is not a record", () => {
    __test__.persistDaemonConfigDefaults({
      configPath: "/tmp/opendevbrowser.jsonc",
      content: "{}",
      raw: "not-an-object",
      daemonPort: 8788,
      daemonToken: "token"
    });

    expect(vi.mocked(writeFileAtomic)).not.toHaveBeenCalled();
  });

  it("adds daemonPort when missing", () => {
    __test__.persistDaemonConfigDefaults({
      configPath: "/tmp/opendevbrowser.jsonc",
      content: "{\n  \"daemonToken\": \"token\"\n}\n",
      raw: { daemonToken: "token" },
      daemonPort: 8788,
      daemonToken: "token"
    });

    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalled();
    const [, updatedContent] = vi.mocked(writeFileAtomic).mock.calls[0] ?? [];
    expect(String(updatedContent)).toContain("\"daemonPort\"");
  });

  it("adds daemonToken when missing", () => {
    __test__.persistDaemonConfigDefaults({
      configPath: "/tmp/opendevbrowser.jsonc",
      content: "{\n  \"daemonPort\": 8788\n}\n",
      raw: { daemonPort: 8788 },
      daemonPort: 8788,
      daemonToken: "token"
    });

    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalled();
    const [, updatedContent] = vi.mocked(writeFileAtomic).mock.calls[0] ?? [];
    expect(String(updatedContent)).toContain("\"daemonToken\"");
  });
});
