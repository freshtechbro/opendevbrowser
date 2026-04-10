import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { writeFileAtomic } from "../utils/fs";
import type { DesktopCapability, DesktopFailureCode } from "./types";

export type DesktopAuditValue =
  | string
  | number
  | boolean
  | null
  | DesktopAuditValue[]
  | { [key: string]: DesktopAuditValue };

export type DesktopAuditOperation =
  | "windows.list"
  | "window.active"
  | "capture.desktop"
  | "capture.window"
  | "accessibility.snapshot";

export type DesktopAuditRecord = {
  auditId: string;
  at: string;
  operation: DesktopAuditOperation;
  capability: DesktopCapability;
  result: "ok" | "failed";
  failureCode?: DesktopFailureCode;
  message?: string;
  artifactPaths: string[];
  details?: Record<string, DesktopAuditValue>;
};

export type DesktopAuditEnvelope = {
  auditId: string;
  at: string;
  recordPath: string;
  artifactPaths: string[];
};

type WriteDesktopAuditRecordArgs = {
  auditDir: string;
  operation: DesktopAuditOperation;
  capability: DesktopCapability;
  result: "ok" | "failed";
  failureCode?: DesktopFailureCode;
  message?: string;
  artifactPaths?: string[];
  details?: Record<string, DesktopAuditValue>;
  now?: () => Date;
  uuid?: () => string;
};

const sanitizeTimestamp = (at: string): string => at.replace(/[:.]/g, "-");

export async function writeDesktopAuditRecord(
  args: WriteDesktopAuditRecordArgs
): Promise<DesktopAuditEnvelope> {
  const at = (args.now ?? (() => new Date()))().toISOString();
  const auditId = (args.uuid ?? randomUUID)();
  const artifactPaths = args.artifactPaths ?? [];
  const recordPath = path.join(args.auditDir, `${sanitizeTimestamp(at)}-${auditId}.json`);
  const record: DesktopAuditRecord = {
    auditId,
    at,
    operation: args.operation,
    capability: args.capability,
    result: args.result,
    ...(args.failureCode ? { failureCode: args.failureCode } : {}),
    ...(args.message ? { message: args.message } : {}),
    artifactPaths,
    ...(args.details ? { details: args.details } : {})
  };

  await mkdir(args.auditDir, { recursive: true });
  writeFileAtomic(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  return {
    auditId,
    at,
    recordPath,
    artifactPaths
  };
}
