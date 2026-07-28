import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FundingOpportunityApplicationWorkspace } from "@/components/grants/funding-opportunity-application-workspace";

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const BUDGET_SECTION_ID = "56565656-5656-4656-8656-565656565656";
const ATTACHMENT_ID = "66666666-6666-4666-8666-666666666666";
const KB_DOCUMENT_ID = "77777777-7777-4777-8777-777777777777";
const REPORT_ARTIFACT_ID = "88888888-8888-4888-8888-888888888888";
const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type FetchCall = { url: string; method: string; body: unknown };

const fetchMock = vi.fn();

function recordedCalls(): FetchCall[] {
  return fetchMock.mock.calls.map((call) => {
    const [url, init] = call as [string, RequestInit | undefined];
    return {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
  });
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function sectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SECTION_ID,
    workspace_id: WORKSPACE_ID,
    opportunity_id: OPPORTUNITY_ID,
    section_key: "project-narrative",
    title: "Project description and scope",
    guidance: "Verify against the current call.",
    sort_order: 0,
    source: "catalog",
    suggested_evidence: ["project", "kb"],
    ai_drafting_enabled: true,
    status: "drafting",
    final_markdown: null,
    finalized_from_draft_id: null,
    updated_by: null,
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

function budgetSectionRow(overrides: Record<string, unknown> = {}) {
  return sectionRow({
    id: BUDGET_SECTION_ID,
    section_key: "budget-narrative",
    title: "Budget and cost estimate",
    sort_order: 1,
    ai_drafting_enabled: false,
    status: "not_started",
    ...overrides,
  });
}

function attachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACHMENT_ID,
    workspace_id: WORKSPACE_ID,
    opportunity_id: OPPORTUNITY_ID,
    attachment_key: "letters-of-support",
    title: "Letters of support",
    guidance: null,
    required: true,
    status: "missing",
    kb_document_id: null,
    report_artifact_id: null,
    note: null,
    sort_order: 0,
    updated_by: null,
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

function applicationPayload(overrides: Record<string, unknown> = {}) {
  return {
    sections: [sectionRow(), budgetSectionRow()],
    attachments: [attachmentRow()],
    schemaPending: false,
    latestDraftsBySectionId: {},
    latestDraftsUnavailable: false,
    kbDocumentOptions: [{ id: KB_DOCUMENT_ID, title: "Adopted active transportation plan" }],
    reportArtifactOptions: [
      {
        id: REPORT_ARTIFACT_ID,
        reportTitle: "Corridor evidence packet",
        artifactKind: "pdf",
        generatedAt: "2026-07-20T00:00:00.000Z",
      },
    ],
    attachSourcesDegraded: false,
    ...overrides,
  };
}

async function openWorkspace(getPayload: Record<string, unknown>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      return jsonResponse(200, getPayload);
    }
    throw new Error(`Unexpected fetch: ${init?.method} ${url}`);
  });

  render(<FundingOpportunityApplicationWorkspace opportunityId={OPPORTUNITY_ID} />);
  fireEvent.click(screen.getByRole("button", { name: /open application workspace/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("FundingOpportunityApplicationWorkspace", () => {
  it("offers the init affordance for an empty application and posts the explicit catalog key", async () => {
    await openWorkspace(
      applicationPayload({ sections: [], attachments: [], kbDocumentOptions: [], reportArtifactOptions: [] })
    );

    expect(await screen.findByTestId("application-init")).toBeInTheDocument();

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse(201, { sections: [sectionRow()], attachments: [attachmentRow()] });
      }
      return jsonResponse(200, applicationPayload());
    });

    fireEvent.change(screen.getByLabelText("Application template"), { target: { value: "atp" } });
    fireEvent.click(screen.getByRole("button", { name: /initialize application/i }));

    await waitFor(() =>
      expect(screen.getByTestId("application-section-project-narrative")).toBeInTheDocument()
    );

    const initCall = recordedCalls().find((call) => call.method === "POST");
    expect(initCall?.url).toBe(`/api/funding-opportunities/${OPPORTUNITY_ID}/application`);
    expect(initCall?.body).toEqual({ catalogKey: "atp" });
  });

  it("speaks the proposal language for a proposal pursuit and hides the grant catalog picker", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return jsonResponse(
          200,
          applicationPayload({ sections: [], attachments: [], kbDocumentOptions: [], reportArtifactOptions: [] })
        );
      }
      throw new Error(`Unexpected fetch: ${init?.method} ${url}`);
    });

    render(
      <FundingOpportunityApplicationWorkspace opportunityId={OPPORTUNITY_ID} pursuitKind="proposal" />
    );
    fireEvent.click(screen.getByRole("button", { name: /open proposal workspace/i }));

    expect(screen.getByText("Proposal workspace")).toBeInTheDocument();
    expect(await screen.findByTestId("application-init")).toBeInTheDocument();
    // Proposals seed from the proposal template — no grant catalog picker.
    expect(screen.queryByLabelText("Application template")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /initialize proposal/i })).toBeInTheDocument();
    expect(screen.getByText(/never AI-drafted/)).toBeInTheDocument();
  });

  it("discloses a pending schema instead of presenting an empty application", async () => {
    await openWorkspace({
      sections: [],
      attachments: [],
      schemaPending: true,
      error: "Apply migration 20260727000014_grant_application_assembly, then retry.",
    });

    expect(
      await screen.findByText(/Apply migration 20260727000014_grant_application_assembly/)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("application-init")).not.toBeInTheDocument();
  });

  it("renders status chips and walks a section through the status flow", async () => {
    await openWorkspace(applicationPayload());

    expect(await screen.findByText("Drafting")).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse(200, { section: sectionRow({ status: "operator_review" }) });
      }
      return jsonResponse(200, applicationPayload());
    });

    // Expand the drafting section and send it to operator review.
    fireEvent.click(screen.getByRole("button", { name: "Project description and scope" }));
    fireEvent.click(screen.getByRole("button", { name: /send to operator review/i }));

    await waitFor(() => expect(screen.getByText("Operator review")).toBeInTheDocument());

    const patchCall = recordedCalls().find((call) => call.method === "PATCH");
    expect(patchCall?.url).toBe(
      `/api/funding-opportunities/${OPPORTUNITY_ID}/sections/${SECTION_ID}`
    );
    expect(patchCall?.body).toEqual({ status: "operator_review" });
  });

  it("shows the never-AI surface for a fee-type section and offers no drafting affordance", async () => {
    await openWorkspace(applicationPayload());

    expect(await screen.findByText("Never AI-drafted")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Budget and cost estimate" }));

    expect(screen.getByTestId("never-ai-note")).toHaveTextContent(/Drafted by you, never by AI/);
    expect(screen.queryByRole("button", { name: /draft with ai/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-draft-panel")).not.toBeInTheDocument();
  });

  it("surfaces the finalize gate refusal with the flagged sentences instead of hiding them", async () => {
    await openWorkspace(
      applicationPayload({
        latestDraftsBySectionId: {
          [SECTION_ID]: {
            id: DRAFT_ID,
            section_id: SECTION_ID,
            draft_markdown: "A claim without citation.",
            model: "claude-opus-4-8",
            grounding_json: null,
            grounded_sentence_count: 0,
            total_sentence_count: 1,
            created_at: "2026-07-27T01:00:00.000Z",
          },
        },
      })
    );

    fireEvent.click(await screen.findByRole("button", { name: "Project description and scope" }));

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse(422, {
          error:
            "This draft cannot be finalized unedited: not every sentence is grounded and faithfulness-checked.",
          flaggedSentences: [
            {
              text: "A claim without citation.",
              reason: "missing_citation",
              unknown_fact_ids: [],
              unfaithful_claims: [],
            },
          ],
        });
      }
      return jsonResponse(200, applicationPayload());
    });

    fireEvent.click(screen.getByRole("button", { name: /finalize ai draft unedited/i }));

    const refusal = await screen.findByTestId("finalize-refusal");
    expect(refusal).toHaveTextContent(/cannot be finalized unedited/);
    expect(refusal).toHaveTextContent("A claim without citation.");
    expect(refusal).toHaveTextContent(/missing citation/);

    const patchCall = recordedCalls().find((call) => call.method === "PATCH");
    expect(patchCall?.body).toEqual({ status: "final", finalizedFromDraftId: DRAFT_ID });
  });

  it("attaches a Knowledge Base document with the round-trip payload and reflects the response", async () => {
    await openWorkspace(applicationPayload());

    await screen.findByTestId("application-attachment-letters-of-support");

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse(200, {
          attachment: attachmentRow({ status: "attached", kb_document_id: KB_DOCUMENT_ID }),
        });
      }
      return jsonResponse(200, applicationPayload());
    });

    fireEvent.change(
      screen.getByLabelText("Attach Knowledge Base document to Letters of support"),
      { target: { value: KB_DOCUMENT_ID } }
    );
    fireEvent.click(screen.getByRole("button", { name: /attach document/i }));

    await waitFor(() => expect(screen.getByText("Attached")).toBeInTheDocument());

    const patchCall = recordedCalls().find((call) => call.method === "PATCH");
    expect(patchCall?.url).toBe(
      `/api/funding-opportunities/${OPPORTUNITY_ID}/attachments/${ATTACHMENT_ID}`
    );
    expect(patchCall?.body).toEqual({ kbDocumentId: KB_DOCUMENT_ID });
  });

  it("attaches a report artifact with the round-trip payload", async () => {
    await openWorkspace(applicationPayload());

    await screen.findByTestId("application-attachment-letters-of-support");

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse(200, {
          attachment: attachmentRow({ status: "attached", report_artifact_id: REPORT_ARTIFACT_ID }),
        });
      }
      return jsonResponse(200, applicationPayload());
    });

    fireEvent.change(screen.getByLabelText("Attach report artifact to Letters of support"), {
      target: { value: REPORT_ARTIFACT_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: /attach report artifact/i }));

    await waitFor(() =>
      expect(recordedCalls().some((call) => call.method === "PATCH")).toBe(true)
    );

    const patchCall = recordedCalls().find((call) => call.method === "PATCH");
    expect(patchCall?.body).toEqual({ reportArtifactId: REPORT_ARTIFACT_ID });
  });

  it("moves the checklist status through the select", async () => {
    await openWorkspace(applicationPayload());

    await screen.findByTestId("application-attachment-letters-of-support");

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse(200, { attachment: attachmentRow({ status: "in_progress" }) });
      }
      return jsonResponse(200, applicationPayload());
    });

    fireEvent.change(screen.getByLabelText("Status for Letters of support"), {
      target: { value: "in_progress" },
    });

    await waitFor(() => expect(screen.getByText("In progress")).toBeInTheDocument());

    const patchCall = recordedCalls().find((call) => call.method === "PATCH");
    expect(patchCall?.body).toEqual({ status: "in_progress" });
  });
});
