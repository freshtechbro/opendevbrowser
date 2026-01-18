import { randomUUID } from "crypto";

const HUB_INSTANCE_ID = randomUUID();
const BINDING_TTL_MS = 60_000;
const RENEW_INTERVAL_MS = 20_000;
const RENEW_GRACE_MS = RENEW_INTERVAL_MS * 2;
const RENEW_JITTER_MS = 2000;

export type RelayBindingState = {
  bindingId: string;
  clientId: string;
  expiresAt: number;
  lastRenewedAt: number;
};

export type RelayBindingResponse = {
  bindingId: string;
  expiresAt: string;
  ttlMs: number;
  renewAfterMs: number;
};

let binding: RelayBindingState | null = null;

export const getHubInstanceId = (): string => HUB_INSTANCE_ID;

const nowMs = (): number => Date.now();

const isExpired = (state: RelayBindingState): boolean => nowMs() > state.expiresAt + RENEW_GRACE_MS;

const computeRenewAfterMs = (): number => {
  const jitter = Math.floor((Math.random() * 2 - 1) * RENEW_JITTER_MS);
  return Math.max(1000, RENEW_INTERVAL_MS + jitter);
};

const serializeBinding = (state: RelayBindingState): RelayBindingResponse => ({
  bindingId: state.bindingId,
  expiresAt: new Date(state.expiresAt).toISOString(),
  ttlMs: BINDING_TTL_MS,
  renewAfterMs: computeRenewAfterMs()
});

export const getBindingState = (): RelayBindingState | null => {
  if (binding && isExpired(binding)) {
    binding = null;
  }
  return binding;
};

export const clearBinding = (): void => {
  binding = null;
};

export const bindRelay = (clientId: string): RelayBindingResponse => {
  if (!clientId || !clientId.trim()) {
    throw new Error("RELAY_CLIENT_ID_REQUIRED: clientId is required");
  }

  const existing = getBindingState();
  const now = nowMs();

  if (existing) {
    if (existing.clientId !== clientId) {
      throw new Error(`RELAY_BUSY: Relay binding held by another client until ${new Date(existing.expiresAt).toISOString()}.`);
    }
    existing.expiresAt = now + BINDING_TTL_MS;
    existing.lastRenewedAt = now;
    return serializeBinding(existing);
  }

  const state: RelayBindingState = {
    bindingId: randomUUID(),
    clientId: clientId.trim(),
    expiresAt: now + BINDING_TTL_MS,
    lastRenewedAt: now
  };
  binding = state;
  return serializeBinding(state);
};

export const renewRelay = (clientId: string, bindingId: string): RelayBindingResponse => {
  if (!clientId || !clientId.trim()) {
    throw new Error("RELAY_CLIENT_ID_REQUIRED: clientId is required");
  }
  if (!bindingId || !bindingId.trim()) {
    throw new Error("RELAY_BINDING_REQUIRED: bindingId is required");
  }
  const existing = getBindingState();
  if (!existing) {
    throw new Error("RELAY_BINDING_REQUIRED: No active binding to renew.");
  }
  if (existing.clientId !== clientId || existing.bindingId !== bindingId) {
    throw new Error("RELAY_BINDING_INVALID: Binding does not match the current owner.");
  }
  const now = nowMs();
  existing.expiresAt = now + BINDING_TTL_MS;
  existing.lastRenewedAt = now;
  return serializeBinding(existing);
};

export const releaseRelay = (clientId: string, bindingId: string): { released: boolean } => {
  if (!clientId || !clientId.trim()) {
    throw new Error("RELAY_CLIENT_ID_REQUIRED: clientId is required");
  }
  if (!bindingId || !bindingId.trim()) {
    throw new Error("RELAY_BINDING_REQUIRED: bindingId is required");
  }
  const existing = getBindingState();
  if (!existing) {
    return { released: false };
  }
  if (existing.clientId !== clientId || existing.bindingId !== bindingId) {
    throw new Error("RELAY_BINDING_INVALID: Binding does not match the current owner.");
  }
  binding = null;
  return { released: true };
};

export const requireBinding = (clientId: string, bindingId: string | undefined): RelayBindingState => {
  if (!clientId || !clientId.trim()) {
    throw new Error("RELAY_CLIENT_ID_REQUIRED: clientId is required");
  }
  const existing = getBindingState();
  if (!existing) {
    throw new Error("RELAY_BINDING_REQUIRED: Call relay.bind to acquire the relay binding.");
  }
  if (!bindingId || !bindingId.trim()) {
    throw new Error("RELAY_BINDING_REQUIRED: bindingId is required for relay operations.");
  }
  if (existing.clientId !== clientId || existing.bindingId !== bindingId) {
    throw new Error("RELAY_BINDING_INVALID: Binding does not match the current owner.");
  }
  return existing;
};

export const getBindingDiagnostics = (): {
  bindingId: string;
  clientId: string;
  expiresAt: string;
  expiresInMs: number;
} | null => {
  const existing = getBindingState();
  if (!existing) return null;
  const expiresInMs = Math.max(0, existing.expiresAt - nowMs());
  return {
    bindingId: existing.bindingId,
    clientId: existing.clientId,
    expiresAt: new Date(existing.expiresAt).toISOString(),
    expiresInMs
  };
};

export const getBindingRenewConfig = (): { ttlMs: number; renewIntervalMs: number; graceMs: number } => ({
  ttlMs: BINDING_TTL_MS,
  renewIntervalMs: RENEW_INTERVAL_MS,
  graceMs: RENEW_GRACE_MS
});
