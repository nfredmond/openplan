import { createHash } from "node:crypto";
import { open, lstat, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

export class ConnectorError extends Error {
  constructor(code, status = null) { super(code); this.code = code; this.status = status; }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) {
    throw new ConnectorError("connector_config_invalid");
  }
}

// Pairing fixes the destination and project audience. There is no caller-supplied
// model endpoint, browser cookie, environment-key field or arbitrary tool config.
export function checkedConnectorSetup(raw) {
  exactKeys(raw, ["version", "appUrl", "connectionId", "workspaceId", "projectId", "expectedAuthMode", "token", ...(raw?.version === 2 ? ["provider"] : [])]);
  const validProvider = raw.version === 1 ? ["chatgpt", "apiKey"].includes(raw.expectedAuthMode)
    : raw.version === 2 && (raw.provider === "codex" && ["chatgpt", "apiKey"].includes(raw.expectedAuthMode) || raw.provider === "claude" && raw.expectedAuthMode === "claude_subscription");
  if (!validProvider || ![raw.connectionId, raw.workspaceId, raw.projectId].every(value => typeof value === "string" && uuid.test(value)) ||
    typeof raw.token !== "string" || !new RegExp(`^op_pc_${raw.connectionId}\\.[A-Za-z0-9_-]{43}$`).test(raw.token)) {
    throw new ConnectorError("connector_config_invalid");
  }
  let url;
  try { url = new URL(raw.appUrl); } catch { throw new ConnectorError("connector_origin_invalid"); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new ConnectorError("connector_origin_invalid");
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname))) throw new ConnectorError("connector_origin_invalid");
  return { ...raw, appUrl: url.origin };
}

export async function readPrivateJson(path, maxBytes = 300_000) {
  if (!isAbsolute(path)) throw new ConnectorError("connector_path_invalid");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) throw new ConnectorError("connector_file_not_private");
  const file = await open(path, "r");
  try {
    const current = await file.stat();
    if (current.ino !== info.ino || current.dev !== info.dev || current.size > maxBytes) throw new ConnectorError("connector_file_changed_or_large");
    return JSON.parse(await file.readFile("utf8"));
  } finally { await file.close(); }
}
export async function readConnectorConfig(path) {
  const raw = await readPrivateJson(path);
  exactKeys(raw, ["setup", "binaryPath", "providerHome"]);
  if (![raw.binaryPath, raw.providerHome].every(value => typeof value === "string" && isAbsolute(value))) throw new ConnectorError("connector_path_invalid");
  return { setup: checkedConnectorSetup(raw.setup), binaryPath: await realpath(raw.binaryPath), providerHome: await realpath(raw.providerHome) };
}

// Bound responses independently of Content-Length and refuse every redirect.
// A connection token never travels to a redirect destination or a cookie jar.
export async function connectorRequest(setup, body, { signal, fetchImpl = fetch } = {}) {
  const checked = checkedConnectorSetup(setup);
  const response = await fetchImpl(`${checked.appUrl}/api/assistant/providers/native`, {
    method: "POST", redirect: "manual", credentials: "omit", cache: "no-store",
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]),
    headers: { "content-type": "application/json", authorization: `Bearer ${checked.token}` }, body: JSON.stringify(body),
  });
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new ConnectorError("connector_redirect_refused", response.status); }
  if (!response.ok) { await response.body?.cancel(); throw new ConnectorError("connector_request_refused", response.status); }
  if (!response.body) throw new ConnectorError("connector_response_missing");
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 300_000) throw new ConnectorError("connector_response_too_large");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel(); reader.releaseLock(); }
}

// Check the retained packet before it crosses into the native runtime. The app
// verifies it again on delivery; the connector cannot change project audience.
export function checkedConnectorJob(raw, setup) {
  const checked = checkedConnectorSetup(setup);
  if (!raw || typeof raw !== "object" || !uuid.test(raw.id ?? "") || !uuid.test(raw.attemptId ?? "") ||
    raw.workspaceId !== checked.workspaceId || raw.projectId !== checked.projectId || raw.authMode !== checked.expectedAuthMode ||
    (raw.provider ?? (checked.version === 1 ? "codex" : null)) !== (checked.provider ?? "codex") ||
    typeof raw.model !== "string" || !raw.model.trim() || raw.model.length > 160 ||
    typeof raw.packetCanonical !== "string" || Buffer.byteLength(raw.packetCanonical) > 200_000 ||
    createHash("sha256").update(raw.packetCanonical).digest("hex") !== raw.packetHash ||
    typeof raw.question !== "string" || !raw.question.trim() || raw.question.length > 2000 ||
    typeof raw.prompt !== "string" || Buffer.byteLength(raw.prompt) > 100_000 ||
    typeof raw.instructions !== "string" || !raw.instructions || Buffer.byteLength(raw.instructions) > 20_000 ||
    !raw.outputSchema || typeof raw.outputSchema !== "object" || Array.isArray(raw.outputSchema) ||
    typeof raw.leaseExpiresAt !== "string" || !Number.isFinite(Date.parse(raw.leaseExpiresAt))) throw new ConnectorError("connector_job_invalid");
  const packet = JSON.parse(raw.packetCanonical);
  if (packet.version !== 1 || packet.workspaceId !== checked.workspaceId || packet.project?.id !== checked.projectId ||
    packet.source?.id !== `project:${checked.projectId}` || packet.source?.href !== `/projects/${checked.projectId}` || packet.source?.label !== packet.project?.name ||
    raw.prompt !== JSON.stringify({ question: raw.question, selectedProjectRecord: packet })) throw new ConnectorError("connector_packet_mismatch");
  return raw;
}
