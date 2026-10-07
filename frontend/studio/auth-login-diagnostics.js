/** Sanitized login-failure clipboard payload. No secrets. */

const SECRET_KEY =
  /^(password|passwd|pwd|token|access_token|refresh_token|id_token|jwt|secret|authorization|cookie|cookies|set-cookie|session|api[_-]?key)$/i;

const SECRET_IN_TEXT =
  /password|passwd|authorization\s*:|bearer\s+[a-z0-9._-]+|cookie\s*:|set-cookie/i;

export function omitSecrets(value, depth = 0) {
  if (depth > 6) return "[truncated]";
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => omitSecrets(item, depth + 1));
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = omitSecrets(item, depth + 1);
  }
  return out;
}

function shortUserAgent(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  return text.slice(0, 160);
}

function pickRequestId(data) {
  if (!data || typeof data !== "object") return "";
  return String(
    data.request_id ||
      data.requestId ||
      data.trace_id ||
      data.traceId ||
      data.x_request_id ||
      data["x-request-id"] ||
      "",
  ).trim();
}

export function buildLoginDiagnosticText(input = {}, debugLines = []) {
  const safe = omitSecrets(input && typeof input === "object" ? input : {});
  const status = safe.status ?? safe.http_status ?? "";
  const reached =
    safe.reached_server === false || status === 0 || status === "0" ? "no" : "yes";
  const requestId = pickRequestId(safe);
  const lines = [
    "Render Studio login diagnostic",
    `timestamp: ${safe.timestamp || ""}`,
    `url: ${safe.url || ""}`,
    `http_status: ${status}`,
    `reached_server: ${reached}`,
  ];
  if (safe.detail) lines.push(`detail: ${safe.detail}`);
  if (safe.error) lines.push(`error: ${safe.error}`);
  if (requestId) lines.push(`request_id: ${requestId}`);
  if (safe.trace_id && String(safe.trace_id) !== requestId) {
    lines.push(`trace_id: ${safe.trace_id}`);
  }
  const headerId = safe.x_request_id || safe["x-request-id"] || "";
  if (headerId) lines.push(`x-request-id: ${headerId}`);
  if (safe.x_trace_id && String(safe.x_trace_id) !== String(headerId)) {
    lines.push(`x-trace-id: ${safe.x_trace_id}`);
  }
  const ua = shortUserAgent(safe.userAgent);
  if (ua) lines.push(`userAgent: ${ua}`);

  const logs = Array.isArray(debugLines) ? debugLines.slice(-50) : [];
  if (logs.length) {
    lines.push("client_debug:");
    for (const row of logs) {
      const text = String(row ?? "");
      if (SECRET_IN_TEXT.test(text) || SECRET_KEY.test(text.split(/[:=]/, 1)[0] || "")) {
        lines.push("  [redacted debug line]");
        continue;
      }
      lines.push(`  ${text}`);
    }
  }
  return lines.join("\n");
}
