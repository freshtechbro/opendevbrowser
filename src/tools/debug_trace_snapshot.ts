import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { createRequestId } from "../core/logging";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

type DebugTraceSnapshotOptions = {
  sinceConsoleSeq?: number;
  sinceNetworkSeq?: number;
  sinceExceptionSeq?: number;
  max?: number;
  requestId?: string;
};

type DebugTraceSnapshotCapableManager = {
  debugTraceSnapshot?: (
    sessionId: string,
    options?: DebugTraceSnapshotOptions
  ) => Promise<unknown>;
  exceptionPoll?: (
    sessionId: string,
    sinceSeq?: number,
    max?: number
  ) => Promise<{ events: unknown[]; nextSeq: number; truncated?: boolean }>;
};

export function createDebugTraceSnapshotTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Capture a combined debug trace snapshot (page + console + network + exceptions).",
    args: {
      sessionId: z.string().describe("Session id"),
      sinceConsoleSeq: z.number().int().optional().describe("Resume cursor for console events"),
      sinceNetworkSeq: z.number().int().optional().describe("Resume cursor for network events"),
      sinceExceptionSeq: z.number().int().optional().describe("Resume cursor for exception events"),
      max: z.number().int().optional().describe("Max events per channel"),
      requestId: z.string().optional().describe("Optional trace request id")
    },
    async execute(args) {
      try {
        const manager = deps.manager as ToolDeps["manager"] & DebugTraceSnapshotCapableManager;
        const options: DebugTraceSnapshotOptions = {
          sinceConsoleSeq: args.sinceConsoleSeq,
          sinceNetworkSeq: args.sinceNetworkSeq,
          sinceExceptionSeq: args.sinceExceptionSeq,
          max: args.max,
          requestId: args.requestId
        };

        if (typeof manager.debugTraceSnapshot === "function") {
          const result = await manager.debugTraceSnapshot(args.sessionId, options);
          return ok(result as Record<string, unknown>);
        }

        const max = args.max ?? 500;
        const requestId = args.requestId ?? createRequestId();
        const [page, consoleChannel, networkChannel] = await Promise.all([
          deps.manager.status(args.sessionId),
          deps.manager.consolePoll(args.sessionId, args.sinceConsoleSeq, max),
          deps.manager.networkPoll(args.sessionId, args.sinceNetworkSeq, max)
        ]);

        const exceptionChannel = typeof manager.exceptionPoll === "function"
          ? await manager.exceptionPoll(args.sessionId, args.sinceExceptionSeq, max)
          : {
            events: [],
            nextSeq: args.sinceExceptionSeq ?? 0,
            truncated: false
          };

        const annotateTraceContext = <T extends Record<string, unknown>>(events: T[]) => (
          events.map((event) => ({
            ...event,
            requestId,
            sessionId: args.sessionId
          }))
        );

        return ok({
          requestId,
          generatedAt: new Date().toISOString(),
          page,
          channels: {
            console: {
              nextSeq: consoleChannel.nextSeq,
              truncated: consoleChannel.truncated,
              events: annotateTraceContext(consoleChannel.events as Array<Record<string, unknown>>)
            },
            network: {
              nextSeq: networkChannel.nextSeq,
              truncated: networkChannel.truncated,
              events: annotateTraceContext(networkChannel.events as Array<Record<string, unknown>>)
            },
            exception: {
              nextSeq: exceptionChannel.nextSeq,
              truncated: exceptionChannel.truncated,
              events: annotateTraceContext(exceptionChannel.events as Array<Record<string, unknown>>)
            }
          }
        });
      } catch (error) {
        return failure(serializeError(error).message, "debug_trace_snapshot_failed");
      }
    }
  });
}
