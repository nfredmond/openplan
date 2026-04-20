import { NextResponse } from "next/server";

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

const encoder = new TextEncoder();

export async function readJsonWithLimit<T = unknown>(
  request: Request,
  maxBytes: number,
): Promise<ReadJsonWithLimitResult<T>> {
  const text = await request.text();
  const byteLength = encoder.encode(text).byteLength;

  if (byteLength > maxBytes) {
    return {
      ok: false,
      byteLength,
      response: NextResponse.json(
        {
          error: "Request body too large",
          maxBytes,
        },
        { status: 413 },
      ),
    };
  }

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
