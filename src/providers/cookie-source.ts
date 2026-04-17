import * as os from "os";
import * as path from "path";
import { readFile } from "fs/promises";
import type { ProviderCookieImportRecord, ProviderCookieSourceConfig } from "./types";

const expandHomePath = (filePath: string): string => {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
};

export const cookieSourceRef = (source: ProviderCookieSourceConfig): string => {
  if (source.type === "file") {
    return expandHomePath(source.value);
  }
  if (source.type === "env") {
    return source.value;
  }
  return "inline";
};

const parseCookieArray = (payload: string): ProviderCookieImportRecord[] => {
  const parsed = JSON.parse(payload);
  if (!Array.isArray(parsed)) {
    throw new Error("Cookie payload must be a JSON array.");
  }
  return parsed as ProviderCookieImportRecord[];
};

export const readCookiesFromSource = async (
  source: ProviderCookieSourceConfig
): Promise<{ cookies: ProviderCookieImportRecord[]; available: boolean; message?: string }> => {
  if (source.type === "inline") {
    return {
      cookies: source.value,
      available: source.value.length > 0,
      ...(source.value.length === 0 ? { message: "Inline cookie source is empty." } : {})
    };
  }
  if (source.type === "env") {
    const envValue = process.env[source.value];
    if (!envValue || envValue.trim().length === 0) {
      return { cookies: [], available: false, message: `Cookie env ${source.value} is not set.` };
    }
    try {
      const cookies = parseCookieArray(envValue);
      return {
        cookies,
        available: cookies.length > 0,
        ...(cookies.length === 0 ? { message: `Cookie env ${source.value} is empty.` } : {})
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { cookies: [], available: false, message: `Cookie env ${source.value} is invalid JSON: ${message}` };
    }
  }
  const resolvedPath = expandHomePath(source.value);
  try {
    const payload = await readFile(resolvedPath, "utf8");
    const cookies = parseCookieArray(payload);
    return {
      cookies,
      available: cookies.length > 0,
      ...(cookies.length === 0 ? { message: `Cookie file is empty: ${resolvedPath}` } : {})
    };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return { cookies: [], available: false, message: `Cookie file not found: ${resolvedPath}` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { cookies: [], available: false, message: `Cookie file read failed: ${message}` };
  }
};
