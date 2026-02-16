import type { JsonValue, NormalizedRecord, ProviderSource } from "./types";
import type { ResolvedTimebox } from "./timebox";
import { isWithinTimebox } from "./timebox";

export interface EngagementMetrics {
  likes: number;
  comments: number;
  views: number;
  upvotes: number;
}

export interface RecencyMetadata {
  within_timebox: boolean;
  age_hours: number;
}

export interface DateConfidenceMetadata {
  score: number;
  source: "explicit" | "inferred" | "missing";
}

export interface ResearchRecord {
  id: string;
  source: ProviderSource;
  provider: string;
  url?: string;
  title?: string;
  content?: string;
  timestamp: string;
  confidence: number;
  engagement: EngagementMetrics;
  recency: RecencyMetadata;
  date_confidence: DateConfidenceMetadata;
  attributes: Record<string, JsonValue>;
}

const asNumber = (value: JsonValue | undefined): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 0;
};

const readEngagement = (attributes: Record<string, JsonValue>): EngagementMetrics => {
  const nested = (attributes.engagement ?? {}) as Record<string, JsonValue>;
  return {
    likes: asNumber(nested.likes ?? attributes.likes),
    comments: asNumber(nested.comments ?? attributes.comments),
    views: asNumber(nested.views ?? attributes.views),
    upvotes: asNumber(nested.upvotes ?? attributes.upvotes)
  };
};

const computeDateConfidence = (record: NormalizedRecord): DateConfidenceMetadata => {
  const timestamp = new Date(record.timestamp);
  if (!Number.isNaN(timestamp.getTime())) {
    return {
      score: 1,
      source: "explicit"
    };
  }

  const inferred = record.attributes.published_at;
  if (typeof inferred === "string" && !Number.isNaN(new Date(inferred).getTime())) {
    return {
      score: 0.6,
      source: "inferred"
    };
  }

  return {
    score: 0,
    source: "missing"
  };
};

const computeRecency = (
  record: NormalizedRecord,
  timebox: ResolvedTimebox,
  now: Date
): RecencyMetadata => {
  const parsed = new Date(record.timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return {
      within_timebox: false,
      age_hours: Number.POSITIVE_INFINITY
    };
  }

  const ageHours = Math.max(0, (now.getTime() - parsed.getTime()) / (60 * 60 * 1000));
  return {
    within_timebox: isWithinTimebox(record.timestamp, timebox, now),
    age_hours: Number(ageHours.toFixed(2))
  };
};

export const toResearchRecord = (
  record: NormalizedRecord,
  timebox: ResolvedTimebox,
  now: Date = new Date()
): ResearchRecord => {
  const engagement = readEngagement(record.attributes);
  const recency = computeRecency(record, timebox, now);
  const dateConfidence = computeDateConfidence(record);

  const engagementJson = {
    likes: engagement.likes,
    comments: engagement.comments,
    views: engagement.views,
    upvotes: engagement.upvotes
  };
  const recencyJson = {
    within_timebox: recency.within_timebox,
    age_hours: recency.age_hours
  };
  const dateConfidenceJson = {
    score: dateConfidence.score,
    source: dateConfidence.source
  };

  return {
    id: record.id,
    source: record.source,
    provider: record.provider,
    ...(record.url ? { url: record.url } : {}),
    ...(record.title ? { title: record.title } : {}),
    ...(record.content ? { content: record.content } : {}),
    timestamp: record.timestamp,
    confidence: record.confidence,
    engagement,
    recency,
    date_confidence: dateConfidence,
    attributes: {
      ...record.attributes,
      engagement: engagementJson,
      recency: recencyJson,
      date_confidence: dateConfidenceJson
    }
  };
};

export const enrichResearchRecords = (
  records: NormalizedRecord[],
  timebox: ResolvedTimebox,
  now: Date = new Date()
): ResearchRecord[] => {
  return records.map((record) => toResearchRecord(record, timebox, now));
};
