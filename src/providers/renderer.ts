import { canonicalizeUrl } from "./web/crawler";
import type { ResearchRecord } from "./enrichment";

export type RenderMode = "compact" | "json" | "md" | "context" | "path";

export interface ShoppingOffer {
  offer_id: string;
  product_id: string;
  provider: string;
  url: string;
  title: string;
  price: {
    amount: number;
    currency: string;
    retrieved_at: string;
  };
  shipping: {
    amount: number;
    currency: string;
    notes: string;
  };
  availability: "in_stock" | "limited" | "out_of_stock" | "unknown";
  rating: number;
  reviews_count: number;
  deal_score: number;
  attributes: Record<string, unknown>;
}

const toCurrency = (value: number): string => `$${value.toFixed(2)}`;

const compactResearchLines = (records: ResearchRecord[]): string[] => {
  if (records.length === 0) {
    return ["No records matched the requested timebox."];
  }
  return records.slice(0, 10).map((record, index) => {
    const title = record.title ?? record.url ?? record.provider;
    const engagement = record.engagement.likes + record.engagement.comments + record.engagement.upvotes;
    return `${index + 1}. ${title} (${record.source}/${record.provider}) score=${record.confidence.toFixed(2)} engagement=${engagement}`;
  });
};

export const renderResearch = (args: {
  mode: RenderMode;
  topic: string;
  records: ResearchRecord[];
  meta: Record<string, unknown>;
}): {
  response: Record<string, unknown>;
  files: Array<{ path: string; content: string | Record<string, unknown> }>;
} => {
  const lines = compactResearchLines(args.records);
  const summary = lines.join("\n");
  const markdown = [
    `# Research: ${args.topic}`,
    "",
    ...lines,
    "",
    "## Metadata",
    "```json",
    JSON.stringify(args.meta, null, 2),
    "```"
  ].join("\n");
  const contextPayload = {
    topic: args.topic,
    highlights: lines,
    records: args.records,
    meta: args.meta
  };

  const files = [
    { path: "summary.md", content: markdown },
    { path: "records.json", content: { records: args.records } },
    { path: "context.json", content: contextPayload },
    { path: "meta.json", content: args.meta }
  ];

  if (args.mode === "compact") {
    return {
      response: {
        mode: args.mode,
        summary,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "json") {
    return {
      response: {
        mode: args.mode,
        records: args.records,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "md") {
    return {
      response: {
        mode: args.mode,
        markdown,
        meta: args.meta
      },
      files
    };
  }

  if (args.mode === "context") {
    return {
      response: {
        mode: args.mode,
        context: contextPayload,
        meta: args.meta
      },
      files
    };
  }

  return {
    response: {
      mode: "path",
      meta: args.meta
    },
    files
  };
};

const toComparisonCsv = (offers: ShoppingOffer[]): string => {
  const header = ["provider", "title", "price", "shipping", "deal_score", "availability", "url"].join(",");
  const rows = offers.map((offer) => {
    return [
      offer.provider,
      JSON.stringify(offer.title),
      offer.price.amount.toFixed(2),
      offer.shipping.amount.toFixed(2),
      offer.deal_score.toFixed(4),
      offer.availability,
      canonicalizeUrl(offer.url)
    ].join(",");
  });
  return [header, ...rows].join("\n");
};

const compactShoppingLines = (offers: ShoppingOffer[]): string[] => {
  if (offers.length === 0) {
    return ["No offers available from the selected providers."];
  }
  return offers.slice(0, 10).map((offer, index) => {
    const total = offer.price.amount + offer.shipping.amount;
    return `${index + 1}. ${offer.title} - ${toCurrency(total)} (${offer.provider}, deal=${offer.deal_score.toFixed(2)})`;
  });
};

export const renderShopping = (args: {
  mode: RenderMode;
  query: string;
  offers: ShoppingOffer[];
  meta: Record<string, unknown>;
}): {
  response: Record<string, unknown>;
  files: Array<{ path: string; content: string | Record<string, unknown> }>;
} => {
  const lines = compactShoppingLines(args.offers);
  const markdown = [
    `# Shopping: ${args.query}`,
    "",
    ...lines,
    "",
    "## Metadata",
    "```json",
    JSON.stringify(args.meta, null, 2),
    "```"
  ].join("\n");

  const comparisonCsv = toComparisonCsv(args.offers);
  const contextPayload = {
    query: args.query,
    highlights: lines,
    offers: args.offers,
    meta: args.meta
  };

  const files = [
    { path: "deals.md", content: markdown },
    { path: "offers.json", content: { offers: args.offers } },
    { path: "comparison.csv", content: comparisonCsv },
    { path: "meta.json", content: args.meta },
    { path: "deals-context.json", content: contextPayload }
  ];

  if (args.mode === "compact") {
    return {
      response: {
        mode: args.mode,
        summary: lines.join("\n"),
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "json") {
    return {
      response: {
        mode: args.mode,
        offers: args.offers,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "md") {
    return {
      response: {
        mode: args.mode,
        markdown,
        meta: args.meta
      },
      files
    };
  }
  if (args.mode === "context") {
    return {
      response: {
        mode: args.mode,
        context: contextPayload,
        meta: args.meta
      },
      files
    };
  }

  return {
    response: {
      mode: "path",
      meta: args.meta
    },
    files
  };
};
