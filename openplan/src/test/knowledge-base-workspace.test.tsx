import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeBaseWorkspace } from "@/components/knowledge-base/knowledge-base-workspace";
import type { KbDocumentRow } from "@/lib/knowledge-base/documents";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function doc(over: Partial<KbDocumentRow> = {}): KbDocumentRow {
  return {
    id: "doc-1",
    workspace_id: "ws-1",
    project_id: null,
    title: "2045 RTP",
    doc_kind: "rtp",
    source_kind: "uploaded_pdf",
    original_filename: "rtp.pdf",
    content_type: "application/pdf",
    byte_size: 1_234_567,
    storage_ref: "storage://kb-documents/ws-1/doc-1/rtp.pdf",
    page_count: 12,
    chunk_count: 8,
    char_count: 20_000,
    status: "ready",
    extraction_error: null,
    citation_label: null,
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z",
    ...over,
  };
}

describe("KnowledgeBaseWorkspace", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders existing documents with status and counts", () => {
    render(<KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} />);
    expect(screen.getByText("2045 RTP")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText(/8 chunks/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no documents", () => {
    render(<KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[]} />);
    expect(screen.getByText(/No documents yet/)).toBeInTheDocument();
  });

  it("surfaces a failed document's extraction error honestly", () => {
    render(
      <KnowledgeBaseWorkspace
        workspaceId="ws-1"
        initialDocuments={[
          doc({
            status: "failed",
            chunk_count: 0,
            extraction_error: "No extractable text layer was found.",
          }),
        ]}
      />
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText(/No extractable text layer/)).toBeInTheDocument();
  });

  it("optimistically removes a document on delete", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Delete 2045 RTP/ }));

    await waitFor(() => expect(screen.queryByText("2045 RTP")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/knowledge-base/documents/doc-1", { method: "DELETE" });
  });

  const PROJECTS = [
    { id: "proj-1", name: "Corridor Rehab", status: "active" },
    { id: "proj-2", name: "Bridge Study", status: "active" },
  ];

  it("selecting a project filters the list and attaches subsequent uploads to it", async () => {
    const filteredDoc = doc({ id: "doc-2", title: "Corridor comment letter", project_id: "proj-1" });
    const uploadedDoc = doc({ id: "doc-3", title: "Corridor NOFO", project_id: "proj-1" });
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ document: uploadedDoc }) };
      }
      return { ok: true, json: async () => ({ documents: [filteredDoc] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} projects={PROJECTS} />
    );

    // Filter round-trip: choosing a project refetches with projectId and
    // narrows the list to that project's documents.
    fireEvent.change(screen.getByLabelText("Project for Knowledge Base documents"), {
      target: { value: "proj-1" },
    });
    await waitFor(() => expect(screen.getByText("Corridor comment letter")).toBeInTheDocument());
    expect(screen.queryByText("2045 RTP")).not.toBeInTheDocument();
    const listUrl = String(fetchMock.mock.calls[0][0]);
    expect(listUrl).toContain("/api/knowledge-base/documents?");
    expect(listUrl).toContain("projectId=proj-1");
    expect(screen.getByText(/1 document linked to Corridor Rehab/)).toBeInTheDocument();

    // Upload round-trip: the payload carries the selected projectId.
    const file = new File(["hello"], "nofo.pdf", { type: "application/pdf" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("Corridor NOFO")).toBeInTheDocument());
    const uploadCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    expect(uploadCall).toBeDefined();
    expect(String(uploadCall?.[0])).toContain("projectId=proj-1");
  });

  it("shows a project chip linking to the project on attached document rows", () => {
    render(
      <KnowledgeBaseWorkspace
        workspaceId="ws-1"
        initialDocuments={[doc({ project_id: "proj-2" })]}
        projects={PROJECTS}
      />
    );
    const chip = screen.getByRole("link", { name: /Open project Bridge Study/ });
    expect(chip).toHaveAttribute("href", "/projects/proj-2");
  });

  it("keeps a filtered empty list honest about other workspace documents", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ documents: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} projects={PROJECTS} />
    );
    fireEvent.change(screen.getByLabelText("Project for Knowledge Base documents"), {
      target: { value: "proj-2" },
    });

    await waitFor(() =>
      expect(screen.getByText(/No documents are attached to this project yet/)).toBeInTheDocument()
    );
    expect(screen.getByText(/Other workspace documents may still exist/)).toBeInTheDocument();
  });

  it("starts filtered when an initial project id is provided", () => {
    render(
      <KnowledgeBaseWorkspace
        workspaceId="ws-1"
        initialDocuments={[doc({ project_id: "proj-1" })]}
        projects={PROJECTS}
        initialProjectId="proj-1"
      />
    );
    expect(screen.getByLabelText("Project for Knowledge Base documents")).toHaveValue("proj-1");
    expect(screen.getByText(/1 document linked to Corridor Rehab/)).toBeInTheDocument();
  });
});
