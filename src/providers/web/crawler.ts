import { evaluateWebCrawlPolicy, type WebCrawlPolicy } from "./policy";
import { createCrawlWorkerPool, extractCrawlContentInline, type CrawlWorkerPool } from "./crawl-worker";
import type { CrawlStrategy } from "../types";

export interface CrawlBudget {
  maxDepth: number;
  maxPages: number;
  maxPerDomain: number;
}

export interface CrawlPipelineBudget {
  workerThreads: number;
  queueMax: number;
  fetchConcurrency: number;
  frontierMax: number;
}

export interface CrawlPage {
  url: string;
  canonicalUrl: string;
  depth: number;
  status: number;
  text: string;
  links: string[];
  selectors: Record<string, string[]>;
  warnings: string[];
}

export interface CrawlMetrics {
  visited: number;
  fetched: number;
  deduped: number;
  elapsedMs: number;
  pagesPerMinute: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export interface CrawlResult {
  pages: CrawlPage[];
  graph: Array<{ from: string; to: string }>;
  warnings: string[];
  metrics: CrawlMetrics;
}

export interface CrawlFetcherResponse {
  url?: string;
  html: string;
  status?: number;
}

export type CrawlFetcher = (url: string) => Promise<CrawlFetcherResponse>;

export interface CrawlOptions {
  seeds: string[];
  strategy?: CrawlStrategy;
  budget?: Partial<CrawlBudget>;
  policy?: WebCrawlPolicy;
  selectors?: string[];
  pipeline?: Partial<CrawlPipelineBudget>;
  workerThreads?: number;
  queueMax?: number;
  forceInlineParse?: boolean;
  fetcher: CrawlFetcher;
}

interface FrontierNode {
  url: string;
  depth: number;
  sequence: number;
  firstSeenOrder: number;
  firstSeenAtMs: number;
  sourcePriority: number;
  stableRecordId: string;
}

interface CrawlTaskResult {
  sequence: number;
  firstSeenAtMs: number;
  sourcePriority: number;
  stableRecordId: string;
  page: CrawlPage | null;
  links: string[];
  warnings: string[];
  latencyMs: number;
}

interface CrawlPageEntry {
  page: CrawlPage;
  firstSeenAtMs: number;
  sourcePriority: number;
  stableRecordId: string;
  sequence: number;
}

const DEFAULT_BUDGET: CrawlBudget = {
  maxDepth: 2,
  maxPages: 20,
  maxPerDomain: 10
};

const DEFAULT_PIPELINE: CrawlPipelineBudget = {
  workerThreads: 2,
  queueMax: 64,
  fetchConcurrency: 4,
  frontierMax: 256
};

const TRACKING_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid"
]);

export const canonicalizeUrl = (rawUrl: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl.trim();
  }

  parsed.hash = "";
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
    parsed.port = "";
  }

  const next = new URL(parsed.toString());
  const params = [...next.searchParams.entries()]
    .filter(([key]) => !TRACKING_QUERY_KEYS.has(key.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  next.search = "";
  for (const [key, value] of params) {
    next.searchParams.append(key, value);
  }

  if (next.pathname.length > 1 && next.pathname.endsWith("/")) {
    next.pathname = next.pathname.slice(0, -1);
  }

  if (next.pathname === "/") {
    return `${next.protocol}//${next.host}${next.search}`;
  }

  return next.toString();
};

const percentile = (values: number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const compareFrontierNodes = (
  left: FrontierNode,
  right: FrontierNode,
  strategy: CrawlStrategy
): number => {
  if (left.depth !== right.depth) {
    return strategy === "dfs"
      ? right.depth - left.depth
      : left.depth - right.depth;
  }
  if (left.firstSeenOrder !== right.firstSeenOrder) {
    return strategy === "dfs"
      ? right.firstSeenOrder - left.firstSeenOrder
      : left.firstSeenOrder - right.firstSeenOrder;
  }
  if (left.sourcePriority !== right.sourcePriority) {
    return left.sourcePriority - right.sourcePriority;
  }
  if (left.sequence !== right.sequence) {
    return strategy === "dfs"
      ? right.sequence - left.sequence
      : left.sequence - right.sequence;
  }
  return left.url.localeCompare(right.url);
};

const dequeueNode = (
  frontier: FrontierNode[],
  strategy: CrawlStrategy
): FrontierNode | undefined => {
  if (frontier.length === 0) return undefined;
  frontier.sort((left, right) => compareFrontierNodes(left, right, strategy));
  return frontier.shift();
};

const resolveFrontierDomain = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "__invalid__";
  }
};

const enqueueFrontierNode = (
  frontierByDomain: Map<string, FrontierNode[]>,
  node: FrontierNode
): void => {
  const domain = resolveFrontierDomain(node.url);
  const queue = frontierByDomain.get(domain) ?? [];
  queue.push(node);
  frontierByDomain.set(domain, queue);
};

const frontierSize = (frontierByDomain: Map<string, FrontierNode[]>): number => {
  let size = 0;
  for (const queue of frontierByDomain.values()) {
    size += queue.length;
  }
  return size;
};

const dequeueFrontierByDomain = (
  frontierByDomain: Map<string, FrontierNode[]>,
  strategy: CrawlStrategy
): FrontierNode | undefined => {
  let selectedDomain: string | undefined;
  let selected: FrontierNode | undefined;

  for (const [domain, queue] of frontierByDomain.entries()) {
    if (queue.length === 0) continue;
    queue.sort((left, right) => compareFrontierNodes(left, right, strategy));
    const candidate = queue[0];
    if (!candidate) continue;
    if (!selected || compareFrontierNodes(candidate, selected, strategy) < 0) {
      selected = candidate;
      selectedDomain = domain;
    }
  }

  if (!selectedDomain || !selected) {
    return undefined;
  }

  const queue = frontierByDomain.get(selectedDomain);
  if (!queue || queue.length === 0) {
    return undefined;
  }
  const next = queue.shift();
  if (queue.length === 0) {
    frontierByDomain.delete(selectedDomain);
  }
  return next;
};

const waitForNextTask = async (
  tasks: Map<number, Promise<CrawlTaskResult>>
): Promise<CrawlTaskResult> => {
  return Promise.race([...tasks.values()]);
};

const sortPageEntries = (entries: CrawlPageEntry[]): CrawlPage[] => {
  return [...entries]
    .sort((left, right) => {
      if (left.firstSeenAtMs !== right.firstSeenAtMs) {
        return left.firstSeenAtMs - right.firstSeenAtMs;
      }
      if (left.sourcePriority !== right.sourcePriority) {
        return left.sourcePriority - right.sourcePriority;
      }
      if (left.stableRecordId !== right.stableRecordId) {
        return left.stableRecordId.localeCompare(right.stableRecordId);
      }
      return left.sequence - right.sequence;
    })
    .map((entry) => entry.page);
};

const executeTask = async (args: {
  node: FrontierNode;
  fetcher: CrawlFetcher;
  selectors: string[];
  policyWarnings: string[];
  workerPool: CrawlWorkerPool;
}): Promise<CrawlTaskResult> => {
  const startedAt = Date.now();
  const taskWarnings: string[] = [];
  let status = 0;
  let html = "";

  try {
    const response = await args.fetcher(args.node.url);
    status = response.status ?? 200;
    html = response.html;
  } catch {
    taskWarnings.push(`${args.node.url}: fetch failed`);
    return {
      sequence: args.node.sequence,
      firstSeenAtMs: args.node.firstSeenAtMs,
      sourcePriority: args.node.sourcePriority,
      stableRecordId: args.node.stableRecordId,
      page: null,
      links: [],
      warnings: taskWarnings,
      latencyMs: Math.max(0, Date.now() - startedAt)
    };
  }

  let extracted = extractCrawlContentInline({
    url: args.node.url,
    html,
    selectors: args.selectors
  });
  try {
    extracted = await args.workerPool.extract({
      url: args.node.url,
      html,
      selectors: args.selectors
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("crawl_worker_queue_overflow:")) {
      taskWarnings.push(`${args.node.url}: worker queue saturated`);
    } else {
      taskWarnings.push(`${args.node.url}: worker extraction fallback`);
    }
  }

  const links = extracted.links
    .map((link) => canonicalizeUrl(link))
    .filter((link) => isHttpUrl(link));

  return {
    sequence: args.node.sequence,
    firstSeenAtMs: args.node.firstSeenAtMs,
    sourcePriority: args.node.sourcePriority,
    stableRecordId: args.node.stableRecordId,
    page: {
      url: args.node.url,
      canonicalUrl: args.node.url,
      depth: args.node.depth,
      status,
      text: extracted.text,
      links,
      selectors: extracted.selectors,
      warnings: args.policyWarnings
    },
    links,
    warnings: taskWarnings,
    latencyMs: Math.max(0, Date.now() - startedAt)
  };
};

export const crawlWeb = async (options: CrawlOptions): Promise<CrawlResult> => {
  const startedAt = Date.now();
  const budget: CrawlBudget = {
    ...DEFAULT_BUDGET,
    ...(options.budget ?? {})
  };
  const pipeline: CrawlPipelineBudget = {
    ...DEFAULT_PIPELINE,
    ...(options.pipeline ?? {}),
    ...(typeof options.workerThreads === "number" ? { workerThreads: options.workerThreads } : {}),
    ...(typeof options.queueMax === "number" ? { queueMax: options.queueMax } : {})
  };

  const strategy: CrawlStrategy = options.strategy ?? "bfs";
  const fetchConcurrency = Math.max(1, Math.floor(pipeline.fetchConcurrency));
  const workerPool = createCrawlWorkerPool({
    workerThreads: pipeline.workerThreads,
    queueMax: pipeline.queueMax,
    forceInline: options.forceInlineParse
  });

  let nextSequence = 0;
  let nextFirstSeenOrder = 0;
  const frontierByDomain = new Map<string, FrontierNode[]>();
  const visited = new Set<string>();
  const queued = new Set<string>();
  for (const seed of options.seeds) {
    const canonicalSeed = canonicalizeUrl(seed);
    const node: FrontierNode = {
      url: canonicalSeed,
      depth: 0,
      sequence: nextSequence++,
      firstSeenOrder: nextFirstSeenOrder,
      firstSeenAtMs: startedAt + nextFirstSeenOrder,
      sourcePriority: 0,
      stableRecordId: canonicalSeed
    };
    nextFirstSeenOrder += 1;
    enqueueFrontierNode(frontierByDomain, node);
    queued.add(canonicalSeed);
  }
  const domainCounts = new Map<string, number>();
  const pageEntries: CrawlPageEntry[] = [];
  const graph: Array<{ from: string; to: string }> = [];
  const warnings: string[] = [];
  const latencies: number[] = [];
  let deduped = 0;

  const inFlight = new Map<number, Promise<CrawlTaskResult>>();
  const completed = new Map<number, CrawlTaskResult>();
  const scheduledOrder: number[] = [];
  let appliedOrderIndex = 0;

  try {
    while (frontierSize(frontierByDomain) > 0 || inFlight.size > 0) {
    while (
      frontierSize(frontierByDomain) > 0
      && inFlight.size < fetchConcurrency
      && pageEntries.length + inFlight.size < budget.maxPages
    ) {
      const node = dequeueFrontierByDomain(frontierByDomain, strategy);
      if (!node) break;

      queued.delete(node.url);
      if (visited.has(node.url)) {
        deduped += 1;
        continue;
      }

      const decision = evaluateWebCrawlPolicy(node.url, options.policy);
      if (!decision.allowed) {
        warnings.push(`${node.url}: ${decision.reason ?? "blocked"}`);
        continue;
      }
      if (decision.warnings.length > 0) {
        warnings.push(...decision.warnings.map((warning) => `${node.url}: ${warning}`));
      }

      let hostname: string;
      try {
        hostname = new URL(node.url).hostname.toLowerCase();
      } catch {
        warnings.push(`${node.url}: invalid hostname`);
        continue;
      }

      const currentDomainCount = domainCounts.get(hostname) ?? 0;
      if (currentDomainCount >= budget.maxPerDomain) {
        warnings.push(`${node.url}: per-domain budget exceeded`);
        continue;
      }

      visited.add(node.url);
      domainCounts.set(hostname, currentDomainCount + 1);

      const task = executeTask({
        node,
        fetcher: options.fetcher,
        selectors: options.selectors ?? [],
        policyWarnings: decision.warnings,
        workerPool
      });
      inFlight.set(node.sequence, task);
      scheduledOrder.push(node.sequence);
    }

    if (inFlight.size === 0) {
      break;
    }

    const completedTask = await waitForNextTask(inFlight);
    inFlight.delete(completedTask.sequence);
    completed.set(completedTask.sequence, completedTask);

    while (appliedOrderIndex < scheduledOrder.length) {
      const sequence = scheduledOrder[appliedOrderIndex];
      if (typeof sequence !== "number") break;
      const ready = completed.get(sequence);
      if (!ready) break;

      appliedOrderIndex += 1;
      completed.delete(sequence);
      latencies.push(ready.latencyMs);
      if (ready.warnings.length > 0) {
        warnings.push(...ready.warnings);
      }
      if (!ready.page) {
        continue;
      }

      pageEntries.push({
        page: ready.page,
        firstSeenAtMs: ready.firstSeenAtMs,
        sourcePriority: ready.sourcePriority,
        stableRecordId: ready.stableRecordId,
        sequence: ready.sequence
      });
      if (pageEntries.length >= budget.maxPages) {
        continue;
      }

      for (const link of ready.links) {
        graph.push({ from: ready.page.url, to: link });
        if (ready.page.depth >= budget.maxDepth) continue;

        const linkDecision = evaluateWebCrawlPolicy(link, options.policy);
        if (!linkDecision.allowed) {
          warnings.push(`${link}: ${linkDecision.reason ?? "blocked"}`);
          continue;
        }
        if (linkDecision.warnings.length > 0) {
          warnings.push(...linkDecision.warnings.map((warning) => `${link}: ${warning}`));
        }

        if (visited.has(link) || queued.has(link)) {
          deduped += 1;
          continue;
        }
        if (frontierSize(frontierByDomain) >= pipeline.frontierMax) {
          warnings.push(`${link}: crawl frontier saturated`);
          continue;
        }

        const node: FrontierNode = {
          url: link,
          depth: ready.page.depth + 1,
          sequence: nextSequence++,
          firstSeenOrder: nextFirstSeenOrder,
          firstSeenAtMs: startedAt + nextFirstSeenOrder,
          sourcePriority: 1,
          stableRecordId: canonicalizeUrl(link)
        };
        nextFirstSeenOrder += 1;
        enqueueFrontierNode(frontierByDomain, node);
        queued.add(link);
      }
    }
  }
  } finally {
    await workerPool.close();
  }

  const pages = sortPageEntries(pageEntries);
  const elapsedMs = Math.max(1, Date.now() - startedAt);
  const pagesPerMinute = pages.length / (elapsedMs / 60000);

  return {
    pages,
    graph,
    warnings,
    metrics: {
      visited: visited.size,
      fetched: pages.length,
      deduped,
      elapsedMs,
      pagesPerMinute,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95)
    }
  };
};

export const __test__ = {
  percentile,
  isHttpUrl,
  compareFrontierNodes,
  dequeueNode,
  resolveFrontierDomain,
  enqueueFrontierNode,
  frontierSize,
  dequeueFrontierByDomain,
  sortPageEntries,
  waitForNextTask
};
