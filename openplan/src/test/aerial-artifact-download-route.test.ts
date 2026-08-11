import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * CUSTODY'S READ HALF — the route that hands back bytes OpenPlan holds.
 *
 * The custody engine stores sha256-verified artifacts in the private
 * `aerial-artifacts` bucket, and until this route existed nothing could mint a
 * download URL for any of them: custody was write-only. Because the bucket is
 * private and the signing runs with the service role, this route's own checks
 * ARE the access control — there is no RLS net under a service-role signing
 * call. So the fakes here RECORD every filter and every signing argument, and
 * the assertions are on those recordings, not just on status codes.
 *
 * What is asserted: membership against the job's own workspace is enforced, a
 * custody id cannot be dereferenced through another job (the lookup is filtered
 * by BOTH ids, and a workspace mismatch refuses), only `held` rows are signed,
 * a non-held row answers with its own recorded failure sentence rather than a
 * raw storage error, and the signing call is scoped to the custody row's own
 * bucket and path.
 */

const createServiceRoleClientMock = vi.fn();
const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const jobMaybeSingleMock = vi.fn();
const custodyMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const authGetUserMock = vi.fn();
const createSignedUrlMock = vi.fn();

const audit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Every filter the route put on the custody lookup, recorded as [column, value]. */
const custodyFilters: Array<[string, string]> = [];
/** Every filter on the job lookup. */
const jobFilters: Array<[string, string]> = [];
/** Every filter on the membership lookup. */
const membershipFilters: Array<[string, string]> = [];
/** Which bucket each createSignedUrl call was issued against. */
const signedBuckets: string[] = [];

function custodyChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (column: string, value: string) => {
      custodyFilters.push([column, value]);
      return chain;
    },
    maybeSingle: custodyMaybeSingleMock,
  };
  return chain;
}

function jobChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (column: string, value: string) => {
      jobFilters.push([column, value]);
      return chain;
    },
    maybeSingle: jobMaybeSingleMock,
  };
  return chain;
}

function membershipChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (column: string, value: string) => {
      membershipFilters.push([column, value]);
      return chain;
    },
    maybeSingle: membershipMaybeSingleMock,
  };
  return chain;
}

const serviceFromMock = vi.fn((table: string) => {
  if (table === "aerial_processing_jobs") return jobChain();
  if (table === "aerial_artifact_custody") return custodyChain();
  throw new Error(`Unexpected service table: ${table}`);
});

const memberFromMock = vi.fn((table: string) => {
  if (table === "workspace_members") return membershipChain();
  throw new Error(`Unexpected member table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET as getArtifactDownload } from "@/app/api/aerial/processing-jobs/[jobId]/artifacts/[custodyId]/download/route";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTODY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";

const HELD_PATH = `${WORKSPACE_ID}/${MISSION_ID}/${JOB_ID}/orthomosaic.tif`;
const SIGNED_URL = "https://storage.example.net/sign/abc?token=signed-token";

function heldCustodyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CUSTODY_ID,
    workspace_id: WORKSPACE_ID,
    mission_id: MISSION_ID,
    processing_job_id: JOB_ID,
    kind: "orthomosaic",
    ordinal: 0,
    state: "held",
    storage_bucket: "aerial-artifacts",
    storage_path: HELD_PATH,
    byte_size: 4,
    checksum_sha256: "a".repeat(64),
    content_type: "image/tiff",
    source_expires_at: "2099-07-22T14:30:00Z",
    failure_code: null,
    failure_detail: null,
    ...overrides,
  };
}

function call(jobId = JOB_ID, custodyId = CUSTODY_ID) {
  return getArtifactDownload(
    new NextRequest(`http://localhost/api/aerial/processing-jobs/${jobId}/artifacts/${custodyId}/download`),
    { params: Promise.resolve({ jobId, custodyId }) }
  );
}

describe("GET /api/aerial/processing-jobs/[jobId]/artifacts/[custodyId]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    custodyFilters.length = 0;
    jobFilters.length = 0;
    membershipFilters.length = 0;
    signedBuckets.length = 0;

    createApiAuditLoggerMock.mockReturnValue(audit);
    createServiceRoleClientMock.mockReturnValue({
      from: serviceFromMock,
      storage: {
        from: (bucket: string) => {
          signedBuckets.push(bucket);
          return { createSignedUrl: createSignedUrlMock };
        },
      },
    });
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: memberFromMock,
    });

    authGetUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    jobMaybeSingleMock.mockResolvedValue({
      data: { id: JOB_ID, workspace_id: WORKSPACE_ID, mission_id: MISSION_ID },
      error: null,
    });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
    custodyMaybeSingleMock.mockResolvedValue({ data: heldCustodyRow(), error: null });
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: SIGNED_URL }, error: null });
  });

  it("redirects a workspace member to a signed URL scoped to the custody row's own bucket and path", async () => {
    const response = await call();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(SIGNED_URL);

    // The signing call is bound to the ROW's bucket and path — recorded from
    // the fake, so pointing it anywhere else fails here.
    expect(signedBuckets).toEqual(["aerial-artifacts"]);
    expect(createSignedUrlMock).toHaveBeenCalledTimes(1);
    const [path, ttl, options] = createSignedUrlMock.mock.calls[0];
    expect(path).toBe(HELD_PATH);
    expect(ttl).toBe(15 * 60);
    // A filename a planner can recognise: the object's own basename.
    expect(options).toMatchObject({ download: "orthomosaic.tif" });

    // The custody lookup is filtered by BOTH the row id and the parent job —
    // this is what makes a custody id from another job undereferenceable.
    expect(custodyFilters).toContainEqual(["id", CUSTODY_ID]);
    expect(custodyFilters).toContainEqual(["processing_job_id", JOB_ID]);
    // And membership was checked against the job's own workspace.
    expect(membershipFilters).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(membershipFilters).toContainEqual(["user_id", "user-1"]);
  });

  it("refuses a signed-out caller", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await call();

    expect(response.status).toBe(401);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("refuses a member of another workspace", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await call();

    expect(response.status).toBe(403);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("refuses a decoy custody row whose workspace is not the job's", async () => {
    // A forged/corrupted row: it matched the id+job filters, but names another
    // workspace. The route must refuse rather than sign across the boundary.
    custodyMaybeSingleMock.mockResolvedValue({
      data: heldCustodyRow({ workspace_id: OTHER_WORKSPACE_ID }),
      error: null,
    });

    const response = await call();

    expect(response.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("answers 404 when the custody row does not belong to this job", async () => {
    // The id+job filter found nothing: the row exists under some other job.
    custodyMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await call();

    expect(response.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("refuses a non-held row with ITS OWN recorded failure sentence, never a storage error", async () => {
    const recorded =
      "The orthomosaic could not be taken into OpenPlan's custody: worker.example.net answered HTTP 504 instead of the file.";
    custodyMaybeSingleMock.mockResolvedValue({
      data: heldCustodyRow({
        state: "failed",
        storage_bucket: null,
        storage_path: null,
        byte_size: null,
        checksum_sha256: null,
        failure_code: "http_error",
        failure_detail: recorded,
      }),
      error: null,
    });

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("artifact_not_held");
    expect(body.state).toBe("failed");
    expect(body.detail).toBe(recorded);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("says a pending row is not downloadable yet, without inventing a failure", async () => {
    custodyMaybeSingleMock.mockResolvedValue({
      data: heldCustodyRow({
        state: "pending",
        storage_bucket: null,
        storage_path: null,
        byte_size: null,
        checksum_sha256: null,
      }),
      error: null,
    });

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.state).toBe("pending");
    expect(body.detail).toMatch(/not been taken into OpenPlan's custody yet/);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("refuses a refused row with the recorded ceiling sentence", async () => {
    const recorded =
      "The point cloud could not be taken into OpenPlan's custody: it exceeds this deployment's per-artifact ceiling of 256.0 MB.";
    custodyMaybeSingleMock.mockResolvedValue({
      data: heldCustodyRow({
        state: "refused",
        storage_bucket: null,
        storage_path: null,
        byte_size: null,
        checksum_sha256: null,
        failure_code: "too_large",
        failure_detail: recorded,
      }),
      error: null,
    });

    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.detail).toBe(recorded);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("will not sign for a held row whose object lives outside this job's own prefix", async () => {
    custodyMaybeSingleMock.mockResolvedValue({
      data: heldCustodyRow({
        storage_path: `${OTHER_WORKSPACE_ID}/${MISSION_ID}/${JOB_ID}/orthomosaic.tif`,
      }),
      error: null,
    });

    const response = await call();

    expect(response.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("will not sign against a bucket that is not the aerial artifact bucket", async () => {
    custodyMaybeSingleMock.mockResolvedValue({
      data: heldCustodyRow({ storage_bucket: "report-artifacts" }),
      error: null,
    });

    const response = await call();

    expect(response.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("rejects params that are not uuids", async () => {
    const response = await call("not-a-uuid", CUSTODY_ID);

    expect(response.status).toBe(400);
    expect(jobMaybeSingleMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("never logs or returns the signed URL beyond the redirect itself", async () => {
    await call();

    const logged = JSON.stringify([
      ...audit.info.mock.calls,
      ...audit.warn.mock.calls,
      ...audit.error.mock.calls,
    ]);
    expect(logged).not.toContain("signed-token");
  });
});
