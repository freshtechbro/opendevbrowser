export interface TimeboxInput {
  days?: number;
  from?: string;
  to?: string;
  now?: Date;
  allowDaysWithRange?: boolean;
}

export interface ResolvedTimebox {
  mode: "days" | "range";
  days?: number;
  from: string;
  to: string;
  applied: true;
}

const MAX_DAYS = 365;

const ensureIsoDate = (value: string, label: string): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} date: ${value}`);
  }
  return date;
};

const clampDays = (days: number): number => {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("days must be a positive number");
  }
  return Math.min(MAX_DAYS, Math.floor(days));
};

export const resolveTimebox = (input: TimeboxInput): ResolvedTimebox => {
  const now = input.now ?? new Date();
  const hasDays = typeof input.days === "number";
  const hasFrom = typeof input.from === "string" && input.from.trim().length > 0;
  const hasTo = typeof input.to === "string" && input.to.trim().length > 0;

  if (hasDays && (hasFrom || hasTo) && !input.allowDaysWithRange) {
    throw new Error("days cannot be combined with from/to");
  }

  if (hasTo && !hasFrom && !hasDays) {
    throw new Error("to cannot be provided without from or days");
  }

  if (hasDays) {
    const days = clampDays(input.days as number);
    const toDate = now;
    const fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
    return {
      mode: "days",
      days,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      applied: true
    };
  }

  if (hasFrom) {
    const fromDate = ensureIsoDate(input.from as string, "from");
    const toDate = hasTo ? ensureIsoDate(input.to as string, "to") : now;
    if (fromDate.getTime() > toDate.getTime()) {
      throw new Error("from cannot be later than to");
    }
    const diffMs = toDate.getTime() - fromDate.getTime();
    const days = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
    return {
      mode: "range",
      days,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      applied: true
    };
  }

  const defaultDays = 30;
  const toDate = now;
  const fromDate = new Date(toDate.getTime() - defaultDays * 24 * 60 * 60 * 1000);
  return {
    mode: "days",
    days: defaultDays,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    applied: true
  };
};

export const isWithinTimebox = (
  timestamp: string | undefined,
  timebox: ResolvedTimebox,
  now?: Date
): boolean => {
  if (!timestamp) return false;
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return false;
  const from = new Date(timebox.from).getTime();
  const to = new Date(timebox.to).getTime();
  const upperBound =
    timebox.mode === "days" ? Math.max(to, now?.getTime() ?? to) : to;
  const current = value.getTime();
  return current >= from && current <= upperBound;
};

export const filterByTimebox = <T extends { timestamp?: string }>(
  records: T[],
  timebox: ResolvedTimebox,
  now?: Date
): T[] => {
  return records.filter((record) =>
    isWithinTimebox(record.timestamp, timebox, now)
  );
};
