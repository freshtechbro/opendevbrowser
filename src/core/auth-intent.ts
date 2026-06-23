export type GoogleAuthIntent = "none" | "user_owned_google";

export const DEFAULT_GOOGLE_AUTH_INTENT: GoogleAuthIntent = "none";

export const parseGoogleAuthIntent = (value: string | undefined): GoogleAuthIntent => {
  if (!value) {
    return DEFAULT_GOOGLE_AUTH_INTENT;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "none") {
    return "none";
  }
  if (normalized === "user-owned" || normalized === "user_owned_google") {
    return "user_owned_google";
  }
  throw new Error(`Unsupported Google auth intent: ${value}`);
};

export const serializeGoogleAuthIntent = (intent: GoogleAuthIntent): string => (
  intent === "user_owned_google" ? "user-owned" : "none"
);
