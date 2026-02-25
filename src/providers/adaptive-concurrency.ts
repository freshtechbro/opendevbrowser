import type { AdaptiveConcurrencyDiagnostics } from "./types";

export interface AdaptiveConcurrencyConfig {
  enabled: boolean;
  baselineGlobal: number;
  baselineScoped: number;
  minGlobal?: number;
  maxGlobal: number;
  minScoped?: number;
  maxScoped: number;
  windowSize?: number;
  cooldownMs?: number;
  increaseStep?: number;
  decreaseFactor?: number;
  healthyLatencyMs?: number;
}

export interface AdaptiveSignal {
  latencyMs: number;
  timeout?: boolean;
  challenge?: boolean;
  http4xx?: boolean;
  http5xx?: boolean;
  queuePressure?: number;
}

type TrackState = {
  limit: number;
  lastAdjustedAt: number;
  samples: AdaptiveSignal[];
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const percentile = (values: number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
};

const rate = (values: AdaptiveSignal[], key: keyof AdaptiveSignal): number => {
  if (values.length === 0) return 0;
  const total = values.reduce((count, sample) => count + (sample[key] ? 1 : 0), 0);
  return total / values.length;
};

const queuePressure = (values: AdaptiveSignal[]): number => {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, sample) => sum + (sample.queuePressure ?? 0), 0);
  return total / values.length;
};

export class AdaptiveConcurrencyController {
  private readonly global: TrackState;
  private readonly scoped = new Map<string, TrackState>();
  private readonly minGlobal: number;
  private readonly minScoped: number;
  private readonly windowSize: number;
  private readonly cooldownMs: number;
  private readonly increaseStep: number;
  private readonly decreaseFactor: number;
  private readonly healthyLatencyMs: number;

  constructor(private readonly config: AdaptiveConcurrencyConfig) {
    this.minGlobal = Math.max(1, config.minGlobal ?? 1);
    this.minScoped = Math.max(1, config.minScoped ?? 1);
    this.windowSize = clamp(Math.floor(config.windowSize ?? 20), 5, 100);
    this.cooldownMs = clamp(Math.floor(config.cooldownMs ?? 3000), 250, 60000);
    this.increaseStep = clamp(Math.floor(config.increaseStep ?? 1), 1, 8);
    this.decreaseFactor = clamp(config.decreaseFactor ?? 0.7, 0.1, 0.95);
    this.healthyLatencyMs = clamp(Math.floor(config.healthyLatencyMs ?? 1200), 50, 60000);
    this.global = {
      limit: clamp(config.baselineGlobal, this.minGlobal, Math.max(this.minGlobal, config.maxGlobal)),
      lastAdjustedAt: 0,
      samples: []
    };
  }

  snapshot(scope: string): AdaptiveConcurrencyDiagnostics {
    if (!this.config.enabled) {
      return {
        enabled: false,
        scope,
        global: {
          limit: this.global.limit,
          min: this.minGlobal,
          max: this.config.maxGlobal
        },
        scoped: {
          limit: clamp(this.config.baselineScoped, this.minScoped, this.config.maxScoped),
          min: this.minScoped,
          max: this.config.maxScoped
        }
      };
    }

    const scoped = this.getScoped(scope);
    return {
      enabled: true,
      scope,
      global: {
        limit: this.global.limit,
        min: this.minGlobal,
        max: this.config.maxGlobal
      },
      scoped: {
        limit: scoped.limit,
        min: this.minScoped,
        max: this.config.maxScoped
      }
    };
  }

  observe(scope: string, signal: AdaptiveSignal, nowMs = Date.now()): void {
    if (!this.config.enabled) return;

    this.record(this.global, signal);
    const scoped = this.getScoped(scope);
    this.record(scoped, signal);

    this.adjust(this.global, this.minGlobal, this.config.maxGlobal, nowMs);
    this.adjust(scoped, this.minScoped, this.config.maxScoped, nowMs);
  }

  private getScoped(scope: string): TrackState {
    const existing = this.scoped.get(scope);
    if (existing) return existing;
    const next: TrackState = {
      limit: clamp(this.config.baselineScoped, this.minScoped, this.config.maxScoped),
      lastAdjustedAt: 0,
      samples: []
    };
    this.scoped.set(scope, next);
    return next;
  }

  private record(track: TrackState, signal: AdaptiveSignal): void {
    track.samples.push(signal);
    if (track.samples.length > this.windowSize) {
      track.samples.splice(0, track.samples.length - this.windowSize);
    }
  }

  private adjust(track: TrackState, min: number, max: number, nowMs: number): void {
    if (nowMs - track.lastAdjustedAt < this.cooldownMs) {
      return;
    }

    const samples = track.samples;
    const p95Latency = percentile(samples.map((sample) => sample.latencyMs), 0.95);
    const timeoutRate = rate(samples, "timeout");
    const challengeRate = rate(samples, "challenge");
    const http5xxRate = rate(samples, "http5xx");
    const http4xxRate = rate(samples, "http4xx");
    const avgQueuePressure = queuePressure(samples);

    const unhealthy = timeoutRate > 0
      || challengeRate > 0
      || http5xxRate > 0.15
      || http4xxRate > 0.3
      || p95Latency > this.healthyLatencyMs * 1.35
      || avgQueuePressure > 0.85;

    if (unhealthy) {
      const reduced = Math.floor(track.limit * this.decreaseFactor);
      track.limit = clamp(reduced, min, max);
      track.lastAdjustedAt = nowMs;
      return;
    }

    const healthy = timeoutRate === 0
      && challengeRate === 0
      && http5xxRate === 0
      && p95Latency <= this.healthyLatencyMs
      && avgQueuePressure < 0.6;

    if (healthy) {
      track.limit = clamp(track.limit + this.increaseStep, min, max);
      track.lastAdjustedAt = nowMs;
    }
  }
}
