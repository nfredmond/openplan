import { NextResponse } from "next/server";

export const BODY_LIMITS = {
  adminTriageJson: 4 * 1024,
  smallJson: 16 * 1024,
  normalJson: 64 * 1024,
  documentJson: 256 * 1024,
  networkGeoJson: 2 * 1024 * 1024,
  stripeWebhookRaw: 256 * 1024,
  // Public engagement photo upload: 5 MB image payload (matches the
  // engagement-photos bucket file_size_limit) plus small headroom.
  publicPhotoRaw: 5 * 1024 * 1024,
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
