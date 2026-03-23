import type { ChallengeClassification, ChallengeEvidenceBundle, ChallengeInterpreterResult } from "./types";

const PASSWORD_RE = /\b(password|passcode|secret)\b/i;
const MFA_RE = /\b(mfa|otp|one.?time|two.?factor|verification code|passkey|security key|authenticator)\b/i;
const HUMAN_RE = /\b(captcha|verify (?:that )?you(?:'re| are) human|turnstile|recaptcha|hcaptcha|security check)\b/i;
const FIXTURE_RE = /\b(turnstile-checkbox|recaptcha-v2-checkbox|vendor test key|test site key)\b/i;

const summarize = (parts: Array<string | false | null | undefined>): string => {
  return parts.filter((value): value is string => Boolean(value)).join("; ");
};

const detectOwnedFixture = (bundle: ChallengeEvidenceBundle): boolean => {
  const haystack = [bundle.url, bundle.title, bundle.snapshotText]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
  return haystack.startsWith("file:")
    ? FIXTURE_RE.test(haystack)
    : FIXTURE_RE.test(haystack);
};

const detectHumanBoundary = (bundle: ChallengeEvidenceBundle): ChallengeInterpreterResult["humanBoundary"] => {
  const text = [bundle.snapshotText, bundle.title]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
  if (MFA_RE.test(text)) return "mfa";
  if (PASSWORD_RE.test(text)) return "secret_entry";
  return "none";
};

const detectClassification = (
  bundle: ChallengeEvidenceBundle,
  humanBoundary: ChallengeInterpreterResult["humanBoundary"]
): ChallengeClassification => {
  const blockerType = bundle.blocker?.type;
  const reasonCode = bundle.blocker?.reasonCode ?? bundle.challenge?.reasonCode;
  const isLogin = bundle.continuity.likelyLoginPage;
  const hasReuse = bundle.continuity.hasPreservedSession || bundle.continuity.canReuseExistingCookies;
  const humanVerification = bundle.continuity.likelyHumanVerification
    || HUMAN_RE.test(bundle.snapshotText ?? "")
    || reasonCode === "challenge_detected";

  if (detectOwnedFixture(bundle)) return "owned_environment_test_challenge";
  if (humanBoundary === "mfa") return "human_verification_required";
  if (humanBoundary === "secret_entry") return "auth_required";
  if (isLogin && hasReuse) return "existing_session_reuse";
  if (blockerType === "auth_required" || reasonCode === "auth_required" || reasonCode === "token_required" || isLogin) {
    return hasReuse ? "existing_session_reuse" : "auth_required";
  }
  if (humanVerification) {
    return bundle.continuity.sessionReuseRefs.length > 0
      ? "checkpoint_or_friction"
      : "unsupported_third_party_challenge";
  }
  return "checkpoint_or_friction";
};

export const interpretChallengeEvidence = (
  bundle: ChallengeEvidenceBundle
): ChallengeInterpreterResult => {
  const humanBoundary = detectHumanBoundary(bundle);
  const classification = detectClassification(bundle, humanBoundary);
  const authState: ChallengeInterpreterResult["authState"] = classification === "existing_session_reuse"
    ? "session_reusable"
    : classification === "auth_required"
      ? bundle.continuity.likelyLoginPage
        ? "login_page"
        : "credentials_required"
      : classification === "human_verification_required" || classification === "unsupported_third_party_challenge"
        ? "human_verification"
        : bundle.continuity.canReuseExistingCookies
          ? "authenticated"
          : "unknown";

  const allowedActionFamilies = [
    "wait",
    "verification",
    "debug_trace",
    ...(classification === "auth_required" || classification === "existing_session_reuse"
      ? ["auth_navigation", "session_reuse", "cookie_reuse", "element_discovery", "click_path", "scroll", "hover", "press"]
      : ["element_discovery", "click_path", "scroll", "hover", "press", "pointer", "drag"]),
    ...(bundle.continuity.hasNonSecretTaskData && bundle.continuity.nonSecretFieldRefs.length > 0
      ? ["non_secret_form_fill", "dropdown"]
      : [])
  ] as ChallengeInterpreterResult["allowedActionFamilies"];

  const continuityOpportunities: ChallengeInterpreterResult["continuityOpportunities"] = [];
  if (
    bundle.continuity.hasPreservedSession
    || bundle.continuity.attachedSession
    || bundle.continuity.sessionReuseRefs.length > 0
  ) {
    continuityOpportunities.push("existing_session");
  }
  if (bundle.continuity.canReuseExistingCookies || bundle.continuity.canImportCookies) {
    continuityOpportunities.push("cookie_reuse");
  }
  if (bundle.continuity.hasNonSecretTaskData && bundle.continuity.nonSecretFieldRefs.length > 0) {
    continuityOpportunities.push("non_secret_form_fill");
  }

  const laneHints: ChallengeInterpreterResult["laneHints"] = classification === "owned_environment_test_challenge"
    ? ["owned_environment_fixture", "generic_browser_autonomy"]
    : humanBoundary !== "none"
      ? ["human_yield"]
      : classification === "unsupported_third_party_challenge"
        ? ["optional_computer_use_bridge", "human_yield"]
        : ["generic_browser_autonomy"];

  const stopRisk = humanBoundary === "mfa" || classification === "unsupported_third_party_challenge"
    ? "high"
    : bundle.blockerState === "active"
      ? "medium"
      : "low";

  return {
    classification,
    authState,
    humanBoundary: classification === "unsupported_third_party_challenge" && humanBoundary === "none"
      ? "unsupported_third_party"
      : humanBoundary,
    requiredVerification: stopRisk === "low" ? "light" : "full",
    continuityOpportunities,
    allowedActionFamilies,
    laneHints,
    stopRisk,
    summary: summarize([
      `classification=${classification}`,
      `authState=${authState}`,
      continuityOpportunities.length > 0 ? `continuity=${continuityOpportunities.join(",")}` : null,
      bundle.continuity.likelyLoginPage ? "login-page-visible" : null,
      bundle.continuity.likelyHumanVerification ? "human-verification-visible" : null
    ]),
    likelyCheckpoint: bundle.continuity.checkpointRefs.length > 0
      ? bundle.continuity.checkpointRefs[0]
      : undefined
  };
};
