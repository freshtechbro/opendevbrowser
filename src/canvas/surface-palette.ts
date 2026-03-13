export const CANVAS_SURFACE_TOKENS = {
  background: "#ffffff",
  text: "#0f172a",
  grid: "rgba(148, 163, 184, 0.18)",
  accent: "#20d5c6",
  accentStrong: "#0ea5e9"
} as const;

export const CANVAS_SURFACE_TOKEN_VARIABLES = {
  background: "--surface-bg",
  text: "--surface-text",
  grid: "--surface-grid",
  accent: "--accent",
  accentStrong: "--accent-strong"
} as const;
