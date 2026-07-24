import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

// Contact-form intake safety helpers. This module used to also carry the
// founder-era operator REVIEW console (canReviewAccessRequests, review-row
// types, triage/provision state machine); that console was deleted along with
// /admin. What remains is only what the public /contact form and its storage
// route (src/app/api/request-access/route.ts) need: rate/duplicate-limit
// evaluation and metadata fingerprinting. Submitted messages persist in
// access_requests and are read out-of-band (e.g. the Supabase dashboard).

export const ACCESS_REQUEST_RATE_WINDOW_MINUTES = 10;
export const ACCESS_REQUEST_DUPLICATE_WINDOW_MINUTES = 60;
export const ACCESS_REQUEST_MAX_PER_WINDOW = 3;
export const ACCESS_REQUEST_RECENT_LOOKBACK_MINUTES = Math.max(
  ACCESS_REQUEST_RATE_WINDOW_MINUTES,
  ACCESS_REQUEST_DUPLICATE_WINDOW_MINUTES,
);

export type AccessRequestSafetyInput = {
  agencyName: string;
  contactEmail: string;
  serviceLane?: string | null;
  desiredFirstWorkflow?: string | null;
  useCase: string;
  expectedWorkspaceName?: string | null;
};

export type AccessRequestSourceContext = {
  product?: string;
  workspaceId?: string;
  source?: string;
  intent?: string;
};

export type RecentAccessRequestSafetyRecord = {
  id: string;
  created_at: string | null;
  metadata_json: Record<string, unknown> | null;
};

export type AccessRequestSafetyClient = {
  from: (table: "access_requests") => {
    select: (columns: string) => {
      gte: (
        column: string,
        value: string,
      ) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => Promise<{
            data: RecentAccessRequestSafetyRecord[] | null;
            error: { message?: string; code?: string | null } | null;
          }>;
        };
      };
    };
  };
};

export const ACCESS_REQUEST_SAFETY_SELECT = ["id", "created_at", "metadata_json"].join(", ");

function firstHeader(request: NextRequest, keys: string[]): string | null {
  for (const key of keys) {
    const value = request.headers.get(key);
    if (value) return value;
  }
  return null;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function normalizeAccessRequestEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function getAccessRequestClientIp(request: NextRequest): string {
  return firstHeader(request, ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"])
    ?.split(",")[0]
    ?.trim() || "unknown";
}

export function getAccessRequestUserAgent(request: NextRequest): string {
  return normalizeText(request.headers.get("user-agent") ?? "unknown").slice(0, 240);
}

export function buildAccessRequestClientFingerprint(request: NextRequest): string {
  return hashValue(`${getAccessRequestClientIp(request)}|${getAccessRequestUserAgent(request)}`);
}

export function buildAccessRequestBodyFingerprint(input: AccessRequestSafetyInput): string {
  return hashValue(
    [
      normalizeText(input.agencyName).toLowerCase(),
      normalizeAccessRequestEmail(input.contactEmail),
      normalizeText(input.expectedWorkspaceName).toLowerCase(),
      normalizeText(input.serviceLane).toLowerCase(),
      normalizeText(input.desiredFirstWorkflow).toLowerCase(),
      normalizeText(input.useCase).toLowerCase(),
    ].join("|"),
  );
}

function parseRefererHost(request: NextRequest): string | null {
  const referer = firstHeader(request, ["referer", "referrer"]);
  if (!referer) return null;

  try {
    return new URL(referer).host;
  } catch {
    return null;
  }
}

export function buildAccessRequestMetadata(request: NextRequest, receivedAt = new Date().toISOString()) {
  return {
    submitted_via: "request_access_form",
    source_fingerprint: buildAccessRequestClientFingerprint(request),
    user_agent: getAccessRequestUserAgent(request),
    referer_host: parseRefererHost(request),
    received_at: receivedAt,
  };
}

export function buildAccessRequestSupportMetadata(
  request: NextRequest,
  input: AccessRequestSafetyInput,
  receivedAt = new Date().toISOString(),
  sourceContext?: AccessRequestSourceContext | null,
) {
  const metadata: Record<string, unknown> = {
    ...buildAccessRequestMetadata(request, receivedAt),
    body_fingerprint: buildAccessRequestBodyFingerprint(input),
  };

  if (sourceContext && Object.keys(sourceContext).length > 0) {
    metadata.source_context = sourceContext;
  }

  return metadata;
}

export function evaluateAccessRequestSafety(input: {
  request: NextRequest;
  accessRequest: AccessRequestSafetyInput;
  recentRequests: RecentAccessRequestSafetyRecord[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const rateWindowMs = ACCESS_REQUEST_RATE_WINDOW_MINUTES * 60 * 1000;
  const duplicateWindowMs = ACCESS_REQUEST_DUPLICATE_WINDOW_MINUTES * 60 * 1000;
  const clientFingerprint = buildAccessRequestClientFingerprint(input.request);
  const bodyFingerprint = buildAccessRequestBodyFingerprint(input.accessRequest);
  const recentFromClient = input.recentRequests.filter((request) => {
    const createdAt = parseTimestamp(request.created_at);
    if (createdAt === null || nowMs - createdAt > rateWindowMs) return false;
    return request.metadata_json?.source_fingerprint === clientFingerprint;
  });
  const duplicateRecentRequest = input.recentRequests.find((request) => {
    const createdAt = parseTimestamp(request.created_at);
    if (createdAt === null || nowMs - createdAt > duplicateWindowMs) return false;
    return request.metadata_json?.body_fingerprint === bodyFingerprint;
  });

  return {
    clientFingerprint,
    bodyFingerprint,
    recentFromClientCount: recentFromClient.length,
    duplicateRecentRequestId: duplicateRecentRequest?.id ?? null,
    isRateLimited: recentFromClient.length >= ACCESS_REQUEST_MAX_PER_WINDOW,
    isDuplicate: Boolean(duplicateRecentRequest),
  };
}

export async function loadRecentAccessRequestsForSafety(
  client: AccessRequestSafetyClient,
  lookbackStart: string,
  limit = 25,
) {
  const { data, error } = await client
    .from("access_requests")
    .select(ACCESS_REQUEST_SAFETY_SELECT)
    .gte("created_at", lookbackStart)
    .order("created_at", { ascending: false })
    .limit(limit);

  return {
    requests: data ?? [],
    error,
  };
}
