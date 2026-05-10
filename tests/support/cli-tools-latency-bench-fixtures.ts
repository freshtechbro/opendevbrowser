export const EXPECTED_CLI_TOOLS_LATENCY_SUBCASES = [
  "cli_version_process",
  "cli_help_flag_process",
  "cli_help_command_process",
  "cli_parse_args_module",
  "cli_help_render_module",
  "tools_registry_create_module"
] as const;

export type CliToolsLatencySubcaseId = typeof EXPECTED_CLI_TOOLS_LATENCY_SUBCASES[number];

export interface CliToolsLatencySubcaseFixture {
  id: CliToolsLatencySubcaseId;
  medianMs: number;
  p95Ms: number;
  sampleCount: number;
  diagnosticOutliers: number;
  maxMs: number;
  status: "stable" | "unstable";
}

export interface CliToolsLatencyGroupFixture {
  id: string;
  medianMs: number;
  p95Ms: number;
  sampleCount: number;
  diagnosticOutliers: number;
  maxMs: number;
  status: "stable" | "unstable";
}

export interface CliToolsLatencySuiteFixture {
  generatedAt: string;
  options: {
    samples: number;
    warmup: number;
    trials: number;
  };
  primaryMetricGroup: string;
  primaryP95Ms: number;
  aggregateP95Ms: number;
  trialAggregateP95Ms: number[];
  trialPrimaryP95Ms: number[];
  varianceRatio: number;
  stable: boolean;
  status: "stable" | "unstable";
  totalDiagnosticOutliers: number;
  totalSamples: number;
  groups: CliToolsLatencyGroupFixture[];
  subcases: CliToolsLatencySubcaseFixture[];
}

export const CLI_TOOLS_LATENCY_SAMPLE_VALUES = [10, 20, 30, 40, 50, 60, 70, 80];

export const createCliToolsLatencySuiteFixture = (): CliToolsLatencySuiteFixture => ({
  generatedAt: "2026-05-10T21:24:05.000Z",
  options: {
    samples: 4,
    warmup: 1,
    trials: 2
  },
  primaryMetricGroup: "cheap_cli_surface",
  primaryP95Ms: 80,
  aggregateP95Ms: 80,
  trialAggregateP95Ms: [72, 80],
  trialPrimaryP95Ms: [72, 80],
  varianceRatio: 0.10526315789473684,
  stable: true,
  status: "stable",
  totalDiagnosticOutliers: 0,
  totalSamples: 24,
  groups: [
    {
      id: "cheap_cli_surface",
      medianMs: 45,
      p95Ms: 80,
      sampleCount: 12,
      diagnosticOutliers: 0,
      maxMs: 80,
      status: "stable"
    },
    {
      id: "parser_render_module",
      medianMs: 45,
      p95Ms: 80,
      sampleCount: 8,
      diagnosticOutliers: 0,
      maxMs: 80,
      status: "stable"
    },
    {
      id: "tool_registry_module",
      medianMs: 45,
      p95Ms: 80,
      sampleCount: 4,
      diagnosticOutliers: 0,
      maxMs: 80,
      status: "stable"
    },
    {
      id: "all_subcases",
      medianMs: 45,
      p95Ms: 80,
      sampleCount: 24,
      diagnosticOutliers: 0,
      maxMs: 80,
      status: "stable"
    }
  ],
  subcases: EXPECTED_CLI_TOOLS_LATENCY_SUBCASES.map((id, index) => ({
    id,
    medianMs: 10 + index,
    p95Ms: 20 + index,
    sampleCount: 4,
    diagnosticOutliers: 0,
    maxMs: 25 + index,
    status: "stable"
  }))
});
