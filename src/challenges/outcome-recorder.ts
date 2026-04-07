import type { OutcomeRecord } from "./types";

const MAX_RECORDS_PER_CHALLENGE = 25;

export class OutcomeRecorder {
  private readonly records = new Map<string, OutcomeRecord[]>();

  record(record: OutcomeRecord): void {
    const key = record.challengeId ?? "__untracked__";
    const existing = this.records.get(key) ?? [];
    const next = [...existing, record].slice(-MAX_RECORDS_PER_CHALLENGE);
    this.records.set(key, next);
  }

  latest(challengeId: string | undefined): OutcomeRecord | undefined {
    if (!challengeId) return undefined;
    const entries = this.records.get(challengeId);
    return entries?.[entries.length - 1];
  }

  read(challengeId: string | undefined): OutcomeRecord[] {
    if (!challengeId) return [];
    return [...(this.records.get(challengeId) ?? [])];
  }
}
