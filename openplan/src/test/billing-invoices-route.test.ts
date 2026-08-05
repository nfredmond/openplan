import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const workspaceMembersMaybeSingleMock = vi.fn();
const workspaceMembersEqUserMock = vi.fn(() => ({ maybeSingle: workspaceMembersMaybeSingleMock }));
const workspaceMembersEqWorkspaceMock = vi.fn(() => ({ eq: workspaceMembersEqUserMock }));
const workspaceMembersSelectMock = vi.fn(() => ({ eq: workspaceMembersEqWorkspaceMock }));

const projectsSingleMock = vi.fn();
const projectsEqMock = vi.fn(() => ({ single: projectsSingleMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsEqMock }));

const fundingAwardsSingleMock = vi.fn();
const fundingAwardsEqMock = vi.fn(() => ({ single: fundingAwardsSingleMock }));
const fundingAwardsSelectMock = vi.fn(() => ({ eq: fundingAwardsEqMock }));

const billingInvoicesSingleMock = vi.fn();
const billingInvoicesSelectMock = vi.fn(() => ({ single: billingInvoicesSingleMock }));
const billingInvoicesInsertMock = vi.fn(() => ({ select: billingInvoicesSelectMock }));

const workspacesMaybeSingleMock = vi.fn();
const workspacesEqMock = vi.fn(() => ({ maybeSingle: workspacesMaybeSingleMock }));
const workspacesSelectMock = vi.fn(() => ({ eq: workspacesEqMock }));

const fromMock = vi.fn((table: string) => {
  if (table === "workspace_members") {
    return { select: workspaceMembersSelectMock };
  }

  if (table === "projects") {
    return { select: projectsSelectMock };
  }

  if (table === "billing_invoice_records") {
    return { insert: billingInvoicesInsertMock };
  }

  if (table === "funding_awards") {
    return { select: fundingAwardsSelectMock };
  }

  if (table === "workspaces") {
    return { select: workspacesSelectMock };
  }

  throw new Error(`Unexpected table: ${table}`);
});

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

// The real registry plus one future-shaped profile whose posture vocabulary
// the legacy column's CHECK cannot store. Built with the REAL
// createReimbursementProfileRegistry so registry semantics stay untouched;
// only the registration list grows, exactly as a new jurisdiction would.
vi.mock("@/lib/invoicing/reimbursement-profiles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/invoicing/reimbursement-profiles")>(
    "@/lib/invoicing/reimbursement-profiles"
  );
  return {
    ...actual,
    reimbursementProfileRegistry: actual.createReimbursementProfileRegistry([
      ...actual.BUILT_IN_REIMBURSEMENT_PROFILE_REGISTRATIONS,
      {
        profileId: "test_beyond_legacy_check_v1",
        profileName: "Test profile beyond the legacy CHECK",
        version: "1.0.0",
        jurisdiction: { country: "US", subdivision: "NV", label: "Nevada, United States" },
        postureOptions: [{ postureId: "hourly_progress_billing", label: "Hourly progress billing" }],
        defaultPostureId: "hourly_progress_billing",
        isInterimDefault: false,
      },
    ]),
  };
});

import { POST as postInvoice } from "@/app/api/invoicing/invoices/route";

function jsonRequest(payload: unknown) {
  return new NextRequest("http://localhost/api/invoicing/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/invoicing/invoices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });

    workspaceMembersMaybeSingleMock.mockResolvedValue({
      data: {
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        role: "owner",
      },
      error: null,
    });

    projectsSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      error: null,
    });

    fundingAwardsSingleMock.mockResolvedValue({
      data: {
        id: "77777777-7777-4777-8777-777777777777",
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        project_id: "11111111-1111-4111-8111-111111111111",
      },
      error: null,
    });

    billingInvoicesSingleMock.mockResolvedValue({
      data: {
        id: "99999999-9999-4999-8999-999999999999",
        invoice_number: "OP-2026-001",
        net_amount: 11400,
        status: "submitted",
      },
      error: null,
    });

    // No home geography stated → the labeled interim default profile applies.
    workspacesMaybeSingleMock.mockResolvedValue({
      data: {
        home_geography_source: null,
        home_geography_kind: null,
        home_geography_ref: null,
        home_country_code: null,
        home_subdivision_code: null,
      },
      error: null,
    });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-001",
        amount: 1000,
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 403 when the member role attempts to write invoice records", async () => {
    workspaceMembersMaybeSingleMock.mockResolvedValueOnce({
      data: {
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        role: "member",
      },
      error: null,
    });

    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-001",
        amount: 1000,
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Owner or admin role required for invoice writes" });
  });

  it("creates a billing invoice record with computed retention and net values", async () => {
    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        projectId: "11111111-1111-4111-8111-111111111111",
        invoiceNumber: "OP-2026-001",
        consultantName: "Jordan Rivera Consulting",
        billingBasis: "time_and_materials",
        status: "submitted",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-15",
        invoiceDate: "2026-03-15",
        dueDate: "2026-03-30",
        amount: 12000,
        retentionPercent: 5,
        supportingDocsStatus: "complete",
        submittedTo: "District office, local assistance",
        reimbursementProfileId: "us_ca_lapm_reimbursement_v1",
        reimbursementPosture: "deferred_exact_forms",
        notes: "Exact exhibit/form IDs still deferred in v0.1.",
      })
    );

    expect(response.status).toBe(201);
    // `explicitly_requested` is reserved for a request that actually carries a
    // caller-chosen profile id, as this one does — the UI never sends one.
    expect(billingInvoicesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        project_id: "11111111-1111-4111-8111-111111111111",
        invoice_number: "OP-2026-001",
        consultant_name: "Jordan Rivera Consulting",
        amount: 12000,
        retention_percent: 5,
        retention_amount: 600,
        net_amount: 11400,
        supporting_docs_status: "complete",
        reimbursement_profile_id: "us_ca_lapm_reimbursement_v1",
        reimbursement_posture: "deferred_exact_forms",
        reimbursement_profile_selection: "explicitly_requested",
      })
    );

    // The legacy column is no longer written; its DB DEFAULT fills it.
    expect(billingInvoicesInsertMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ caltrans_posture: expect.anything() })
    );

    expect(await response.json()).toMatchObject({
      invoice: {
        id: "99999999-9999-4999-8999-999999999999",
        invoice_number: "OP-2026-001",
        net_amount: 11400,
      },
    });
  });

  it("resolves the profile from the workspace's own home geography", async () => {
    workspacesMaybeSingleMock.mockResolvedValueOnce({
      data: {
        home_geography_source: "tigerweb",
        home_geography_kind: "county",
        home_geography_ref: "06057",
        home_country_code: "US",
        home_subdivision_code: "CA",
      },
      error: null,
    });

    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-003",
        amount: 1000,
      })
    );

    expect(response.status).toBe(201);
    expect(billingInvoicesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reimbursement_profile_id: "us_ca_lapm_reimbursement_v1",
        reimbursement_posture: "deferred_exact_forms",
        reimbursement_profile_selection: "jurisdiction_matched",
      })
    );
  });

  it("labels the no-geography fallback as the interim default, honestly", async () => {
    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-004",
        amount: 1000,
      })
    );

    expect(response.status).toBe(201);
    // The interim default is now the nationwide generic profile, and its
    // default posture fills in when the caller sends none.
    expect(billingInvoicesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reimbursement_profile_id: "us_federal_generic_reimbursement_v1",
        reimbursement_posture: "progress_invoicing",
        reimbursement_profile_selection: "interim_unconfigured_default",
      })
    );
  });

  it("records a UI-shaped payload (posture only, no profile id) with the TRUE selection, never explicitly_requested", async () => {
    // The composer sends only the posture. On a workspace with no home
    // geography, the honest provenance is interim_unconfigured_default — a
    // profile id echoed from a page-resolved binding must never turn that
    // into an explicit choice nobody made.
    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-010",
        amount: 1000,
        reimbursementPosture: "final_only",
      })
    );

    expect(response.status).toBe(201);
    expect(billingInvoicesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reimbursement_profile_id: "us_federal_generic_reimbursement_v1",
        reimbursement_posture: "final_only",
        reimbursement_profile_selection: "interim_unconfigured_default",
      })
    );
    expect(billingInvoicesInsertMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ reimbursement_profile_selection: "explicitly_requested" })
    );
  });

  it("rejects a posture the resolved profile does not declare", async () => {
    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-005",
        amount: 1000,
        reimbursementPosture: "not_in_any_profile",
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/not part of the/);
    // The no-geography workspace resolves the nationwide generic profile, so
    // the valid postures offered back are that profile's own vocabulary.
    expect(payload.validPostures).toContain("progress_invoicing");
    expect(billingInvoicesInsertMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown profile id instead of substituting the default", async () => {
    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-006",
        amount: 1000,
        reimbursementProfileId: "not_a_profile",
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/Unknown reimbursement profile/);
    expect(payload.availableProfiles).toContain("us_ca_lapm_reimbursement_v1");
    expect(payload.availableProfiles).toContain("us_federal_generic_reimbursement_v1");
    expect(billingInvoicesInsertMock).not.toHaveBeenCalled();
  });

  it("falls back to the legacy insert shape when the profile columns are pending, carrying the validated posture", async () => {
    // A California workspace, so the LAPM profile resolves and the chosen
    // posture is one the legacy column's CHECK can store. (The nationwide
    // generic profile's postures are all beyond the legacy CHECK, so a
    // generic-profile workspace on a pre-migration database gets the honest
    // 503 refusal covered below instead of this fallback.)
    workspacesMaybeSingleMock.mockResolvedValueOnce({
      data: {
        home_geography_source: "tigerweb",
        home_geography_kind: "county",
        home_geography_ref: "06057",
        home_country_code: "US",
        home_subdivision_code: "CA",
      },
      error: null,
    });
    billingInvoicesSingleMock.mockResolvedValueOnce({
      data: null,
      error: {
        message:
          "Could not find the 'reimbursement_profile_id' column of 'billing_invoice_records' in the schema cache",
      },
    });

    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-007",
        amount: 1000,
        reimbursementPosture: "federal_aid_candidate",
      })
    );

    expect(response.status).toBe(201);
    expect(billingInvoicesInsertMock).toHaveBeenCalledTimes(2);
    const retryPayload = (billingInvoicesInsertMock.mock.calls[1] as unknown[])[0] as Record<string, unknown>;
    expect(retryPayload).not.toHaveProperty("reimbursement_profile_id");
    expect(retryPayload).not.toHaveProperty("reimbursement_posture");
    expect(retryPayload).not.toHaveProperty("reimbursement_profile_selection");
    // The legacy column is the only place a posture can live on this
    // deployment, so the user's validated choice is written into it — the
    // column DEFAULT must never silently overwrite what the user chose.
    expect(retryPayload.caltrans_posture).toBe("federal_aid_candidate");
  });

  it("refuses (503, naming the migration) when the legacy column cannot store the chosen posture", async () => {
    billingInvoicesSingleMock.mockResolvedValueOnce({
      data: null,
      error: {
        message:
          "Could not find the 'reimbursement_profile_id' column of 'billing_invoice_records' in the schema cache",
      },
    });

    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invoiceNumber: "OP-2026-011",
        amount: 1000,
        reimbursementProfileId: "test_beyond_legacy_check_v1",
        reimbursementPosture: "hourly_progress_billing",
      })
    );

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error).toMatch(/20260727000009/);
    // Only the profile-shaped insert was attempted: the record was never
    // silently saved under a posture the user did not choose.
    expect(billingInvoicesInsertMock).toHaveBeenCalledTimes(1);
  });

  it("links an invoice to a funding award and inherits the award project when needed", async () => {
    const response = await postInvoice(
      jsonRequest({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        fundingAwardId: "77777777-7777-4777-8777-777777777777",
        invoiceNumber: "OP-2026-002",
        amount: 5000,
      })
    );

    expect(response.status).toBe(201);
    expect(billingInvoicesInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "11111111-1111-4111-8111-111111111111",
        funding_award_id: "77777777-7777-4777-8777-777777777777",
      })
    );
  });
});
