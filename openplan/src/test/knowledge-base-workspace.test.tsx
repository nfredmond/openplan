import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeBaseWorkspace } from "@/components/knowledge-base/knowledge-base-workspace";
import type { KbDocumentRow } from "@/lib/knowledge-base/documents";

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
});
