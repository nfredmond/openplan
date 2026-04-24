import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

export const ACCESS_REQUEST_REVIEW_EMAILS_ENV = "OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS";

export type AccessRequestStatus =
  | "new"
  | "reviewing"
  | "contacted"
  | "invited"
  | "provisioned"
  | "deferred"
  | "declined";

export type AccessRequestReviewRow = {
  id: string;
  agency_name: string;
  contact_name: string;
  contact_email: string;
  role_title: string | null;
  region: string | null;
  use_case: string;
  expected_workspace_name: string | null;
  status: AccessRequestStatus;
  source_path: string | null;
  created_at: string | null;
  provisioned_workspace_id: string | null;
};

export type AccessRequestReviewClient = {
  from: (table: "access_requests") => {
    select: (columns: string) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => {
        limit: (count: number) => Promise<{
          data: AccessRequestReviewRow[] | null;
          error: { message?: string; code?: string | null } | null;
        }>;
      };
    };
  };
};

export const ACCESS_REQUEST_REVIEW_SELECT = [
  "id",
  "agency_name",
  "contact_name",
  "contact_email",
  "role_title",
  "region",
  "use_case",
  "expected_workspace_name",
  "status",
  "source_path",
  "created_at",
  "provisioned_workspace_id",
].join(", ");

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

export function normalizeAccessRequestEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function parseAccessRequestReviewerEmails(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => normalizeAccessRequestEmail(email))
      .filter(Boolean),
  );
}

export function canReviewAccessRequests(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAccessRequestReviewerEmails(process.env[ACCESS_REQUEST_REVIEW_EMAILS_ENV]).has(
    normalizeAccessRequestEmail(email),
  );
}

export function buildAccessRequestMetadata(request: NextRequest, receivedAt = new Date().toISOString()) {
  const clientIp = firstHeader(request, ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"])
    ?.split(",")[0]
    ?.trim() || "unknown";
  const userAgent = normalizeText(request.headers.get("user-agent") ?? "unknown").slice(0, 240);
  const referer = firstHeader(request, ["referer", "referrer"]);
  let refererHost: string | null = null;

  if (referer) {
    try {
      refererHost = new URL(referer).host;
    } catch {
      refererHost = null;
    }
  }

  return {
    submitted_via: "request_access_form",
    source_fingerprint: hashValue(`${clientIp}|${userAgent}`),
    user_agent: userAgent,
    referer_host: refererHost,
    received_at: receivedAt,
  };
}

export function accessRequestStatusLabel(status: AccessRequestStatus): string {
  const labels: Record<AccessRequestStatus, string> = {
    new: "New",
    reviewing: "Reviewing",
    contacted: "Contacted",
    invited: "Invited",
    provisioned: "Provisioned",
    deferred: "Deferred",
    declined: "Declined",
  };

  return labels[status] ?? status;
}

export async function loadRecentAccessRequestsForReview(client: AccessRequestReviewClient) {
  const { data, error } = await client
    .from("access_requests")
    .select(ACCESS_REQUEST_REVIEW_SELECT)
    .order("created_at", { ascending: false })
    .limit(8);

  return {
    requests: data ?? [],
    error,
  };
}
