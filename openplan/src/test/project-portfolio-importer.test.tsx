import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPortfolioImporter } from "@/components/projects/project-portfolio-importer";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440000";
const SOURCE_ID = "660e8400-e29b-41d4-a716-446655440000";
const ORIGINAL_ID = "770e8400-e29b-41d4-a716-446655440000";
const PREVIEW_HASH = "a".repeat(64);

function review(decisions: { clean: "skip" | "create"; warning: "skip" | "create"; confirmed?: boolean }) {
  return {
    sourceHash: "b".repeat(64),
    previewHash: PREVIEW_HASH,
    byteLength: 80,
    headers: ["External ID", "Project name", "Place"],
    duplicateHeaders: [],
    rows: [
      {
        rowNumber: 2,
        fingerprint: "c".repeat(64),
        name: "Clean project",
        sourceId: "P-1",
        description: null,
        sourceLocationText: "North district",
        estimatedCost: null,
        planType: "capital_program",
        status: "draft",
        deliveryPhase: "programming",
        decision: decisions.clean,
        confirmNameMatch: false,
        state: "clean",
        canCreate: true,
        errors: [],
        warnings: [],
        matchingProjectIds: [],
        previouslyCreatedProjectId: null,
      },
      {
        rowNumber: 3,
        fingerprint: "d".repeat(64),
        name: "Existing project",
        sourceId: "P-2",
        description: null,
        sourceLocationText: null,
        estimatedCost: null,
        planType: "capital_program",
        status: "draft",
        deliveryPhase: "programming",
        decision: decisions.warning,
        confirmNameMatch: Boolean(decisions.confirmed),
        state: "warning",
        canCreate: decisions.warning === "skip" || Boolean(decisions.confirmed),
        errors: [],
        warnings: [
          {
            code: "name_match",
            message: "A project with this normalized name already exists. This import will never update it.",
          },
          ...(decisions.warning === "create" && !decisions.confirmed
            ? [
                {
                  code: "name_match_confirmation_required",
                  message: "Confirm this row individually.",
                },
              ]
            : []),
        ],
        matchingProjectIds: ["project-existing"],
        previouslyCreatedProjectId: null,
      },
    ],
    counts: {
      rows: 2,
      selectedForCreate:
        (decisions.clean === "create" ? 1 : 0) +
        (decisions.warning === "create" && decisions.confirmed ? 1 : 0),
      skipped: (decisions.clean === "skip" ? 1 : 0) + (decisions.warning === "skip" ? 1 : 0),
      conflicted: 0,
      invalid: 0,
      previouslyCreated: 0,
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

describe("ProjectPortfolioImporter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores, maps, bulk-selects only clean rows, confirms a warning individually, and commits", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("/api/knowledge-base/documents")) {
          requests.push({ url, body: null });
          const original = url.includes("portfolio.xlsx");
          return jsonResponse(
            { document: { id: original ? ORIGINAL_ID : SOURCE_ID, title: original ? "portfolio.xlsx" : "projects.csv" } },
            201
          );
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url, body });
        if (body.mode === "commit") {
          return jsonResponse(
            {
              review: review({ clean: "create", warning: "create", confirmed: true }),
              committed: {
                batchId: "batch-1",
                created: 2,
                skipped: 0,
                conflicted: 0,
                invalid: 0,
                previouslyCreated: 0,
                projectIds: ["project-new-1", "project-new-2"],
              },
            },
            201
          );
        }
        const rowReviews = body.rowReviews as Array<Record<string, unknown>>;
        const clean = rowReviews.find((row) => row.rowNumber === 2)?.decision === "create" ? "create" : "skip";
        const warningReview = rowReviews.find((row) => row.rowNumber === 3);
        const warning = warningReview?.decision === "create" ? "create" : "skip";
        return jsonResponse({
          source: { id: SOURCE_ID, filename: "projects.csv", originalWorkbook: null },
          review: review({ clean, warning, confirmed: Boolean(warningReview?.confirmNameMatch) }),
        });
      })
    );

    render(
      <ProjectPortfolioImporter
        workspaceId={WORKSPACE_ID}
        recentImports={[]}
        historyReadFailed={false}
      />
    );

    const file = new File(
      ["External ID,Project name,Place\nP-1,Clean project,North district"],
      "projects.csv",
      { type: "text/csv" }
    );
    fireEvent.change(screen.getByLabelText(/CSV project list/i), { target: { files: [file] } });
    const workbook = new File(["retained binary workbook"], "portfolio.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(screen.getByLabelText(/Original workbook/i), { target: { files: [workbook] } });
    fireEvent.click(screen.getByRole("button", { name: /Store source and read headers/i }));

    expect(await screen.findByText(/Location text is not verified geography/i)).toBeInTheDocument();
    expect(screen.getByText(/does not set a project place, study area, bounding box, coordinates, or geometry/i)).toBeInTheDocument();
    expect(screen.getByText("Clean project")).toBeInTheDocument();
    expect(screen.getByText("Existing project")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm review" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Project name (required)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Source ID"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Create all clean rows" }));

    expect(screen.getByLabelText("Decision for CSV row 2")).toHaveValue("create");
    expect(screen.getByLabelText("Decision for CSV row 3")).toHaveValue("skip");
    fireEvent.change(screen.getByLabelText("Decision for CSV row 3"), { target: { value: "create" } });
    fireEvent.click(screen.getByLabelText(/Create a separate project despite the name match/i));
    expect(screen.getByRole("button", { name: /Confirm and create/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Review selections" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm and create 2" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Confirm and create 2" }));

    expect(await screen.findByText(/Created 2, skipped 0, conflicted 0, invalid 0/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open created project 1" })).toHaveAttribute(
      "href",
      "/projects/project-new-1"
    );
    expect(refreshMock).toHaveBeenCalled();

    const commitRequest = requests.find((entry) => entry.body?.mode === "commit");
    expect(commitRequest?.body).toMatchObject({
      approvedPreviewHash: PREVIEW_HASH,
      originalWorkbookDocumentId: ORIGINAL_ID,
      mapping: { name: 1, sourceId: 0 },
    });
    const committedReviews = commitRequest?.body?.rowReviews as Array<Record<string, unknown>>;
    expect(committedReviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowNumber: 2, decision: "create" }),
        expect.objectContaining({ rowNumber: 3, decision: "create", confirmNameMatch: true }),
      ])
    );
  });

  it("shows server review errors and an honest history-read failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).startsWith("/api/knowledge-base/documents")) {
          return jsonResponse({ document: { id: SOURCE_ID, title: "bad.csv" } }, 201);
        }
        return jsonResponse({ error: "The CSV has 2,001 project rows." }, 400);
      })
    );

    render(
      <ProjectPortfolioImporter
        workspaceId={WORKSPACE_ID}
        recentImports={[]}
        historyReadFailed
      />
    );
    const file = new File(["Name\nOne"], "bad.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText(/CSV project list/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /Store source and read headers/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("2,001 project rows");
    const history = screen.getByRole("heading", { name: "Recent imports" }).parentElement;
    expect(within(history as HTMLElement).getByText(/Import history could not be read/i)).toBeInTheDocument();
    expect(within(history as HTMLElement).queryByText(/No reviewed portfolio imports/i)).toBeNull();
  });
});
