import { createHash } from "crypto";

export function hashCodeSyncValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashCodeSyncJson(value: unknown): string {
  return hashCodeSyncValue(JSON.stringify(value));
}
