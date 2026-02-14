import { Worker, isMainThread } from "node:worker_threads";
import { extractStructuredContent, type ExtractedContent } from "./extract";

export interface CrawlExtractInput {
  url: string;
  html: string;
  selectors: string[];
}

export interface CrawlWorkerPoolOptions {
  workerThreads?: number;
  queueMax?: number;
  forceInline?: boolean;
}

interface WorkerExtractRequest {
  id: number;
  url: string;
  html: string;
  selectors: string[];
}

interface WorkerExtractSuccess {
  id: number;
  ok: true;
  extracted: ExtractedContent;
}

interface WorkerExtractFailure {
  id: number;
  ok: false;
  error: string;
}

type WorkerExtractResponse = WorkerExtractSuccess | WorkerExtractFailure;

interface CrawlTask {
  id: number;
  input: CrawlExtractInput;
  resolve: (value: ExtractedContent) => void;
  reject: (error: Error) => void;
}

interface WorkerHandle {
  worker: Worker;
  busy: boolean;
  taskId?: number;
}

const DEFAULT_WORKER_THREADS = 0;
const DEFAULT_QUEUE_MAX = 16;

const WORKER_SCRIPT = `
const { parentPort } = require("node:worker_threads");

const SCRIPT_STYLE_RE = /<(script|style)[^>]*>[\\s\\S]*?<\\/\\1>/gi;
const TAG_RE = /<[^>]+>/g;
const SPACE_RE = /\\s+/g;
const HREF_RE = /href\\s*=\\s*(["'])(.*?)\\1/gi;

const extractText = (html) => {
  return String(html)
    .replace(SCRIPT_STYLE_RE, " ")
    .replace(TAG_RE, " ")
    .replace(SPACE_RE, " ")
    .trim();
};

const normalizeLink = (href, baseUrl) => {
  if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return null;
  }
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
};

const extractLinks = (html, baseUrl) => {
  const links = new Set();
  for (const match of String(html).matchAll(HREF_RE)) {
    const raw = match[2]?.trim();
    if (!raw) continue;
    const normalized = normalizeLink(raw, baseUrl);
    if (!normalized) continue;
    links.add(normalized);
  }
  return [...links];
};

const selectorRegex = (selector) => {
  const safe = selector.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, "\\\\$&");
  if (selector.startsWith("#")) {
    const id = selector.slice(1).replace(/[-/\\\\^$*+?.()|[\\]{}]/g, "\\\\$&");
    return new RegExp(\`<([a-z0-9-]+)[^>]*id=["']\${id}["'][^>]*>([\\\\s\\\\S]*?)<\\\\/\\\\1>\`, "gi");
  }
  if (selector.startsWith(".")) {
    const className = selector.slice(1).replace(/[-/\\\\^$*+?.()|[\\]{}]/g, "\\\\$&");
    return new RegExp(\`<([a-z0-9-]+)[^>]*class=["'][^"']*\\\\b\${className}\\\\b[^"']*["'][^>]*>([\\\\s\\\\S]*?)<\\\\/\\\\1>\`, "gi");
  }
  return new RegExp(\`<\${safe}[^>]*>([\\\\s\\\\S]*?)<\\\\/\${safe}>\`, "gi");
};

const extractSelectors = (html, selectors = []) => {
  const out = {};
  for (const selector of selectors) {
    const values = [];
    for (const match of String(html).matchAll(selectorRegex(selector))) {
      const text = extractText(match[2] ?? match[1] ?? "");
      if (text) values.push(text);
    }
    out[selector] = values;
  }
  return out;
};

const extractStructuredContent = (html, baseUrl, selectors = []) => {
  return {
    text: extractText(html),
    links: extractLinks(html, baseUrl),
    selectors: extractSelectors(html, selectors)
  };
};

parentPort?.on("message", (message) => {
  const id = typeof message?.id === "number" ? message.id : null;
  if (id === null) return;

  try {
    const extracted = extractStructuredContent(
      String(message.html ?? ""),
      String(message.url ?? ""),
      Array.isArray(message.selectors) ? message.selectors.map((value) => String(value)) : []
    );
    parentPort?.postMessage({
      id,
      ok: true,
      extracted
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    parentPort?.postMessage({
      id,
      ok: false,
      error: reason
    });
  }
});
`;

const supportsWorkerThreads = (): boolean => {
  return isMainThread && typeof Worker === "function";
};

const toError = (error: unknown, fallback: string): Error => {
  if (error instanceof Error) return error;
  return new Error(error === undefined ? fallback : String(error));
};

export class CrawlWorkerPool {
  private readonly queueMax: number;
  private readonly queue: CrawlTask[] = [];
  private readonly inFlight = new Map<number, CrawlTask>();
  private readonly workers: WorkerHandle[] = [];
  private nextTaskId = 1;
  private inlineOnly: boolean;
  private closed = false;

  constructor(options: CrawlWorkerPoolOptions = {}) {
    const requestedWorkers = Math.max(0, Math.floor(options.workerThreads ?? DEFAULT_WORKER_THREADS));
    this.queueMax = Math.max(1, Math.floor(options.queueMax ?? DEFAULT_QUEUE_MAX));
    this.inlineOnly = options.forceInline === true || requestedWorkers === 0 || !supportsWorkerThreads();

    if (!this.inlineOnly) {
      for (let index = 0; index < requestedWorkers; index += 1) {
        this.spawnWorker();
      }
      if (this.workers.length === 0) {
        this.inlineOnly = true;
      }
    }
  }

  async extract(input: CrawlExtractInput): Promise<ExtractedContent> {
    if (this.closed) {
      throw new Error("crawl_worker_pool_closed");
    }

    if (this.inlineOnly) {
      return extractStructuredContent(input.html, input.url, input.selectors);
    }

    if (this.queue.length + this.inFlight.size >= this.queueMax) {
      throw new Error(`crawl_worker_queue_overflow:${this.queueMax}`);
    }

    const taskId = this.nextTaskId;
    this.nextTaskId += 1;

    return new Promise<ExtractedContent>((resolve, reject) => {
      this.queue.push({ id: taskId, input, resolve, reject });
      this.dispatch();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const closingError = new Error("crawl_worker_pool_closed");
    for (const task of this.queue.splice(0)) {
      task.reject(closingError);
    }
    for (const task of this.inFlight.values()) {
      task.reject(closingError);
    }
    this.inFlight.clear();

    const handles = this.workers.splice(0);
    await Promise.all(handles.map((handle) => {
      return handle.worker.terminate()
        .then(() => undefined)
        .catch(() => undefined);
    }));
  }

  private spawnWorker(): void {
    try {
      const worker = new Worker(WORKER_SCRIPT, {
        eval: true
      });
      const handle: WorkerHandle = {
        worker,
        busy: false
      };

      worker.on("message", (message: unknown) => {
        this.handleWorkerMessage(handle, message);
      });

      worker.on("error", (error) => {
        this.handleWorkerFailure(handle, error);
      });

      worker.on("exit", (code) => {
        if (code !== 0) {
          this.handleWorkerFailure(handle, new Error(`crawl_worker_exit:${code}`));
        }
      });

      this.workers.push(handle);
    } catch {
      this.inlineOnly = true;
    }
  }

  private dispatch(): void {
    if (this.inlineOnly || this.closed) return;
    for (const handle of this.workers) {
      if (handle.busy) continue;
      const task = this.queue.shift();
      if (!task) return;

      handle.busy = true;
      handle.taskId = task.id;
      this.inFlight.set(task.id, task);

      const request: WorkerExtractRequest = {
        id: task.id,
        url: task.input.url,
        html: task.input.html,
        selectors: task.input.selectors
      };

      try {
        handle.worker.postMessage(request);
      } catch (error) {
        this.inFlight.delete(task.id);
        handle.busy = false;
        handle.taskId = undefined;
        this.resolveTaskInline(task, error);
      }
    }
  }

  private handleWorkerMessage(handle: WorkerHandle, message: unknown): void {
    const response = this.parseWorkerResponse(message);
    const taskId = response?.id ?? handle.taskId;
    if (taskId === undefined) {
      handle.busy = false;
      handle.taskId = undefined;
      this.dispatch();
      return;
    }

    const task = this.inFlight.get(taskId);
    this.inFlight.delete(taskId);
    handle.busy = false;
    handle.taskId = undefined;

    if (!task) {
      this.dispatch();
      return;
    }

    if (response?.ok === true) {
      task.resolve(response.extracted);
      this.dispatch();
      return;
    }

    this.resolveTaskInline(task, response?.error);
    this.dispatch();
  }

  private handleWorkerFailure(handle: WorkerHandle, error: unknown): void {
    const taskId = handle.taskId;
    handle.busy = false;
    handle.taskId = undefined;

    if (taskId !== undefined) {
      const task = this.inFlight.get(taskId);
      if (task) {
        this.inFlight.delete(taskId);
        this.resolveTaskInline(task, error);
      }
    }

    const index = this.workers.indexOf(handle);
    if (index >= 0) {
      this.workers.splice(index, 1);
    }

    if (this.workers.length === 0) {
      this.inlineOnly = true;
      while (this.queue.length > 0) {
        const queuedTask = this.queue.shift();
        if (!queuedTask) continue;
        this.resolveTaskInline(queuedTask, error);
      }
      return;
    }

    this.dispatch();
  }

  private parseWorkerResponse(message: unknown): WorkerExtractResponse | null {
    if (!message || typeof message !== "object") return null;
    const candidate = message as Record<string, unknown>;
    if (typeof candidate.id !== "number") return null;
    if (candidate.ok === true) {
      const extracted = candidate.extracted;
      if (!extracted || typeof extracted !== "object") return null;
      const typedExtracted = extracted as Record<string, unknown>;
      if (typeof typedExtracted.text !== "string") return null;
      if (!Array.isArray(typedExtracted.links)) return null;
      if (!typedExtracted.selectors || typeof typedExtracted.selectors !== "object") return null;
      const selectors: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(typedExtracted.selectors as Record<string, unknown>)) {
        selectors[key] = Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string")
          : [];
      }
      return {
        id: candidate.id,
        ok: true,
        extracted: {
          text: typedExtracted.text,
          links: typedExtracted.links
            .filter((value): value is string => typeof value === "string"),
          selectors
        }
      };
    }

    return {
      id: candidate.id,
      ok: false,
      error: typeof candidate.error === "string" ? candidate.error : "worker_parse_failed"
    };
  }

  private resolveTaskInline(task: CrawlTask, cause: unknown): void {
    try {
      task.resolve(extractStructuredContent(task.input.html, task.input.url, task.input.selectors));
    } catch (error) {
      task.reject(toError(error, toError(cause, "crawl_worker_inline_failed").message));
    }
  }
}

export const extractCrawlContentInline = (input: CrawlExtractInput): ExtractedContent => {
  return extractStructuredContent(input.html, input.url, input.selectors);
};

export const createCrawlWorkerPool = (
  options: CrawlWorkerPoolOptions = {}
): CrawlWorkerPool => {
  return new CrawlWorkerPool(options);
};

export const __test__ = {
  supportsWorkerThreads,
  toError
};
