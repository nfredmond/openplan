import { vi } from "vitest";

/**
 * A browser `fetch` for uploaders that send files through Storage
 * (`lib/files/staged-upload-client.ts`): `.../upload/start` answers a signed
 * URL, the PUT to that URL is recorded, and `.../upload/complete` answers with
 * whatever the test says the route would. Every other request goes to `other`.
 *
 * Each upload is recorded as the three requests a real browser makes, so a
 * test can check what each step carried, and that the file itself went only to
 * Storage and never to an app route.
 */

export type StagedUploadRecord = {
  startUrl: string;
  start: Record<string, unknown>;
  putUrl: string | null;
  putBody: unknown;
  putHeaders: Record<string, string> | null;
  completeUrl: string | null;
  complete: Record<string, unknown> | null;
};

const STORAGE_ORIGIN = "https://storage.example.test";

export function stagedUploadFetch(options: {
  complete: (body: Record<string, unknown>) => Response | Promise<Response>;
  other?: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
  /** Answer the start step with this instead of a signed URL. */
  start?: (body: Record<string, unknown>) => Response | Promise<Response> | null;
  putStatus?: number;
}) {
  const uploads: StagedUploadRecord[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/upload/start")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      uploads.push({
        startUrl: url,
        start: body,
        putUrl: null,
        putBody: null,
        putHeaders: null,
        completeUrl: null,
        complete: null,
      });
      const refused = options.start?.(body);
      if (refused) return refused;
      const n = uploads.length;
      return new Response(
        JSON.stringify({
          uploadUrl: `${STORAGE_ORIGIN}/object/upload/sign/staged/${n}?token=t`,
          objectPath: `staged-object-${n}`,
          contentType: "application/octet-stream",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.startsWith(`${STORAGE_ORIGIN}/object/upload/sign/staged/`)) {
      const n = Number(new URL(url).pathname.split("/").pop());
      const record = uploads[n - 1];
      record.putUrl = url;
      record.putBody = init?.body;
      record.putHeaders = (init?.headers ?? null) as Record<string, string> | null;
      return new Response(null, { status: options.putStatus ?? 200 });
    }
    if (url.endsWith("/upload/complete")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const record = uploads.find((upload) => `staged-object-${uploads.indexOf(upload) + 1}` === body.objectPath);
      if (record) {
        record.completeUrl = url;
        record.complete = body;
      }
      return options.complete(body);
    }
    if (options.other) return options.other(input, init);
    throw new Error(`Unexpected request in staged-upload fetch: ${url}`);
  });
  return { fetch: fetchMock, uploads };
}

export function jsonAnswer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
