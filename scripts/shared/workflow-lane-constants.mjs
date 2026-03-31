export const AUTH_GATED_SHOPPING_PROVIDERS = new Set([
  "shopping/costco",
  "shopping/macys"
]);

export const HIGH_FRICTION_SHOPPING_PROVIDERS = new Set([
  "shopping/bestbuy"
]);

export const DIRECT_SHOPPING_PROVIDER_TIMEOUT_MS = new Map([
  ["shopping/bestbuy", "120000"],
  ["shopping/ebay", "120000"],
  ["shopping/walmart", "120000"],
  ["shopping/target", "180000"],
  ["shopping/costco", "120000"],
  ["shopping/temu", "120000"]
]);

export const MATRIX_SHOPPING_PROVIDER_TIMEOUT_MS = new Map([
  ["shopping/bestbuy", "120000"],
  ["shopping/walmart", "120000"],
  ["shopping/target", "120000"],
  ["shopping/temu", "120000"]
]);

const BASE_ENV_LIMITED_CODES = [
  "unavailable",
  "env_limited",
  "auth",
  "rate_limited",
  "upstream",
  "network",
  "token_required",
  "challenge_detected",
  "cooldown_active",
  "policy_blocked",
  "caption_missing",
  "transcript_unavailable",
  "strategy_unapproved"
];

export const DIRECT_ENV_LIMITED_CODES = new Set(BASE_ENV_LIMITED_CODES);
export const MATRIX_ENV_LIMITED_CODES = new Set([
  ...BASE_ENV_LIMITED_CODES,
  "timeout"
]);

export const SOCIAL_POST_CASES = [
  { id: "provider.social.x.post", expression: '@social.post("x", "me", "ship realworld test", true, true)' },
  { id: "provider.social.instagram.post", expression: '@social.post("instagram", "me", "ship realworld test", true, true)' },
  { id: "provider.social.facebook.post", expression: '@social.post("facebook", "me", "ship realworld test", true, true)' }
];
