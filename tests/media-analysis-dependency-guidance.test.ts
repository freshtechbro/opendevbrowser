import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface GuidanceSection {
  label: string;
  path: string;
  startMarker: string;
  endMarker: string;
}

const DEPENDENCY_CONTRACT_SECTIONS: readonly GuidanceSection[] = [
  {
    label: "docs/CLI.md Inspiredesign notes",
    path: "docs/CLI.md",
    startMarker: "#### Inspiredesign (`inspiredesign run`) and `inspiredesign harvest`",
    endMarker: "Wrapper behavior:"
  },
  {
    label: "docs/SURFACE_REFERENCE.md Inspiredesign notes",
    path: "docs/SURFACE_REFERENCE.md",
    startMarker: "- Inspiredesign harvest artifacts:",
    endMarker: "- `ranked-references.json.rejectedReferences`"
  },
  {
    label: "docs/DEPENDENCIES.md optional host tools",
    path: "docs/DEPENDENCIES.md",
    startMarker: "### Optional host tools",
    endMarker: "### Dev dependencies"
  },
  {
    label: "docs/TROUBLESHOOTING.md media-analysis remediation",
    path: "docs/TROUBLESHOOTING.md",
    startMarker: "## Inspiredesign media analysis is degraded",
    endMarker: "## Desktop observation returns `desktop_unsupported` on macOS"
  },
  {
    label: "best-practices skill Inspiredesign rules",
    path: "skills/opendevbrowser-best-practices/SKILL.md",
    startMarker: "4. Design-contract synthesis with repeated public references.",
    endMarker: "## Agent Sync Targets"
  }
] as const;

const PINTEREST_BROAD_QUERY_SECTIONS: readonly GuidanceSection[] = [
  {
    label: "docs/CLI.md Inspiredesign notes",
    path: "docs/CLI.md",
    startMarker: "#### Inspiredesign (`inspiredesign run`) and `inspiredesign harvest`",
    endMarker: "Wrapper behavior:"
  },
  {
    label: "docs/SURFACE_REFERENCE.md Inspiredesign notes",
    path: "docs/SURFACE_REFERENCE.md",
    startMarker: "- Inspiredesign harvest flags:",
    endMarker: "For complete argument and flag coverage by command"
  },
  {
    label: "best-practices skill Inspiredesign rules",
    path: "skills/opendevbrowser-best-practices/SKILL.md",
    startMarker: "4. Design-contract synthesis with repeated public references.",
    endMarker: "## Agent Sync Targets"
  }
] as const;

const STATUS_CAPABILITY_SECTIONS: readonly GuidanceSection[] = [
  {
    label: "docs/CLI.md status-capabilities notes",
    path: "docs/CLI.md",
    startMarker: "### Status capabilities",
    endMarker: "### Cookie import"
  },
  {
    label: "docs/SURFACE_REFERENCE.md status-capabilities mention",
    path: "docs/SURFACE_REFERENCE.md",
    startMarker: "- Media-analysis binaries resolve from",
    endMarker: "- Missing or invalid FFmpeg or FFprobe binaries"
  },
  {
    label: "docs/TROUBLESHOOTING.md status-capabilities remediation",
    path: "docs/TROUBLESHOOTING.md",
    startMarker: "## Inspiredesign media analysis is degraded",
    endMarker: "## Desktop observation returns `desktop_unsupported` on macOS"
  },
  {
    label: "best-practices skill status-capabilities remediation",
    path: "skills/opendevbrowser-best-practices/SKILL.md",
    startMarker: "4. Design-contract synthesis with repeated public references.",
    endMarker: "## Agent Sync Targets"
  }
] as const;

const LAUNCH_AGENT_PATH_SECTIONS: readonly GuidanceSection[] = [
  {
    label: "docs/CLI.md install auto-start guidance",
    path: "docs/CLI.md",
    startMarker: "On successful installs, the CLI/plugin installer reconciles daemon auto-start",
    endMarker: "### Update"
  },
  {
    label: "docs/CLI.md daemon auto-start guidance",
    path: "docs/CLI.md",
    startMarker: "### Daemon auto-start",
    endMarker: "Exit codes align with the CLI:"
  },
  {
    label: "docs/TROUBLESHOOTING.md LaunchAgent remediation",
    path: "docs/TROUBLESHOOTING.md",
    startMarker: "## Inspiredesign media analysis is degraded",
    endMarker: "## Desktop observation returns `desktop_unsupported` on macOS"
  },
  {
    label: "best-practices skill LaunchAgent remediation",
    path: "skills/opendevbrowser-best-practices/SKILL.md",
    startMarker: "4. Design-contract synthesis with repeated public references.",
    endMarker: "## Agent Sync Targets"
  }
] as const;

const AGENTS_SYNC_SECTIONS: readonly GuidanceSection[] = [
  {
    label: "root AGENTS media-analysis sync rule",
    path: "AGENTS.md",
    startMarker: "When Inspiredesign media-analysis dependency or capability guidance changes",
    endMarker: "When first-contact capability wording changes"
  },
  {
    label: "docs AGENTS media-analysis sync rule",
    path: "docs/AGENTS.md",
    startMarker: "When Inspiredesign media-analysis dependency/status guidance changes:",
    endMarker: "When canvas session/code-sync/projection behavior changes"
  },
  {
    label: "tests AGENTS media-analysis test rule",
    path: "tests/AGENTS.md",
    startMarker: "- **Keep Inspiredesign media-analysis dependency tests hermetic**",
    endMarker: "- **Keep package postinstall tests hermetic**"
  },
  {
    label: "skills AGENTS media-analysis sync rule",
    path: "skills/AGENTS.md",
    startMarker: "- Keep Inspiredesign media-analysis dependency/status guidance",
    endMarker: "## Adding Skills"
  }
] as const;

const FORBIDDEN_DEFAULT_BINARY_PACKAGE_CLAIMS = [
  "ffmpeg-static",
  "ffprobe-static",
  "@ffmpeg-installer",
  "static FFmpeg binaries are bundled",
  "download static FFmpeg binaries during install"
] as const;

const FORBIDDEN_MEDIA_ANALYSIS_AUTHORITY_CLAIMS = [
  "media-analysis.json satisfies product readiness",
  "media-analysis.json can satisfy product readiness",
  "media-analysis.json satisfies readiness",
  "media-analysis.json can make a reference pin_media_ready"
] as const;

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function extractSection(source: string, startMarker: string, endMarker: string): string {
  const startIndex = source.indexOf(startMarker);
  expect(startIndex, `Missing section start: ${startMarker}`).toBeGreaterThanOrEqual(0);

  const contentStart = startIndex + startMarker.length;
  const endIndex = source.indexOf(endMarker, contentStart);
  expect(endIndex, `Missing section end: ${endMarker}`).toBeGreaterThan(contentStart);

  return source.slice(startIndex, endIndex);
}

function readSection(section: GuidanceSection): string {
  return extractSection(readProjectFile(section.path), section.startMarker, section.endMarker);
}

function expectDependencyContract(label: string, content: string): void {
  expect(content, `${label} should mention FFmpeg`).toContain("FFmpeg");
  expect(content, `${label} should mention FFprobe`).toContain("FFprobe");
  expect(content.toLowerCase(), `${label} should describe the tools as recommended optional host tools`).toContain("recommended optional host tool");
  expect(content, `${label} should mention the FFmpeg env override`).toContain("OPENDEVBROWSER_FFMPEG_PATH");
  expect(content, `${label} should mention the FFprobe env override`).toContain("OPENDEVBROWSER_FFPROBE_PATH");
  expect(content, `${label} should mention the FFmpeg config key`).toContain("inspiredesign.mediaAnalysis.ffmpegPath");
  expect(content, `${label} should mention the FFprobe config key`).toContain("inspiredesign.mediaAnalysis.ffprobePath");
  expect(content, `${label} should mention PATH fallback`).toContain("PATH");
  const normalizedContent = content.replaceAll("`", "");
  const normalizedLowerContent = normalizedContent.toLowerCase();
  expect(normalizedContent, `${label} should mention common absolute install directories`).toContain("common absolute");
  expect(normalizedContent, `${label} should restrict fallback to implicit PATH ENOENT misses`).toContain("implicit PATH-source ENOENT misses");
  expect(normalizedLowerContent, `${label} should keep explicit env and config failures diagnostic`).toContain("invalid env or config paths stay diagnostic and do not fall back");
  const describesNoBundledBinaries = content.includes("not bundled") || content.includes("does not bundle");
  expect(describesNoBundledBinaries, `${label} should say binaries are not bundled`).toBe(true);
  expect(normalizedContent, `${label} should say binaries are not downloaded by default`).toContain("not downloaded by default");
  expect(normalizedContent, `${label} should keep degradation scoped to media-analysis.json`).toContain("degrade media-analysis.json only");
  expect(content, `${label} should preserve pin-media readiness`).toContain("do not fail pin-media readiness");
  expect(normalizedContent, `${label} should prevent media-analysis product readiness authority`).toContain("media-analysis.json never satisfies product readiness");
}

function expectNoForbiddenClaims(label: string, content: string): void {
  for (const forbiddenClaim of FORBIDDEN_DEFAULT_BINARY_PACKAGE_CLAIMS) {
    expect(content, `${label} should not claim default binary package support: ${forbiddenClaim}`)
      .not.toContain(forbiddenClaim);
  }

  for (const forbiddenClaim of FORBIDDEN_MEDIA_ANALYSIS_AUTHORITY_CLAIMS) {
    expect(content, `${label} should not promote media-analysis authority: ${forbiddenClaim}`)
      .not.toContain(forbiddenClaim);
  }
}

describe("media-analysis dependency guidance", () => {
  it("documents the FFmpeg and FFprobe optional host tool contract", () => {
    for (const section of DEPENDENCY_CONTRACT_SECTIONS) {
      const content = readSection(section);

      expectDependencyContract(section.label, content);
    }
  });

  it("documents Pinterest broad-query readiness and recovery authority", () => {
    for (const section of PINTEREST_BROAD_QUERY_SECTIONS) {
      const content = readSection(section);
      const normalizedContent = content.toLowerCase();

      expect(content, `${section.label} should mention query-discovered canonical pins`).toContain("query-discovered canonical");
      expect(content, `${section.label} should mention first-party pin-media bytes`).toContain("first-party pin-media");
      expect(content, `${section.label} should mention discovery diagnostics`).toContain("discovery-diagnostics.json");
      expect(content, `${section.label} should keep blocker diagnostics recovery-only`).toContain("login/challenge and search-shell diagnostics are recovery paths, not product-ready evidence");
      expect(content, `${section.label} should preserve pin-media authority`).toContain("pin-media-index.json");
      expect(content, `${section.label} should preserve media-analysis advisory status`).toContain("media-analysis.json");
      expect(content, `${section.label} should preserve browser replay authority`).toContain("motion-evidence.json");
      expect(normalizedContent, `${section.label} should describe skipped supplemental screenshots`).toContain("unavailable supplemental viewport screenshot evidence is recorded as skipped");
    }
  });

  it("documents the status-capabilities host.mediaAnalysis preflight surface", () => {
    for (const section of STATUS_CAPABILITY_SECTIONS) {
      const content = readSection(section);

      expect(content, `${section.label} should mention status-capabilities`).toContain("status-capabilities");
      expect(content, `${section.label} should mention host.mediaAnalysis`).toContain("host.mediaAnalysis");
    }
  });

  it("documents macOS LaunchAgent PATH repair guidance", () => {
    for (const section of LAUNCH_AGENT_PATH_SECTIONS) {
      const content = readSection(section);

      expect(content, `${section.label} should mention LaunchAgent`).toContain("LaunchAgent");
      expect(content, `${section.label} should mention EnvironmentVariables.PATH`).toContain("EnvironmentVariables.PATH");
      expect(content, `${section.label} should mention common binary directories`).toContain("common");
    }
  });

  it("does not document bundled binaries or media-analysis readiness authority", () => {
    for (const section of DEPENDENCY_CONTRACT_SECTIONS) {
      const content = readSection(section);

      expectNoForbiddenClaims(section.label, content);
    }
  });

  it("keeps AGENTS sync guidance aligned to the media-analysis dependency contract", () => {
    for (const section of AGENTS_SYNC_SECTIONS) {
      const content = readSection(section);
      const normalizedContent = content.replaceAll("`", "");

      expect(content, `${section.label} should mention FFmpeg`).toContain("FFmpeg");
      expect(content, `${section.label} should mention FFprobe`).toContain("FFprobe");
      expect(content.toLowerCase(), `${section.label} should keep host-tool wording`).toContain("host");
      expect(content, `${section.label} should mention env/config/PATH resolution`).toContain("PATH");
      expect(normalizedContent, `${section.label} should mention common absolute directory fallback`).toContain("common absolute");
      expect(normalizedContent, `${section.label} should restrict fallback to implicit PATH ENOENT misses`).toContain("implicit PATH-source ENOENT misses");
      expect(normalizedContent.toLowerCase(), `${section.label} should keep invalid env/config failures diagnostic`).toContain("invalid env");
      expect(normalizedContent.toLowerCase(), `${section.label} should forbid env/config fallback`).toContain("do not fall back");
      expect(content, `${section.label} should mention status-capabilities`).toContain("status-capabilities");
      expect(content, `${section.label} should mention host.mediaAnalysis`).toContain("host.mediaAnalysis");
      expect(normalizedContent, `${section.label} should mention no bundled/default-downloaded binaries`).toMatch(/not bundled|no bundled/);
      expect(normalizedContent, `${section.label} should mention media-analysis degradation only`).toContain("media-analysis.json");
      expect(content, `${section.label} should mention pin-media authority`).toContain("pin-media-index.json");
      expect(content, `${section.label} should mention motion authority`).toContain("motion-evidence.json");
    }
  });
});
