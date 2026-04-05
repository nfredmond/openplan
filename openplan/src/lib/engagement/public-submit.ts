import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

export const PUBLIC_SUBMISSION_RATE_WINDOW_MINUTES = 10;
export const PUBLIC_SUBMISSION_DUPLICATE_WINDOW_MINUTES = 60;
export const PUBLIC_SUBMISSION_MAX_PER_WINDOW = 3;
export const PUBLIC_SUBMISSION_RECENT_LOOKBACK_MINUTES = Math.max(
  PUBLIC_SUBMISSION_RATE_WINDOW_MINUTES,
  PUBLIC_SUBMISSION_DUPLICATE_WINDOW_MINUTES
);

export type RecentPublicSubmissionRecord = {
  id: string;
  title: string | null;
  body: string;
  created_at: string | null;
  metadata_json: Record<string, unknown> | null;
};

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function firstHeader(request: NextRequest, keys: string[]): string | null {
  for (const key of keys) {
    const value = request.headers.get(key);
    if (value) {
      return value;
    }
  }
  return null;
}

export function normalizePublicSubmissionText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function getPublicSubmissionClientIp(request: NextRequest): string {
  return firstHeader(request, ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"])
    ?.split(",")[0]
    ?.trim() || "unknown";
}

export function getPublicSubmissionUserAgent(request: NextRequest): string {
  return normalizePublicSubmissionText(request.headers.get("user-agent") ?? "unknown").slice(0, 240);
}

export function buildPublicSubmissionClientFingerprint(request: NextRequest): string {
  return hashValue(`${getPublicSubmissionClientIp(request)}|${getPublicSubmissionUserAgent(request)}`);
}

export function buildPublicSubmissionBodyFingerprint(input: {
  title?: string | null;
  body: string;
}): string {
  return hashValue(
    `${normalizePublicSubmissionText(input.title).toLowerCase()}|${normalizePublicSubmissionText(input.body).toLowerCase()}`
  );
}

export function countUrlsInPublicSubmission(text: string): number {
  return (text.match(/\b(?:https?:\/\/|www\.)\S+/gi) ?? []).length;
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

export function buildPublicSubmissionSupportMetadata(
  request: NextRequest,
  input: {
    title?: string | null;
    body: string;
    receivedAt?: string;
    autoFlagReason?: string | null;
  }
) {
  return {
    submitted_via: "public_portal",
    source_fingerprint: buildPublicSubmissionClientFingerprint(request),
    body_fingerprint: buildPublicSubmissionBodyFingerprint(input),
    referer_host: parseRefererHost(request),
    user_agent: getPublicSubmissionUserAgent(request),
    received_at: input.receivedAt ?? new Date().toISOString(),
    auto_flag_reason: input.autoFlagReason ?? null,
  };
}

export function evaluatePublicSubmissionSafety(input: {
  request: NextRequest;
  title?: string | null;
  body: string;
  recentItems: RecentPublicSubmissionRecord[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const recentWindowMs = PUBLIC_SUBMISSION_RATE_WINDOW_MINUTES * 60 * 1000;
  const duplicateWindowMs = PUBLIC_SUBMISSION_DUPLICATE_WINDOW_MINUTES * 60 * 1000;
  const clientFingerprint = buildPublicSubmissionClientFingerprint(input.request);
  const bodyFingerprint = buildPublicSubmissionBodyFingerprint({
    title: input.title,
    body: input.body,
  });
  const recentFromClient = input.recentItems.filter((item) => {
    const createdAt = parseTimestamp(item.created_at);
    if (createdAt === null || nowMs - createdAt > recentWindowMs) {
      return false;
    }

    return item.metadata_json?.source_fingerprint === clientFingerprint;
  });
  const duplicateRecentItem = input.recentItems.find((item) => {
    const createdAt = parseTimestamp(item.created_at);
    if (createdAt === null || nowMs - createdAt > duplicateWindowMs) {
      return false;
    }

    if (item.metadata_json?.body_fingerprint === bodyFingerprint) {
      return true;
    }

    return buildPublicSubmissionBodyFingerprint({ title: item.title, body: item.body }) === bodyFingerprint;
  });

  const urlCount = countUrlsInPublicSubmission(
    `${normalizePublicSubmissionText(input.title)} ${normalizePublicSubmissionText(input.body)}`
  );
  const autoFlagReason =
    urlCount >= 3 ? "Auto-flagged for unusually high link count in a public submission." : null;

  return {
    clientFingerprint,
    bodyFingerprint,
    recentFromClientCount: recentFromClient.length,
    duplicateRecentItemId: duplicateRecentItem?.id ?? null,
    isRateLimited: recentFromClient.length >= PUBLIC_SUBMISSION_MAX_PER_WINDOW,
    isDuplicate: Boolean(duplicateRecentItem),
    autoFlagReason,
  };
}
