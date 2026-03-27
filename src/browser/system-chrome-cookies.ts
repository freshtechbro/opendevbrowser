import { execFileSync } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { cp, mkdtemp, mkdir, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { discoverSystemChromeProfileSource, type ChromeUserDataSource } from "../cache/chrome-user-data";
import { loadChromium } from "./playwright-runtime";

export type BootstrapCookieRecord = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type SystemChromeCookieBootstrapResult = {
  cookies: BootstrapCookieRecord[];
  source: ChromeUserDataSource | null;
  warnings: string[];
};

const ROOT_COPY_ENTRIES = ["Local State"] as const;
const PROFILE_COPY_ENTRIES = [
  "Preferences",
  "Secure Preferences",
  "Network",
  "Cookies",
  "Cookies-journal"
] as const;
const COOKIE_STORE_ENTRIES = ["Network", "Cookies", "Cookies-journal"] as const;
const COOKIE_STORE_ENTRY_SET = new Set<string>(COOKIE_STORE_ENTRIES);
const SQLITE_SEPARATOR = "\u001f";
const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const DARWIN_SAFE_STORAGE_SERVICE = "Chrome Safe Storage";
const DARWIN_KEY_ITERATIONS = 1003;
const DARWIN_KEY_LENGTH = 16;
const DARWIN_KEY_SALT = "saltysalt";
const DARWIN_IV = Buffer.alloc(16, 0x20);
const SQLITE_MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const SQLITE_COOKIE_QUERY = [
  "SELECT",
  "  hex(host_key),",
  "  hex(name),",
  "  hex(value),",
  "  hex(encrypted_value),",
  "  hex(path),",
  "  expires_utc,",
  "  is_httponly,",
  "  is_secure,",
  "  samesite",
  "FROM cookies"
].join(" ");

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyEntry(sourcePath: string, destinationPath: string): Promise<boolean> {
  if (!(await pathExists(sourcePath))) {
    return false;
  }
  const sourceStat = await stat(sourcePath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, {
    recursive: sourceStat.isDirectory(),
    force: false,
    errorOnExist: false
  });
  return true;
}

async function stageSystemChromeProfile(
  source: ChromeUserDataSource,
  stagingRoot: string
): Promise<{ copiedCookieStore: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  let copiedCookieStore = false;

  for (const entry of ROOT_COPY_ENTRIES) {
    try {
      await copyEntry(join(source.userDataDir, entry), join(stagingRoot, entry));
    } catch (error) {
      warnings.push(`Chrome bootstrap skipped ${entry}: ${getErrorMessage(error)}`);
    }
  }

  for (const entry of PROFILE_COPY_ENTRIES) {
    try {
      const copied = await copyEntry(
        join(source.profilePath, entry),
        join(stagingRoot, source.profileDirectory, entry)
      );
      if (copied && COOKIE_STORE_ENTRY_SET.has(entry)) {
        copiedCookieStore = true;
      }
    } catch (error) {
      warnings.push(`Chrome bootstrap skipped ${source.profileDirectory}/${entry}: ${getErrorMessage(error)}`);
    }
  }

  return { copiedCookieStore, warnings };
}

type SqliteCookieRow = {
  hostKey: string;
  name: string;
  value: string;
  encryptedHex: string;
  path: string;
  expiresUtc: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: number;
};

function decodeSqliteHex(value: string): string {
  if (!value) {
    return "";
  }
  return Buffer.from(value, "hex").toString("utf8");
}

function parseSqliteCookieRows(raw: string): SqliteCookieRow[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const fields = line.split(SQLITE_SEPARATOR);
      if (fields.length !== 9) {
        throw new Error(`Unexpected sqlite cookie row shape (${fields.length} fields).`);
      }
      const [
        hostKeyHex = "",
        nameHex = "",
        valueHex = "",
        encryptedHex = "",
        pathHex = "",
        expiresUtc = "0",
        httpOnly = "0",
        secure = "0",
        sameSite = "-1"
      ] = fields;
      return {
        hostKey: decodeSqliteHex(hostKeyHex),
        name: decodeSqliteHex(nameHex),
        value: decodeSqliteHex(valueHex),
        encryptedHex,
        path: decodeSqliteHex(pathHex),
        expiresUtc: Number(expiresUtc),
        httpOnly: httpOnly === "1",
        secure: secure === "1",
        sameSite: Number(sameSite)
      };
    });
}

function deriveDarwinCookieKey(password: string): Buffer {
  return pbkdf2Sync(password, DARWIN_KEY_SALT, DARWIN_KEY_ITERATIONS, DARWIN_KEY_LENGTH, "sha1");
}

function decryptDarwinCookieValue(encryptedHex: string, key: Buffer, hostKey: string): string {
  if (!encryptedHex) {
    return "";
  }

  let payload = Buffer.from(encryptedHex, "hex");
  if (payload.subarray(0, 3).equals(Buffer.from("v10")) || payload.subarray(0, 3).equals(Buffer.from("v11"))) {
    payload = payload.subarray(3);
  }

  const decipher = createDecipheriv("aes-128-cbc", key, DARWIN_IV);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  if (decrypted.length > 32) {
    const hostDigest = createHash("sha256").update(hostKey).digest();
    if (decrypted.subarray(0, 32).equals(hostDigest)) {
      return decrypted.subarray(32).toString("utf8");
    }
  }
  return decrypted.toString("utf8");
}

function mapChromiumSameSite(value: number): BootstrapCookieRecord["sameSite"] | undefined {
  if (value === 0) {
    return "None";
  }
  if (value === 1) {
    return "Lax";
  }
  if (value === 2) {
    return "Strict";
  }
  return undefined;
}

function chromiumExpiresToUnixSeconds(expiresUtc: number): number {
  if (!Number.isFinite(expiresUtc) || expiresUtc <= 0) {
    return -1;
  }
  return Math.max(-1, Math.floor(expiresUtc / 1_000_000 - CHROME_EPOCH_OFFSET_SECONDS));
}

function querySqliteCookieRows(cookieDbPath: string): SqliteCookieRow[] {
  const raw = execFileSync(
    "sqlite3",
    ["-readonly", "-separator", SQLITE_SEPARATOR, cookieDbPath, SQLITE_COOKIE_QUERY],
    { encoding: "utf8", maxBuffer: SQLITE_MAX_BUFFER_BYTES }
  );
  return parseSqliteCookieRows(raw);
}

function readDarwinSafeStoragePassword(): string {
  return execFileSync(
    "security",
    ["find-generic-password", "-w", "-s", DARWIN_SAFE_STORAGE_SERVICE],
    { encoding: "utf8" }
  ).trim();
}

async function loadSystemChromeCookiesFromSqlite(
  source: ChromeUserDataSource,
  platform = process.platform
): Promise<{ cookies: BootstrapCookieRecord[]; warnings: string[]; attempted: boolean }> {
  if (platform !== "darwin") {
    return { cookies: [], warnings: [], attempted: false };
  }

  const cookieDbCandidates = [
    join(source.profilePath, "Cookies"),
    join(source.profilePath, "Network", "Cookies")
  ];
  const cookieDbPath = await firstExistingPath(cookieDbCandidates);
  if (!cookieDbPath) {
    return {
      cookies: [],
      warnings: [`System Chrome profile ${source.browserName}/${source.profileDirectory} did not expose a readable cookie database.`],
      attempted: true
    };
  }

  try {
    const key = deriveDarwinCookieKey(readDarwinSafeStoragePassword());
    const rows = querySqliteCookieRows(cookieDbPath);
    const cookies: BootstrapCookieRecord[] = [];
    let skipped = 0;

    for (const row of rows) {
      try {
        const value = row.value || decryptDarwinCookieValue(row.encryptedHex, key, row.hostKey);
        cookies.push({
          name: row.name,
          value,
          domain: row.hostKey,
          path: row.path || "/",
          expires: chromiumExpiresToUnixSeconds(row.expiresUtc),
          httpOnly: row.httpOnly,
          secure: row.secure,
          ...(mapChromiumSameSite(row.sameSite) ? { sameSite: mapChromiumSameSite(row.sameSite) } : {})
        });
      } catch {
        skipped += 1;
      }
    }

    return {
      cookies,
      warnings: skipped > 0
        ? [`System Chrome cookie bootstrap skipped ${skipped} unreadable cookies from ${source.profileDirectory}.`]
        : [],
      attempted: true
    };
  } catch (error) {
    return {
      cookies: [],
      warnings: [`System Chrome cookie bootstrap direct read failed: ${getErrorMessage(error)}`],
      attempted: true
    };
  }
}

async function firstExistingPath(paths: readonly string[]): Promise<string | null> {
  for (const candidate of paths) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function loadSystemChromeCookies(
  executablePath?: string | null
): Promise<SystemChromeCookieBootstrapResult> {
  const source = discoverSystemChromeProfileSource();
  if (!source) {
    return {
      cookies: [],
      source: null,
      warnings: ["System Chrome profile not found; managed and CDP cookie bootstrap skipped."]
    };
  }

  const direct = await loadSystemChromeCookiesFromSqlite(source);
  if (direct.cookies.length > 0) {
    return {
      cookies: direct.cookies,
      source,
      warnings: direct.warnings
    };
  }

  const stagingRoot = await mkdtemp(join(tmpdir(), "opendevbrowser-chrome-cookie-bootstrap-"));
  try {
    const staged = await stageSystemChromeProfile(source, stagingRoot);
    if (!staged.copiedCookieStore) {
      return {
        cookies: [],
        source,
        warnings: [
          ...direct.warnings,
          ...staged.warnings,
          `System Chrome profile ${source.browserName}/${source.profileDirectory} did not expose a readable cookie store.`
        ]
      };
    }

    const chromium = await loadChromium();
    const context = await chromium.launchPersistentContext(stagingRoot, {
      headless: true,
      executablePath: executablePath ?? undefined,
      args: [`--profile-directory=${source.profileDirectory}`],
      viewport: null
    });

    try {
      const cookies = await context.cookies();
      return {
        cookies: cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expires,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
            ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {})
        })),
        source,
        warnings: staged.warnings
      };
    } finally {
      await context.close();
    }
  } catch (error) {
    return {
      cookies: [],
      source,
      warnings: [...direct.warnings, `System Chrome cookie bootstrap failed: ${getErrorMessage(error)}`]
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export const __test__ = {
  chromiumExpiresToUnixSeconds,
  decryptDarwinCookieValue,
  loadSystemChromeCookiesFromSqlite,
  mapChromiumSameSite,
  parseSqliteCookieRows
};
