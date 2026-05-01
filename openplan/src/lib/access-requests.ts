import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { AccessRequestStatus } from "@/lib/access-request-status";
import type {
  AccessRequestDataSensitivity,
  AccessRequestDeploymentPosture,
  AccessRequestFirstWorkflow,
  AccessRequestOrganizationType,
  AccessRequestServiceLane,
} from "@/lib/access-request-intake";
import type { WorkspaceInvitationStatus } from "@/lib/workspaces/invitations";
export {
  ACCESS_REQUEST_TRIAGE_SIDE_EFFECTS,
  ACCESS_REQUEST_PROVISIONING_SIDE_EFFECTS,
  accessRequestStatusLabel,
  canProvisionAccessRequestStatus,
  canTransitionAccessRequestStatus,
  getAccessRequestTransitionOptions,
  isAccessRequestTriageStatus,
  accessRequestProvisioningSideEffectLabel,
  accessRequestTriageSideEffectLabel,
  type AccessRequestStatus,
  type AccessRequestProvisionableStatus,
  type AccessRequestTriageStatus,
} from "@/lib/access-request-status";

export const ACCESS_REQUEST_REVIEW_EMAILS_ENV = "OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS";
export const ACCESS_REQUEST_RATE_WINDOW_MINUTES = 10;
export const ACCESS_REQUEST_DUPLICATE_WINDOW_MINUTES = 60;
export const ACCESS_REQUEST_MAX_PER_WINDOW = 3;
export const ACCESS_REQUEST_RECENT_LOOKBACK_MINUTES = Math.max(
  ACCESS_REQUEST_RATE_WINDOW_MINUTES,
  ACCESS_REQUEST_DUPLICATE_WINDOW_MINUTES,
);

export type AccessRequestReviewRow = {
  id: string;
  agency_name: string;
  contact_name: string;
  contact_email: string;
  role_title: string | null;
  region: string | null;
  organization_type: AccessRequestOrganizationType | null;
  service_lane: AccessRequestServiceLane | null;
  deployment_posture: AccessRequestDeploymentPosture | null;
  data_sensitivity: AccessRequestDataSensitivity | null;
  desired_first_workflow: AccessRequestFirstWorkflow | null;
  onboarding_needs: string | null;
  use_case: string;
  expected_workspace_name: string | null;
  status: AccessRequestStatus;
  source_path: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  provisioned_workspace_id: string | null;
  review_events: AccessRequestReviewEventRow[];
  owner_invitation: AccessRequestOwnerInvitationSummary | null;
};

export type AccessRequestReviewRequestRow = Omit<AccessRequestReviewRow, "review_events" | "owner_invitation">;

export type AccessRequestReviewEventRow = {
  id: string;
  access_request_id: string;
  previous_status: AccessRequestStatus;
  status: AccessRequestStatus;
  created_at: string | null;
};

export type AccessRequestOwnerInvitationRow = {
  id: string;
  workspace_id: string;
  email_normalized: string;
  role: "owner" | "admin" | "member";
  status: WorkspaceInvitationStatus;
  expires_at: string | null;
  accepted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AccessRequestOwnerInvitationSummary = {
  id: string;
  workspace_id: string;
  status: WorkspaceInvitationStatus;
  expires_at: string | null;
  accepted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

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
  tier?: string;
  checkout?: string;
  legacyCheckout?: boolean;
  checkoutDisabled?: boolean;
  workspaceId?: string;
  source?: string;
};

export type RecentAccessRequestSafetyRecord = {
  id: string;
  created_at: string | null;
  metadata_json: Record<string, unknown> | null;
};

export type AccessRequestReviewClient = {
  from(table: "access_requests"): {
    select: (columns: string) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => {
        limit: (count: number) => Promise<{
          data: AccessRequestReviewRequestRow[] | null;
          error: { message?: string; code?: string | null } | null;
        }>;
      };
    };
  };
  from(table: "access_request_review_events"): {
    select: (columns: string) => {
      in: (
        column: string,
        values: string[],
      ) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => Promise<{
            data: AccessRequestReviewEventRow[] | null;
            error: { message?: string; code?: string | null } | null;
          }>;
        };
      };
    };
  };
  from(table: "workspace_invitations"): {
    select: (columns: string) => {
      in: (
        column: string,
        values: string[],
      ) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => Promise<{
            data: AccessRequestOwnerInvitationRow[] | null;
            error: { message?: string; code?: string | null } | null;
          }>;
        };
      };
    };
  };
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

export const ACCESS_REQUEST_REVIEW_SELECT = [
  "id",
  "agency_name",
  "contact_name",
  "contact_email",
  "role_title",
  "region",
  "organization_type",
  "service_lane",
  "deployment_posture",
  "data_sensitivity",
  "desired_first_workflow",
  "onboarding_needs",
  "use_case",
  "expected_workspace_name",
  "status",
  "source_path",
  "created_at",
  "reviewed_at",
  "provisioned_workspace_id",
].join(", ");

export const ACCESS_REQUEST_SAFETY_SELECT = ["id", "created_at", "metadata_json"].join(", ");
export const ACCESS_REQUEST_REVIEW_EVENTS_SELECT = [
  "id",
  "access_request_id",
  "previous_status",
  "status",
  "created_at",
].join(", ");
export const ACCESS_REQUEST_OWNER_INVITATION_SELECT = [
  "id",
  "workspace_id",
  "email_normalized",
  "role",
  "status",
  "expires_at",
  "accepted_at",
  "created_at",
  "updated_at",
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

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
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

export function normalizeAccessRequestText(value: string | null | undefined): string {
  return normalizeText(value);
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

function attachReviewEvents(
  requests: AccessRequestReviewRequestRow[],
  events: AccessRequestReviewEventRow[],
  ownerInvitations: AccessRequestOwnerInvitationRow[] = [],
): AccessRequestReviewRow[] {
  const eventsByRequest = new Map<string, AccessRequestReviewEventRow[]>();
  for (const event of events) {
    const existing = eventsByRequest.get(event.access_request_id) ?? [];
    existing.push(event);
    eventsByRequest.set(event.access_request_id, existing);
  }

  const ownerInvitationByWorkspaceAndEmail = new Map<string, AccessRequestOwnerInvitationSummary>();
  for (const invitation of ownerInvitations) {
    if (invitation.role !== "owner") continue;
    const key = `${invitation.workspace_id}:${invitation.email_normalized}`;
    if (ownerInvitationByWorkspaceAndEmail.has(key)) continue;
    ownerInvitationByWorkspaceAndEmail.set(key, {
      id: invitation.id,
      workspace_id: invitation.workspace_id,
      status: invitation.status,
      expires_at: invitation.expires_at,
      accepted_at: invitation.accepted_at,
      created_at: invitation.created_at,
      updated_at: invitation.updated_at,
    });
  }

  return requests.map((request) => ({
    ...request,
    review_events: eventsByRequest.get(request.id) ?? [],
    owner_invitation: request.provisioned_workspace_id
      ? ownerInvitationByWorkspaceAndEmail.get(
          `${request.provisioned_workspace_id}:${normalizeAccessRequestEmail(request.contact_email)}`,
        ) ?? null
      : null,
  }));
}

export async function loadRecentAccessRequestsForReview(client: AccessRequestReviewClient, limit = 8) {
  const { data, error } = await client
    .from("access_requests")
    .select(ACCESS_REQUEST_REVIEW_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  const requests = data ?? [];
  if (error || requests.length === 0) {
    return {
      requests: attachReviewEvents(requests, []),
      error,
    };
  }

  const workspaceIds = Array.from(
    new Set(requests.map((request) => request.provisioned_workspace_id).filter((id): id is string => Boolean(id))),
  );
  const reviewEventsPromise = client
    .from("access_request_review_events")
    .select(ACCESS_REQUEST_REVIEW_EVENTS_SELECT)
    .in(
      "access_request_id",
      requests.map((request) => request.id),
    )
    .order("created_at", { ascending: false })
    .limit(limit * 8);
  const ownerInvitationsPromise =
    workspaceIds.length > 0
      ? client
          .from("workspace_invitations")
          .select(ACCESS_REQUEST_OWNER_INVITATION_SELECT)
          .in("workspace_id", workspaceIds)
          .order("created_at", { ascending: false })
          .limit(limit * 4)
      : Promise.resolve({ data: [] as AccessRequestOwnerInvitationRow[], error: null });

  const [
    { data: reviewEvents, error: reviewEventsError },
    { data: ownerInvitations, error: ownerInvitationsError },
  ] = await Promise.all([reviewEventsPromise, ownerInvitationsPromise]);

  return {
    requests: attachReviewEvents(requests, reviewEvents ?? [], ownerInvitations ?? []),
    error: reviewEventsError ?? ownerInvitationsError,
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
