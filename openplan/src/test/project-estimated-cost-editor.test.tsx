import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectEstimatedCostEditor } from "@/components/projects/project-estimated-cost-editor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("ProjectEstimatedCostEditor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("labels project cost as distinct and sends the selected source", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ project: { id: "p1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ProjectEstimatedCostEditor
        project={{
          id: "33333333-3333-4333-8333-333333333333",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          estimated_cost_amount: null,
          estimated_cost_currency: null,
          estimated_cost_basis_year: null,
          estimated_cost_source_document_id: null,
        }}
        canWrite
        documents={[{
          sourceId: "knowledge_base",
          id: "22222222-2222-4222-8222-222222222222",
          title: "projects.csv",
          projectId: "33333333-3333-4333-8333-333333333333",
        }]}
      />
    );

    expect(screen.getByText(/separate from the project-management budget/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Planning-level estimated project cost/i }).closest("article")).toHaveClass("min-w-0", "max-w-full");
    expect(screen.getByLabelText(/Project candidates CSV/i)).toHaveClass("min-w-0", "max-w-full");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1200000" } });
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "CAD" } });
    fireEvent.change(screen.getByLabelText(/Price year/i), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText(/Source document/i), { target: { value: "22222222-2222-4222-8222-222222222222" } });
    fireEvent.click(screen.getByRole("button", { name: "Save estimated cost" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      estimatedCost: {
        amount: 1_200_000,
        currency: "CAD",
        basisYear: 2026,
        sourceDocumentId: "22222222-2222-4222-8222-222222222222",
      },
    });
  });

  it("stores a CSV, reviews one candidate, and applies its identity, cost, and source together", async () => {
    const documentId = "22222222-2222-4222-8222-222222222222";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input).startsWith("/api/knowledge-base/documents?")
      ? new Response(JSON.stringify({ document: { id: documentId, title: "projects.csv" } }), { status: 201 })
      : new Response(JSON.stringify({ project: { id: "33333333-3333-4333-8333-333333333333" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ProjectEstimatedCostEditor
        project={{
          id: "33333333-3333-4333-8333-333333333333",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          estimated_cost_amount: null,
          estimated_cost_currency: null,
          estimated_cost_basis_year: null,
          estimated_cost_source_document_id: null,
        }}
        canWrite
        documents={[]}
      />
    );

    const csv = [
      "name,description,cost_usd,phase",
      'Example Corridor Complete Street,"Sidewalks, lighting and crossings",4200000,planning',
      "Example Signal Upgrade,Replace four signals,1150000,design",
    ].join("\n");
    const file = new File([csv], "projects.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    fireEvent.change(screen.getByLabelText(/Project candidates CSV/i), { target: { files: [file] } });

    await screen.findByText(/stored and indexed/i);
    expect(screen.getByRole("cell", { name: "Example Corridor Complete Street" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Use this candidate/i })[0]);
    expect(screen.getByLabelText("Amount")).toHaveValue("4200000");
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
    fireEvent.click(screen.getByRole("button", { name: /Apply selected project/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [uploadUrl, uploadRequest] = fetchMock.mock.calls[0];
    expect(uploadUrl).toContain("workspaceId=11111111-1111-4111-8111-111111111111");
    expect(uploadRequest?.body).toBe(file);
    const patchRequest = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(patchRequest.body))).toEqual({
      name: "Example Corridor Complete Street",
      summary: "Sidewalks, lighting and crossings",
      estimatedCost: {
        amount: 4_200_000,
        currency: "USD",
        basisYear: null,
        sourceDocumentId: documentId,
      },
    });
  });
});
