import type { OpenDevBrowserConfig } from "../config";
import type { SessionProfileRecord, SessionProfileSummary } from "./session-profile-registry";

export type ExplicitCdpProfileStartOptions = {
  profile: string;
  port?: number;
  startUrl?: string;
  chromePath?: string;
  flags?: string[];
  readinessTimeoutMs?: number;
};

export type ExplicitCdpProfileResult = {
  profile: SessionProfileSummary;
  pid?: number;
  port?: number;
  warnings: string[];
};

export type ResolvedExplicitCdpProfile = {
  readonly record: SessionProfileRecord;
  readonly wsEndpoint: string;
};

export type ExplicitCdpProfileLogger = {
  warn(event: string, payload: { readonly data: { readonly errorCode: string } }): void;
};

export type ExplicitCdpProfileManagerInput = {
  readonly worktree: string;
  readonly getConfig: () => OpenDevBrowserConfig;
  readonly logger: ExplicitCdpProfileLogger;
};
