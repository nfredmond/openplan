import { NextResponse } from "next/server";

export const BODY_LIMITS = {
  adminTriageJson: 4 * 1024,
  smallJson: 16 * 1024,
  normalJson: 64 * 1024,
  documentJson: 256 * 1024,
  networkGeoJson: 2 * 1024 * 1024,
  // Public engagement photo upload: 5 MB image payload (matches the
  // engagement-photos bucket file_size_limit) plus small headroom.
  publicPhotoRaw: 5 * 1024 * 1024,
  // Offline comment import: the CSV arrives as a JSON string field capped at
  // 4,000,000 characters by the route's own schema. 5 MiB leaves room for the
  // JSON envelope and for multi-byte characters — a file of comments in Arabic
  // or Chinese is several bytes per character, and refusing it on size while
  // accepting the same number of English comments would be a limit that falls
  // hardest on the languages this product exists to serve.
  commentImportJson: 5 * 1024 * 1024,
  // Knowledge Base document upload: 25 MiB raw bytes (matches the kb-documents
  // bucket file_size_limit in 20260723000001_knowledge_base.sql).
  kbDocumentRaw: 25 * 1024 * 1024,
  // GTFS feed upload: 200 MiB raw ZIP.
  //
  // WHY 200 AND NOT A ROUNDER, SMALLER NUMBER. It was measured against real
  // agency feeds rather than guessed: CTA Chicago publishes a 94 MiB feed and
  // NJ Transit a 52 MiB one, so the largest limit already in this table — 25 MiB
  // for a Knowledge Base document — and even a 50 MiB one would refuse two of
  // the eleven largest US transit agencies outright. A planner in Chicago would
  // meet "file too large" on their own agency's official feed, with nothing they
  // could do about it, and would reasonably conclude the feature does not work.
  // 200 MiB leaves headroom above CTA for a large agency's feed to grow and for
  // the multi-agency merged feeds some state DOTs publish.
  //
  // A limit this size MUST be read with `readBytesWithLimitStreaming`. The
  // buffering reader below materializes the whole body before it compares the
  // size, which at 25 MiB is a rounding error and at 200 MiB is a lever anyone
  // with the upload URL can pull.
  //
  // THIS IS THE TRANSPORT CEILING, NOT THE GTFS RULE. `src/lib/gtfs/limits.ts`
  // owns the domain bound — `GTFS_MAX_ARCHIVE_BYTES`, 192 MiB by default and
  // settable per deployment with OPENPLAN_GTFS_MAX_ARCHIVE_BYTES. That one
  // refuses an over-large archive in GTFS's own words; this one only stops an
  // absurd HTTP body before anything reads it, and sits deliberately ABOVE the
  // domain default so the planner meets the message that explains itself.
  //
  // The consequence an operator must not be surprised by: raising
  // OPENPLAN_GTFS_MAX_ARCHIVE_BYTES past 200 MiB does NOT raise this, and the
  // upload will meet a bare 413 instead of the GTFS refusal. If that limit is
  // ever raised above 200 MiB, this constant has to move with it.
  gtfsFeedRaw: 200 * 1024 * 1024,
} as const;

export type ReadJsonWithLimitResult<T> =
  | {
      ok: true;
      data: T | null;
      byteLength: number;
      parseError: Error | null;
      text: string;
    }
  | {
      ok: false;
      response: NextResponse;
      byteLength: number;
    };

export type ReadTextWithLimitResult =
  | {
      ok: true;
      text: string;
      byteLength: number;
    }
  | {
      ok: false;
      response: NextResponse;
      byteLength: number;
    };

const encoder = new TextEncoder();

function bodyTooLargeResponse(maxBytes: number) {
  return NextResponse.json(
    {
      error: "Request body too large",
      maxBytes,
    },
    { status: 413 },
  );
}

export async function readTextWithLimit(
  request: Request,
  maxBytes: number,
): Promise<ReadTextWithLimitResult> {
  const text = await request.text();
  const byteLength = encoder.encode(text).byteLength;

  if (byteLength > maxBytes) {
    return {
      ok: false,
      byteLength,
      response: bodyTooLargeResponse(maxBytes),
    };
  }

  return { ok: true, text, byteLength };
}

export type ReadBytesWithLimitResult =
  | {
      ok: true;
      bytes: Uint8Array;
      byteLength: number;
    }
  | {
      ok: false;
      response: NextResponse;
      byteLength: number;
    };

export async function readBytesWithLimit(
  request: Request,
  maxBytes: number,
): Promise<ReadBytesWithLimitResult> {
  const buffer = await request.arrayBuffer();
  const byteLength = buffer.byteLength;

  if (byteLength > maxBytes) {
    return {
      ok: false,
      byteLength,
      response: bodyTooLargeResponse(maxBytes),
    };
  }

  return { ok: true, bytes: new Uint8Array(buffer), byteLength };
}

/**
 * The same contract as `readBytesWithLimit`, and the opposite memory profile.
 *
 * THE DIFFERENCE, WHICH IS THE ONLY REASON THIS EXISTS. `readBytesWithLimit`
 * calls `request.arrayBuffer()` and THEN compares the length, so the whole body
 * is in memory before the limit has any say. At the sizes that function is used
 * at — 5 MiB of photo, 25 MiB of document — that is a rounding error and not
 * worth a second code path. At `BODY_LIMITS.gtfsFeedRaw` it is a 200 MiB
 * allocation that anyone holding the upload URL can ask for, repeatedly, before
 * a single byte is validated. This one pulls the body a chunk at a time, keeps a
 * running total, and cancels the stream the moment the total passes the cap.
 *
 * INTERCHANGEABLE ON PURPOSE. The outcome type, the 413 status, and the
 * `{ error, maxBytes }` body are identical, so a route can be moved from one to
 * the other without its callers noticing.
 *
 * ONE FIELD MEANS SOMETHING SLIGHTLY DIFFERENT, and it is worth knowing which.
 * On refusal, `byteLength` is the number of bytes READ before the abort, not the
 * size of the body — the size of the body is exactly what this function refuses
 * to find out. It is always greater than `maxBytes`, which is what the callers
 * that log it are checking.
 *
 * A request with no readable stream — an empty body, or a runtime that does not
 * expose one — falls back to the buffering reader. There is nothing to stream,
 * so there is nothing to protect against.
 */
export async function readBytesWithLimitStreaming(
  request: Request,
  maxBytes: number,
): Promise<ReadBytesWithLimitResult> {
  const body = request.body;
  if (!body) {
    return readBytesWithLimit(request, maxBytes);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;

    byteLength += value.byteLength;

    if (byteLength > maxBytes) {
      // Stop the upload here. Without this the sender keeps sending and the
      // rest of the body is read and discarded, which costs exactly what the
      // limit was meant to save.
      await reader.cancel("Request body exceeded the limit for this route").catch(() => {
        // The stream was already gone. Nothing to release.
      });
      return {
        ok: false,
        byteLength,
        response: bodyTooLargeResponse(maxBytes),
      };
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, bytes, byteLength };
}

export async function readJsonWithLimit<T = unknown>(
  request: Request,
  maxBytes: number,
): Promise<ReadJsonWithLimitResult<T>> {
  const textResult = await readTextWithLimit(request, maxBytes);
  if (!textResult.ok) {
    return {
      ok: false,
      byteLength: textResult.byteLength,
      response: textResult.response,
    };
  }

  const { byteLength, text } = textResult;
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, data: null, byteLength, parseError: null, text };
  }

  try {
    return {
      ok: true,
      data: JSON.parse(trimmed) as T,
      byteLength,
      parseError: null,
      text,
    };
  } catch (error) {
    return {
      ok: true,
      data: null,
      byteLength,
      parseError: error instanceof Error ? error : new Error("Invalid JSON"),
      text,
    };
  }
}

export async function readJsonOrNullWithLimit<T = unknown>(
  request: Request,
  maxBytes: number,
): Promise<
  | {
      ok: true;
      data: T | null;
      byteLength: number;
    }
  | {
      ok: false;
      response: NextResponse;
      byteLength: number;
    }
> {
  const body = await readJsonWithLimit<T>(request, maxBytes);
  if (!body.ok) {
    return body;
  }

  return {
    ok: true,
    data: body.parseError ? null : body.data,
    byteLength: body.byteLength,
  };
}
