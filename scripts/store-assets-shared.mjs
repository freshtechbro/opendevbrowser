export const STORE_ASSET_SPECS = [
  { filename: "icon-store-128.png", width: 128, height: 128, required: true },
  { filename: "promo-small-440x280.png", width: 440, height: 280, required: true },
  { filename: "promo-marquee-1400x560.png", width: 1400, height: 560, required: true },
  { filename: "screenshot-automation-demo.png", width: 1280, height: 800, required: true },
  { filename: "screenshot-popup-connected.png", width: 1280, height: 800, required: true },
  { filename: "screenshot-popup-disconnected.png", width: 1280, height: 800, required: true },
  { filename: "screenshot-canvas.png", width: 1280, height: 800, required: false }
];

export function requiredStoreAssetSpecs() {
  return STORE_ASSET_SPECS.filter((spec) => spec.required);
}

export function scoreExtensionCaptureCandidate(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return 0;
  }

  const normalized = candidate.toLowerCase();
  if (normalized.includes("google chrome for testing") || normalized.includes("/chromium.app/")) {
    return 4;
  }
  if (normalized.includes("chrome canary")) {
    return 3;
  }
  if (normalized.includes("/google chrome.app/")) {
    return 2;
  }
  return 1;
}

export function sortExtensionCaptureCandidates(candidates) {
  return [...new Set(candidates)]
    .filter((candidate) => typeof candidate === "string" && candidate.length > 0)
    .sort((left, right) => {
      const scoreDiff = scoreExtensionCaptureCandidate(right) - scoreExtensionCaptureCandidate(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return left.localeCompare(right);
    });
}
