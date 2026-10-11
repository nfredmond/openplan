// Talks to OpenPlan's map package endpoint and to the storage URLs it issues.
// The connection token goes only to the app origin; signed upload URLs carry
// their own one-object authority and never receive the token.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { checkedConnectorSetup, ConnectorError } from "./connector-client.mjs";

const RESPONSE_LIMIT = 4_000_000;

/** One bounded JSON call to /api/map-packages/connector. No redirects, no cookies. */
export async function mapConnectorRequest(setup, body, { signal, fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  const checked = checkedConnectorSetup(setup);
  const response = await fetchImpl(`${checked.appUrl}/api/map-packages/connector`, {
    method: "POST", redirect: "manual", credentials: "omit", cache: "no-store",
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]),
    headers: { "content-type": "application/json", authorization: `Bearer ${checked.token}` }, body: JSON.stringify(body),
  });
  const reader = response.body?.getReader();
  const chunks = [];
  let bytes = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_LIMIT) { await reader.cancel(); throw new ConnectorError("connector_response_too_large", response.status); }
      chunks.push(value);
    }
  }
  let parsed = null;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* A non-JSON reply is refused below. */ }
  if (response.status < 200 || response.status >= 300 || !parsed || typeof parsed !== "object") {
    const code = typeof parsed?.error === "string" && /^[a-z_]{1,120}$/.test(parsed.error) ? parsed.error : "connector_request_refused";
    throw new ConnectorError(code, response.status);
  }
  return parsed;
}

/** A signed upload URL from the app: https, or http on this computer for a local stack. */
export function checkedUploadUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new ConnectorError("map_upload_url_invalid"); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) throw new ConnectorError("map_upload_url_invalid");
  return url;
}

/**
 * Stream one file to its signed upload URL. An object that already exists is
 * fine: the server measures every stored object before the package is ready,
 * so a wrong earlier upload cannot pass.
 */
export async function putMapPackageFile(rawUrl, path, contentType, { signal, timeoutMs = 3_600_000 } = {}) {
  const url = checkedUploadUrl(rawUrl);
  const { size } = await stat(path);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return await new Promise((resolve, reject) => {
    const request = send(url, { method: "PUT", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]),
      headers: { "content-type": contentType, "content-length": String(size), "x-upsert": "false", "cache-control": "no-store" } }, response => {
      response.resume();
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve("uploaded");
        else if (response.statusCode === 409 || response.statusCode === 400) resolve("exists_or_refused");
        else reject(new ConnectorError("map_upload_failed", response.statusCode));
      });
    });
    request.on("error", () => reject(new ConnectorError("map_upload_failed")));
    createReadStream(path).on("error", () => { request.destroy(); reject(new ConnectorError("map_upload_read_failed")); }).pipe(request);
  });
}
