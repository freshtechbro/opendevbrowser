import type { CtaId } from "@/data/cta-registry";

export type DeviceType = "desktop" | "tablet" | "mobile";

export type CtaPayload = {
  event_name: "cta_click";
  route: `/${string}`;
  section_id: `${string}::${string}`;
  cta_id: CtaId;
  destination_url: string;
  timestamp: string;
  session_id: string;
  device_type: DeviceType;
};

const CTA_ID_PATTERN = /^[a-z0-9_]+$/u;
const SECTION_ID_PATTERN = /^(home|product|use-cases|workflows|security|open-source|docs|resources|company|global)::[a-z0-9-]+$/u;

export function getDeviceType(width: number): DeviceType {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

export function validateCtaPayload(payload: CtaPayload): void {
  if (payload.event_name !== "cta_click") {
    throw new Error("Only cta_click events are allowed");
  }
  if (!payload.route.startsWith("/") || payload.route === "/global" || payload.route === "/sitewide") {
    throw new Error(`Invalid route: ${payload.route}`);
  }
  if (!CTA_ID_PATTERN.test(payload.cta_id)) {
    throw new Error(`Invalid cta_id format: ${payload.cta_id}`);
  }
  if (!SECTION_ID_PATTERN.test(payload.section_id)) {
    throw new Error(`Invalid section_id format: ${payload.section_id}`);
  }
}

export function getAnalyticsSessionId(): string {
  const key = "odb-landing-session-id";
  const existing = window.sessionStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const id = window.crypto.randomUUID();
  window.sessionStorage.setItem(key, id);
  return id;
}

declare global {
  interface Window {
    opendevbrowserAnalytics?: { events: CtaPayload[] };
  }
}

export function dispatchCtaEvent(payload: CtaPayload): void {
  validateCtaPayload(payload);
  if (!window.opendevbrowserAnalytics) {
    window.opendevbrowserAnalytics = { events: [] };
  }
  window.opendevbrowserAnalytics.events.push(payload);
  window.dispatchEvent(new CustomEvent<CtaPayload>("cta_click", { detail: payload }));
}
