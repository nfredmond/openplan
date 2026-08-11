import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KnowledgeBaseWorkspace,
  type DocumentLibraryView,
} from "@/components/knowledge-base/knowledge-base-workspace";
import type { KbDocumentRow } from "@/lib/knowledge-base/documents";
import type { DocumentLibraryEntry } from "@/lib/document-library/types";

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
    extraction_source: "text_layer",
    citation_label: null,
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z",
    ...over,
  };
}

function libraryEntry(over: Partial<DocumentLibraryEntry> = {}): DocumentLibraryEntry {
  return {
    sourceId: "report_artifacts",
    id: "art-1",
    title: "Corridor Board Packet",
    projectId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    byteSize: 2_000_000,
    hasBytes: true,
    downloadHref: "/api/reports/rep-1/artifacts/art-1/download",
    badge: { label: "PDF", tone: "neutral" },
    detail: null,
    groundable: false,
    ...over,
  };
}

function libraryView(over: Partial<DocumentLibraryView> = {}): DocumentLibraryView {
  return {
    entries: [libraryEntry()],
    perSource: {
      knowledge_base: { count: 0, pending: false, failed: false },
      report_artifacts: { count: 1, pending: false, failed: false },
    },
    limitPerSource: 20,
    sourceLabels: { knowledge_base: "Knowledge Base", report_artifacts: "Reports" },
    readFailureSummary: null,
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

  /**
   * A count is a claim about the planner's corpus. These two cases are the ways
   * this screen used to make one out of a read that never produced rows — the
   * section header stating "0 documents in this workspace" directly above the
   * paragraph admitting the list could not be read, and a failed project
   * refetch relabelling the previous workspace-wide list as a project's.
   */
  describe("a failed document read never becomes a count", () => {
    it("states that the list could not be read instead of counting zero", () => {
      render(
        <KnowledgeBaseWorkspace
          workspaceId="ws-1"
          initialDocuments={[]}
          readFailures={{ documents: true, projects: false }}
        />
      );

      expect(screen.queryByText(/\d+ documents? in this workspace/)).not.toBeInTheDocument();
      expect(
        screen.getByText(/could not be read, so this screen cannot say how many documents/)
      ).toBeInTheDocument();
      // The disclosure that was already there must survive alongside it.
      expect(screen.getByText(/do not re-upload on the strength of this screen/)).toBeInTheDocument();
      expect(screen.queryByText(/No documents yet/)).not.toBeInTheDocument();
    });

    it("does not relabel the previous workspace list as the project it failed to read", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Failed to load documents", hint: "permission denied" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      render(
        <KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} projects={PROJECTS} />
      );
      expect(screen.getByText(/1 document in this workspace/)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Project for Knowledge Base documents"), {
        target: { value: "proj-1" },
      });

      // Settle on the failure the planner is shown either way, so the two
      // assertions that follow are about what the screen SAYS, not about timing.
      await waitFor(() => expect(screen.getByText(/permission denied/)).toBeInTheDocument());

      // The old false claims, both gone: the count, and the workspace-wide row
      // presented as something linked to a project it was never read for.
      expect(screen.queryByText(/\d+ documents? linked to Corridor Rehab/)).not.toBeInTheDocument();
      expect(screen.queryByText("2045 RTP")).not.toBeInTheDocument();

      expect(
        screen.getByText(
          /The list of documents linked to Corridor Rehab could not be read, so this screen cannot say how many there are/
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(/could not be read, so it is not shown\. This does not mean none are linked/)
      ).toBeInTheDocument();
    });

    it("keeps the search coverage caveat honest after a failed refetch", async () => {
      // The documents read fails; the search RPC behind /search succeeds and
      // matches nothing. Emptying the list must not quietly turn "we could not
      // read your corpus" into "every document you have was searched".
      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).startsWith("/api/knowledge-base/search")) {
          return { ok: true, json: async () => ({ excerpts: [] }) };
        }
        return { ok: false, json: async () => ({ error: "Failed to load documents" }) };
      });
      vi.stubGlobal("fetch", fetchMock);

      render(
        <KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[doc()]} projects={PROJECTS} />
      );
      fireEvent.change(screen.getByLabelText("Project for Knowledge Base documents"), {
        target: { value: "proj-2" },
      });
      await waitFor(() =>
        expect(screen.getByText(/could not be read, so this screen cannot say/)).toBeInTheDocument()
      );

      fireEvent.change(screen.getByLabelText("Search the Knowledge Base"), {
        target: { value: "bridge scour" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Search/ }));

      await waitFor(() =>
        expect(screen.getByText(/No passage in the searched documents matched/)).toBeInTheDocument()
      );
      expect(
        screen.getByText(/cannot say how many of your documents were searchable/)
      ).toBeInTheDocument();
    });
  });

  describe("stored documents and downloads", () => {
    it("shows a stored row with the honest not-citable sentence, never 'processing'", () => {
      render(
        <KnowledgeBaseWorkspace
          workspaceId="ws-1"
          initialDocuments={[
            doc({
              status: "stored",
              source_kind: "uploaded_image",
              original_filename: "site-photo.jpg",
              chunk_count: 0,
              extraction_source: "none",
            }),
          ]}
        />
      );
      expect(screen.getByText("stored")).toBeInTheDocument();
      expect(
        screen.getByText(/OpenPlan did not index text from this file, so it cannot be cited yet/)
      ).toBeInTheDocument();
      expect(screen.queryByText(/processing/i)).not.toBeInTheDocument();
    });

    it("links the download route for rows with a stored file, and not for pasted text", () => {
      render(
        <KnowledgeBaseWorkspace
          workspaceId="ws-1"
          initialDocuments={[
            doc({ id: "doc-file", title: "Uploaded plan" }),
            doc({
              id: "doc-paste",
              title: "Pasted memo",
              source_kind: "pasted_text",
              original_filename: null,
              storage_ref: null,
            }),
          ]}
        />
      );
      expect(screen.getByRole("link", { name: "Download Uploaded plan" })).toHaveAttribute(
        "href",
        "/api/knowledge-base/documents/doc-file/download"
      );
      expect(screen.queryByRole("link", { name: "Download Pasted memo" })).not.toBeInTheDocument();
    });

    it("refuses an oversize file against THIS deployment's ceiling, before any request", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      render(
        <KnowledgeBaseWorkspace
          workspaceId="ws-1"
          initialDocuments={[]}
          maxUploadBytes={1024 * 1024}
        />
      );

      const file = new File([new ArrayBuffer(2 * 1024 * 1024)], "big.pdf", {
        type: "application/pdf",
      });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, { target: { files: [file] } });

      // The refusal names the ceiling it was actually given, not a hardcoded 25.
      await waitFor(() =>
        expect(screen.getByText(/1 MiB per-file ceiling/)).toBeInTheDocument()
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("the Document Library section", () => {
    it("labels the merged ordering with the per-source cap it was read with", () => {
      render(
        <KnowledgeBaseWorkspace
          workspaceId="ws-1"
          initialDocuments={[]}
          library={libraryView({ limitPerSource: 7 })}
        />
      );
      // The binding, not a fixed string: the caption carries the actual cap…
      expect(
        screen.getByText(/up to the 7 most recent files from each source/)
      ).toBeInTheDocument();
      // …and never presents itself as a global sort.
      expect(screen.getByText(/grouped by source, not sorted across them/)).toBeInTheDocument();
    });

    it("renders entries with their source label and the owning module's download route", () => {
      render(
        <KnowledgeBaseWorkspace workspaceId="ws-1" initialDocuments={[]} library={libraryView()} />
      );
      expect(screen.getByText("Corridor Board Packet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Download Corridor Board Packet" })).toHaveAttribute(
        "href",
        "/api/reports/rep-1/artifacts/art-1/download"
      );
    });

    it("renders an unopenable entry (failed custody) with its reason and NO link", () => {
      render(
        <KnowledgeBaseWorkspace
          workspaceId="ws-1"
          initialDocuments={[]}
          library={libraryView({
            entries: [
              libraryEntry({
                sourceId: "aerial_artifact_custody",
                id: "cust-1",
                title: "Orthomosaic — Bridge Survey",
                hasBytes: false,
                downloadHref: null,
                badge: { label: "Custody failed", tone: "critical" },
                detail: "The processing provider's file could not be retrieved.",
              }),
            ],
            perSource: { aerial_artifact_custody: { count: 1, pending: false, failed: false } },
            sourceLabels: { aerial_artifact_custody: "Aerial deliverables" },
          })}
        />
      );
      expect(screen.getByText("Custody failed")).toBeInTheDocument();
      expect(
        screen.getByText(/The processing provider's file could not be retrieved/)
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /Orthomosaic — Bridge Survey/ })
      ).not.toBeInTheDocument();
    });

    it("filters by source chip and by citable-only", () => {
      const kbEntry = libraryEntry({
        sourceId: "knowledge_base",
        id: "doc-9",
        title: "Adopted 2045 RTP",
        downloadHref: "/api/knowledge-base/documents/doc-9/download",
        badge: { label: "Citable", tone: "positive" },
        groundable: true,
      });
      render(
        <KnowledgeBaseWorkspace
          workspaceId="ws-1"
          initialDocuments={[]}
          library={libraryView({
            entries: [kbEntry, libraryEntry()],
            perSource: {
              knowledge_base: { count: 1, pending: false, failed: false },
              report_artifacts: { count: 1, pending: false, failed: false },
            },
          })}
        />
      );
      expect(screen.getByText("Adopted 2045 RTP")).toBeInTheDocument();
      expect(screen.getByText("Corridor Board Packet")).toBeInTheDocument();

      // Chips carry per-source counts and narrow the list to the clicked source.
      fireEvent.click(screen.getByRole("button", { name: "Reports (1)" }));
      expect(screen.queryByText("Adopted 2045 RTP")).not.toBeInTheDocument();
      expect(screen.getByText("Corridor Board Packet")).toBeInTheDocument();

      // Clicking the only active chip returns to all sources…
      fireEvent.click(screen.getByRole("button", { name: "Reports (1)" }));
      expect(screen.getByText("Adopted 2045 RTP")).toBeInTheDocument();

      // …and citable-only keeps just the entries the grounding contract can cite.
      fireEvent.click(screen.getByLabelText(/Citable only/));
      expect(screen.getByText("Adopted 2045 RTP")).toBeInTheDocument();
      expect(screen.queryByText("Corridor Board Packet")).not.toBeInTheDocument();
    });

    it("discloses failed source reads and refuses to call an unreadable shelf empty", () => {
      render(
        <KnowledgeBaseWorkspace
          workspaceId="ws-1"
          initialDocuments={[]}
          library={libraryView({
            entries: [],
            perSource: { report_artifacts: { count: 0, pending: false, failed: true } },
            readFailureSummary:
              "This page could not read report files. Anything below that depends on it is shown as unavailable rather than as zero — an empty list here would not mean the records are absent.",
          })}
        />
      );
      expect(screen.getByText(/could not read report files/)).toBeInTheDocument();
      // A failed lane's chip claims no count.
      expect(screen.getByRole("button", { name: "Reports (unavailable)" })).toBeInTheDocument();
      expect(
        screen.getByText(/not a statement about what the workspace holds/)
      ).toBeInTheDocument();
      expect(screen.queryByText(/No files yet\./)).not.toBeInTheDocument();
    });

    it("names sources that are behind a migration instead of listing them as empty", () => {
      render(
        <KnowledgeBaseWorkspace
          workspaceId="ws-1"
          initialDocuments={[]}
          library={libraryView({
            entries: [],
            perSource: {
              aerial_imagery: { count: 0, pending: true, failed: false },
            },
            sourceLabels: { aerial_imagery: "Aerial imagery" },
          })}
        />
      );
      expect(screen.getByText(/behind a database migration/)).toBeInTheDocument();
      expect(screen.getByText(/Aerial imagery:/)).toBeInTheDocument();
    });

    it("keeps the library's loaded scope honest when the project selector moves on without it", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ documents: [] }) });
      vi.stubGlobal("fetch", fetchMock);
      render(
        <KnowledgeBaseWorkspace
          workspaceId="ws-1"
          initialDocuments={[]}
          projects={PROJECTS}
          library={libraryView()}
        />
      );
      // Loaded workspace-wide; no stale note yet.
      expect(screen.queryByText(/does not follow the project selector/)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Project for Knowledge Base documents"), {
        target: { value: "proj-1" },
      });

      // The library did NOT refetch — instead of relabelling itself it says so
      // and offers the reload that would actually rescope it.
      await waitFor(() =>
        expect(screen.getByText(/does not follow the project selector/)).toBeInTheDocument()
      );
      const reload = screen.getByRole("link", { name: /Reload it for Corridor Rehab/ });
      expect(reload).toHaveAttribute("href", "/knowledge-base?projectId=proj-1");
    });
  });
});
