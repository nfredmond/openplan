/**
 * The browser half of a staged upload (`lib/files/staged-upload.ts`).
 *
 * Asks `startUrl` for a signed Storage URL, PUTs the file there, then asks
 * `completeUrl` to read it back and store it. The file never rides in an app
 * request body, which the hosted platform refuses above about 4.5 MB.
 *
 * Answers with a `Response` so a caller that used to POST the file as a body
 * keeps its own handling: a refusal from `start` or `complete` comes back as
 * that route's own response, and a Storage failure in between comes back as a
 * JSON `{ error }` the caller can show as it shows any other refusal.
 */

type StartAnswer = { uploadUrl?: string; objectPath?: string; contentType?: string };

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function sendFileThroughStorage(input: {
  startUrl: string;
  completeUrl: string;
  /** Sent to both routes alongside the file's name, size and declared type. */
  fields: Record<string, unknown>;
  file: File;
  /** The type the body route would have read from the request header. */
  contentType?: string;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const send = input.fetchImpl ?? fetch;
  const described = {
    ...input.fields,
    filename: input.file.name,
    byteSize: input.file.size,
    ...(input.contentType ? { contentType: input.contentType } : {}),
  };

  const start = await send(input.startUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(described),
  });
  if (!start.ok) return start;
  const started = (await start.json().catch(() => ({}))) as StartAnswer;
  if (!started.uploadUrl || !started.objectPath) {
    return jsonResponse({ error: "OpenPlan did not return an upload address. Nothing was stored. Try again." }, 502);
  }

  const put = await send(started.uploadUrl, {
    method: "PUT",
    headers: { "content-type": started.contentType ?? "application/octet-stream", "x-upsert": "false" },
    body: input.file,
  });
  if (!put.ok) {
    return jsonResponse(
      { error: `The file could not be stored (Storage answered ${put.status}). Nothing was saved. Try again.` },
      502
    );
  }

  return send(input.completeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...described, objectPath: started.objectPath }),
  });
}
