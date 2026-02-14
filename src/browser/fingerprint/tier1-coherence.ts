export type Tier1GeoPoint = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};

export type Tier1CoherenceConfig = {
  enabled: boolean;
  warnOnly: boolean;
  expectedLocale?: string;
  expectedTimezone?: string;
  expectedLanguages: string[];
  requireProxy: boolean;
  geolocationRequired: boolean;
};

export type Tier1CoherenceInput = {
  locale?: string;
  timezone?: string;
  languages: string[];
  proxy?: string;
  geolocation?: Tier1GeoPoint;
};

export type Tier1Issue = {
  code: string;
  field: string;
  message: string;
  expected?: string;
  actual?: string;
};

export type Tier1CoherenceResult = {
  ok: boolean;
  warnings: string[];
  issues: Tier1Issue[];
};

const TIMEZONE_REGION_MAP: Record<string, string> = {
  America: "US",
  Europe: "EU",
  Asia: "AS",
  Africa: "AF",
  Australia: "OC",
  Pacific: "OC"
};

function normalizeLocale(value: string | undefined): string | undefined {
  return value?.trim().replace("_", "-").toLowerCase();
}

function normalizeTimezone(value: string | undefined): string | undefined {
  return value?.trim();
}

function localeRegion(locale: string | undefined): string | undefined {
  if (!locale) return undefined;
  const parts = locale.split("-");
  const region = parts[1];
  return region ? region.toUpperCase() : undefined;
}

function timezoneRegion(timezone: string | undefined): string | undefined {
  if (!timezone) return undefined;
  const top = timezone.split("/")[0];
  if (!top) return undefined;
  return TIMEZONE_REGION_MAP[top];
}

function isLocaleTimezoneCompatible(locale: string | undefined, timezone: string | undefined): boolean {
  const region = localeRegion(locale);
  const tzRegion = timezoneRegion(timezone);
  if (!region || !tzRegion) return true;
  if (region === "US" && tzRegion === "US") return true;
  if (region === "CA" && tzRegion === "US") return true;
  if (region === "GB" && tzRegion === "EU") return true;
  if (region === "FR" && tzRegion === "EU") return true;
  if (region === "DE" && tzRegion === "EU") return true;
  if (region === "JP" && tzRegion === "AS") return true;
  if (region === "CN" && tzRegion === "AS") return true;
  if (region === "IN" && tzRegion === "AS") return true;
  if (region === "AU" && tzRegion === "OC") return true;
  return false;
}

export function evaluateTier1Coherence(
  config: Tier1CoherenceConfig,
  input: Tier1CoherenceInput
): Tier1CoherenceResult {
  if (!config.enabled) {
    return { ok: true, warnings: [], issues: [] };
  }

  const issues: Tier1Issue[] = [];
  const locale = normalizeLocale(input.locale);
  const expectedLocale = normalizeLocale(config.expectedLocale);
  if (expectedLocale && locale && expectedLocale !== locale) {
    issues.push({
      code: "locale_mismatch",
      field: "locale",
      expected: expectedLocale,
      actual: locale,
      message: `Locale mismatch: expected ${expectedLocale}, got ${locale}.`
    });
  }

  const timezone = normalizeTimezone(input.timezone);
  const expectedTimezone = normalizeTimezone(config.expectedTimezone);
  if (expectedTimezone && timezone && expectedTimezone !== timezone) {
    issues.push({
      code: "timezone_mismatch",
      field: "timezone",
      expected: expectedTimezone,
      actual: timezone,
      message: `Timezone mismatch: expected ${expectedTimezone}, got ${timezone}.`
    });
  }

  const expectedLanguage = config.expectedLanguages[0]?.toLowerCase();
  const actualLanguage = input.languages[0]?.toLowerCase();
  if (expectedLanguage && actualLanguage && expectedLanguage !== actualLanguage) {
    issues.push({
      code: "language_mismatch",
      field: "languages",
      expected: expectedLanguage,
      actual: actualLanguage,
      message: `Language mismatch: expected ${expectedLanguage}, got ${actualLanguage}.`
    });
  }

  const localeLanguage = locale?.split("-")[0];
  if (localeLanguage && actualLanguage && !actualLanguage.startsWith(localeLanguage)) {
    issues.push({
      code: "locale_language_incoherent",
      field: "languages",
      expected: localeLanguage,
      actual: actualLanguage,
      message: `Locale/language mismatch: locale ${locale} conflicts with language ${actualLanguage}.`
    });
  }

  if (!isLocaleTimezoneCompatible(locale, timezone)) {
    issues.push({
      code: "locale_timezone_incoherent",
      field: "timezone",
      expected: localeRegion(locale),
      actual: timezoneRegion(timezone),
      message: `Locale/timezone mismatch: locale ${locale ?? "unknown"} conflicts with timezone ${timezone ?? "unknown"}.`
    });
  }

  if (config.requireProxy && !input.proxy) {
    issues.push({
      code: "proxy_missing",
      field: "proxy",
      message: "Proxy is required for this profile but missing."
    });
  }

  if (config.geolocationRequired && !input.geolocation) {
    issues.push({
      code: "geolocation_missing",
      field: "geolocation",
      message: "Geolocation is required for this profile but missing."
    });
  }

  return {
    ok: issues.length === 0,
    warnings: issues.map((issue) => issue.message),
    issues
  };
}

export function formatTier1Warnings(result: Tier1CoherenceResult): string[] {
  if (result.ok) return [];
  return result.warnings.map((message) => `[fingerprint:tier1] ${message}`);
}
