const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const TOKEN_LIKE_PATTERN = /\b[A-Za-z0-9_-]{16,}\b/g;
const API_KEY_PREFIX_PATTERN = /\b(sk_|pk_|api_|key_|token_|secret_|bearer_)[A-Za-z0-9_-]+\b/gi;
const SENSITIVE_KV_PATTERN = /\b(token|key|secret|password|auth|bearer|credential)[=:]\s*\S+/gi;

const shouldRedactToken = (token: string): boolean => {
  if (/^(sk_|pk_|api_|key_|token_|secret_|bearer_)/i.test(token)) {
    return true;
  }
  const categories = [
    /[a-z]/.test(token),
    /[A-Z]/.test(token),
    /\d/.test(token),
    /[_-]/.test(token)
  ].filter(Boolean).length;
  return categories >= 2;
};

export const redactConsoleText = (text: string): string => {
  let result = text.replace(SENSITIVE_KV_PATTERN, (match) => {
    const sepIndex = match.search(/[=:]/);
    return match.slice(0, sepIndex + 1) + "[REDACTED]";
  });
  result = result.replace(JWT_PATTERN, "[REDACTED]");
  result = result.replace(API_KEY_PREFIX_PATTERN, "[REDACTED]");
  result = result.replace(TOKEN_LIKE_PATTERN, (match) => (
    shouldRedactToken(match) ? "[REDACTED]" : match
  ));
  return result;
};

const shouldRedactPathSegment = (segment: string): boolean => {
  if (segment.length < 16) return false;
  if (/^\d+$/.test(segment)) return false;
  if (/^[a-f0-9-]{36}$/i.test(segment)) return false;
  if (/^(sk_|pk_|api_|key_|token_|secret_|bearer_)/i.test(segment)) return true;
  const categories = [/[a-z]/, /[A-Z]/, /\d/, /[_-]/].filter(r => r.test(segment)).length;
  return categories >= 3 && segment.length >= 20;
};

export const redactUrl = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    parsed.hash = "";
    const segments = parsed.pathname.split("/");
    const redactedSegments = segments.map(segment =>
      shouldRedactPathSegment(segment) ? "[REDACTED]" : segment
    );
    parsed.pathname = redactedSegments.join("/");
    return parsed.toString();
  } catch {
    return rawUrl.split(/[?#]/)[0] || rawUrl;
  }
};
