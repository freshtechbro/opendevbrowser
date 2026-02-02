import { randomUUID } from "crypto";

const HUB_INSTANCE_ID = randomUUID();
const BINDING_TTL_MS = 60_000;
const RENEW_INTERVAL_MS = 20_000;
const RENEW_GRACE_MS = RENEW_INTERVAL_MS * 2;
const RENEW_JITTER_MS = 2000;
const WAIT_MAX_MS = 30_000;

export type RelayBindingState = {
  bindingId: string;
  clientId: string;
  expiresAt: number;
  lastRenewedAt: number;
};

export type SessionLeaseState = {
  sessionId: string;
  leaseId: string;
  clientId: string;
  createdAt: number;
  lastUsedAt: number;
};

export type RelayBindingResponse = {
  bindingId: string;
  expiresAt: string;
  ttlMs: number;
  renewAfterMs: number;
};

export type RelayQueueResponse = {
  queued: true;
  position: number;
  waitUntil: string;
  waitMs: number;
};

export type RelayBindResult = RelayBindingResponse | RelayQueueResponse;

type RelayQueueEntry = {
  clientId: string;
  requestedAt: number;
  timeoutAt: number;
};

let binding: RelayBindingState | null = null;
let queue: RelayQueueEntry[] = [];
const sessionLeases = new Map<string, SessionLeaseState>();

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

const serializeQueue = (entry: RelayQueueEntry): RelayQueueResponse => ({
  queued: true,
  position: queue.findIndex((item) => item.clientId === entry.clientId) + 1,
  waitUntil: new Date(entry.timeoutAt).toISOString(),
  waitMs: Math.max(0, entry.timeoutAt - nowMs())
});

const cleanupQueue = (): void => {
  const now = nowMs();
  queue = queue.filter((entry) => entry.timeoutAt > now);
};

const getQueueEntry = (clientId: string): RelayQueueEntry | null => {
  return queue.find((entry) => entry.clientId === clientId) ?? null;
};

const enqueueClient = (clientId: string): RelayQueueEntry => {
  cleanupQueue();
  const existing = getQueueEntry(clientId);
  if (existing) {
    return existing;
  }
  const entry: RelayQueueEntry = {
    clientId,
    requestedAt: nowMs(),
    timeoutAt: nowMs() + WAIT_MAX_MS
  };
  queue.push(entry);
  return entry;
};

const dequeueClient = (clientId: string): void => {
  queue = queue.filter((entry) => entry.clientId !== clientId);
};

const maybeGrantBinding = (clientId: string): RelayBindingResponse | null => {
  const existing = getBindingState();
  const now = nowMs();

  if (existing) {
    if (existing.clientId !== clientId) {
      return null;
    }
    existing.expiresAt = now + BINDING_TTL_MS;
    existing.lastRenewedAt = now;
    return serializeBinding(existing);
  }

  cleanupQueue();
  const head = queue[0];
  if (head && head.clientId !== clientId) {
    return null;
  }
  if (head && head.clientId === clientId) {
    queue.shift();
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

export const getBindingState = (): RelayBindingState | null => {
  if (binding && isExpired(binding)) {
    binding = null;
  }
  cleanupQueue();
  return binding;
};

export const clearBinding = (): void => {
  binding = null;
  queue = [];
};

export const registerSessionLease = (sessionId: string, leaseId: string, clientId: string): SessionLeaseState => {
  if (!sessionId || !sessionId.trim()) {
    throw new Error("RELAY_SESSION_REQUIRED: sessionId is required");
  }
  if (!leaseId || !leaseId.trim()) {
    throw new Error("RELAY_LEASE_REQUIRED: leaseId is required");
  }
  if (!clientId || !clientId.trim()) {
    throw new Error("RELAY_CLIENT_ID_REQUIRED: clientId is required");
  }
  const lease: SessionLeaseState = {
    sessionId,
    leaseId,
    clientId: clientId.trim(),
    createdAt: nowMs(),
    lastUsedAt: nowMs()
  };
  sessionLeases.set(sessionId, lease);
  return lease;
};

export const getSessionLease = (sessionId: string): SessionLeaseState | null => {
  if (!sessionId || !sessionId.trim()) return null;
  return sessionLeases.get(sessionId) ?? null;
};

export const touchSessionLease = (sessionId: string): void => {
  const lease = sessionLeases.get(sessionId);
  if (!lease) return;
  lease.lastUsedAt = nowMs();
};

export const releaseSessionLease = (sessionId: string): void => {
  sessionLeases.delete(sessionId);
};

export const clearSessionLeases = (): void => {
  sessionLeases.clear();
};

export const requireSessionLease = (sessionId: string, clientId: string, leaseId: string | undefined): SessionLeaseState => {
  if (!sessionId || !sessionId.trim()) {
    throw new Error("RELAY_SESSION_REQUIRED: sessionId is required");
  }
  if (!clientId || !clientId.trim()) {
    throw new Error("RELAY_CLIENT_ID_REQUIRED: clientId is required");
  }
  const lease = sessionLeases.get(sessionId);
  if (!lease) {
    throw new Error("RELAY_LEASE_REQUIRED: No active lease for session.");
  }
  if (!leaseId || !leaseId.trim()) {
    throw new Error("RELAY_LEASE_REQUIRED: leaseId is required for session operations.");
  }
  if (lease.leaseId !== leaseId || lease.clientId !== clientId) {
    throw new Error("RELAY_LEASE_INVALID: Lease does not match session owner.");
  }
  lease.lastUsedAt = nowMs();
  return lease;
};

export const bindRelay = (clientId: string): RelayBindResult => {
  if (!clientId || !clientId.trim()) {
    throw new Error("RELAY_CLIENT_ID_REQUIRED: clientId is required");
  }

  const result = maybeGrantBinding(clientId);
  if (result) {
    return result;
  }

  const entry = enqueueClient(clientId.trim());
  return serializeQueue(entry);
};

export const waitForBinding = async (clientId: string, timeoutMs?: number): Promise<RelayBindingResponse> => {
  if (!clientId || !clientId.trim()) {
    throw new Error("RELAY_CLIENT_ID_REQUIRED: clientId is required");
  }

  const entry = enqueueClient(clientId.trim());
  const deadline = timeoutMs ? Math.min(entry.timeoutAt, nowMs() + timeoutMs) : entry.timeoutAt;

  while (nowMs() <= deadline) {
    const result = maybeGrantBinding(clientId);
    if (result) {
      return result;
    }
    cleanupQueue();
    if (!getQueueEntry(clientId)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  dequeueClient(clientId);
  throw new Error("RELAY_WAIT_TIMEOUT: Timed out waiting for relay binding.");
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
  queueLength: number;
} | null => {
  const existing = getBindingState();
  if (!existing) return null;
  const expiresInMs = Math.max(0, existing.expiresAt - nowMs());
  return {
    bindingId: existing.bindingId,
    clientId: existing.clientId,
    expiresAt: new Date(existing.expiresAt).toISOString(),
    expiresInMs,
    queueLength: queue.length
  };
};

export const getBindingRenewConfig = (): { ttlMs: number; renewIntervalMs: number; graceMs: number; waitMaxMs: number } => ({
  ttlMs: BINDING_TTL_MS,
  renewIntervalMs: RENEW_INTERVAL_MS,
  graceMs: RENEW_GRACE_MS,
  waitMaxMs: WAIT_MAX_MS
});
