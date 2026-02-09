import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import type { AnnotationPayload, AnnotationItem, AnnotationScreenshot } from "../relay/protocol";

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

const sanitizeScreenshotLabel = (label: string): string => {
  const safe = label.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 40);
  return safe || "annotation";
};

const writeAnnotationScreenshots = async (
  screenshots: AnnotationScreenshot[]
): Promise<Array<{ id: string; path: string }>> => {
  const results: Array<{ id: string; path: string }> = [];
  for (const screenshot of screenshots) {
    if (!screenshot.base64) continue;
    const buffer = Buffer.from(screenshot.base64, "base64");
    if (buffer.length > MAX_SCREENSHOT_BYTES) {
      continue;
    }
    const safeLabel = sanitizeScreenshotLabel(screenshot.label);
    const fileName = `opendevbrowser-annotate-${safeLabel}-${randomUUID().slice(0, 8)}.png`;
    const filePath = path.join(os.tmpdir(), fileName);
    await fs.writeFile(filePath, buffer);
    results.push({ id: screenshot.id, path: filePath });
  }
  return results;
};

const roundNumber = (value: number): string => {
  return Math.round(value).toString();
};

const formatRect = (rect: AnnotationPayload["annotations"][number]["rect"]): string => {
  return `x=${roundNumber(rect.x)}, y=${roundNumber(rect.y)}, w=${roundNumber(rect.width)}, h=${roundNumber(rect.height)}`;
};

const truncateText = (value: string, max: number): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
};

const isSensitiveKey = (key: string): boolean => {
  const lowered = key.toLowerCase();
  return ["password", "passwd", "token", "secret", "api-key", "apikey", "auth", "session", "csrf", "value"].some((term) => lowered.includes(term));
};

const looksSensitive = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length < 12) return false;
  if (/[A-Z0-9]{20,}/.test(trimmed)) return true;
  if (/(token|secret|apikey|password)/i.test(trimmed)) return true;
  if (/^[A-Za-z0-9+/_-]{24,}={0,2}$/.test(trimmed)) return true;
  return false;
};

const redactAnnotationItem = (item: AnnotationItem): AnnotationItem => {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(item.attributes)) {
    if (isSensitiveKey(key)) {
      continue;
    }
    if (looksSensitive(value)) {
      continue;
    }
    attributes[key] = value;
  }
  const note = item.note && looksSensitive(item.note) ? "[redacted]" : item.note;
  const text = item.text && looksSensitive(item.text) ? "[redacted]" : item.text;
  return {
    ...item,
    attributes,
    note,
    text
  };
};

const redactAnnotationPayload = (payload: AnnotationPayload): AnnotationPayload => {
  const redacted: AnnotationPayload = {
    ...payload,
    annotations: payload.annotations.map((item) => redactAnnotationItem(item))
  };
  return redacted;
};

const formatAnnotationMarkdown = (
  payload: AnnotationPayload,
  screenshotPaths: Array<{ id: string; path: string }>
): string => {
  const screenshotIndex = new Map(screenshotPaths.map((entry) => [entry.id, entry.path]));

  const lines: string[] = [];
  lines.push("# Annotation Summary");
  lines.push("");
  lines.push(`- URL: ${payload.url}`);
  if (payload.title) {
    lines.push(`- Title: ${payload.title}`);
  }
  lines.push(`- Timestamp: ${payload.timestamp}`);
  lines.push(`- Screenshot mode: ${payload.screenshotMode}`);
  if (payload.context) {
    lines.push(`- Context: ${payload.context}`);
  }
  lines.push("");

  payload.annotations.forEach((annotation, index) => {
    lines.push(`## ${index + 1}. ${annotation.tag}${annotation.idAttr ? `#${annotation.idAttr}` : ""}`);
    if (annotation.note) {
      lines.push(`> ${annotation.note}`);
    }
    lines.push(`- Selector: \`${annotation.selector}\``);
    lines.push(`- Rect: ${formatRect(annotation.rect)}`);
    if (annotation.a11y.role || annotation.a11y.label) {
      lines.push(`- A11y: role=${annotation.a11y.role ?? "n/a"}, label=${annotation.a11y.label ?? "n/a"}`);
    }
    if (annotation.text) {
      lines.push(`- Text: ${truncateText(annotation.text, 160)}`);
    }
    const shot = annotation.screenshotId ? screenshotIndex.get(annotation.screenshotId) : null;
    if (shot) {
      lines.push(`- Screenshot: ${shot}`);
    }
    lines.push("");
  });

  return lines.join("\n");
};

export const buildAnnotateResult = async (
  payload: AnnotationPayload
): Promise<{ message: string; details: AnnotationPayload; screenshots: Array<{ id: string; path: string }> }> => {
  const redacted = redactAnnotationPayload(payload);
  const screenshots = await writeAnnotationScreenshots(redacted.screenshots ?? []);
  const message = formatAnnotationMarkdown(redacted, screenshots);
  return {
    message,
    details: redacted,
    screenshots
  };
};
