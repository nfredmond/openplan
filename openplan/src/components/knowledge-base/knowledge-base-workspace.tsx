"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, FolderKanban, Loader2, ScanText, Search, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/lib/ui/status";
import { KB_DOC_KINDS, type KbDocKind, type KbDocumentStatus } from "@/lib/knowledge-base/types";
import {
  DEFAULT_KB_DOCUMENT_MAX_BYTES,
  KB_STORED_DOCUMENT_NOTICE,
  type KbDocumentRow,
} from "@/lib/knowledge-base/documents";
import { excerptPageLabel, type KnowledgeBaseExcerpt } from "@/lib/knowledge-base/retrieval";
import {
  describeUnreadableDocument,
  documentCanBeOcred,
  KB_OCR_PROVENANCE_NOTICE,
} from "@/lib/knowledge-base/ocr-availability";
import {
  describeDocumentLibraryOrdering,
  DOCUMENT_LIBRARY_SOURCE_IDS,
  type DocumentLibraryBadgeTone,
  type DocumentLibraryEntry,
  type DocumentLibrarySourceId,
  type DocumentSourceOutcome,
} from "@/lib/document-library/types";

const DOC_KIND_LABELS: Record<KbDocKind, string> = {
  rtp: "Regional Transportation Plan",
  comment_letter: "Comment letter",
  prior_study: "Prior study",
  nofo: "Grant notice (NOFO)",
  staff_report: "Staff report",
  policy: "Policy / guidance",
  drawing: "Drawing / plan sheet",
  exhibit: "Exhibit / map",
  other: "Other",
};

/**
 * The file picker's suggestion list — the server's accept lists in
 * `knowledge-base/extract.ts` remain the authority (the upload route refuses
 * what they refuse), this only pre-filters the dialog. First the indexed
 * formats, then the stored-for-reference ones.
 */
const ACCEPTED_EXTENSIONS =
  ".pdf,.docx,.txt,.md,.markdown" +
  ",.jpg,.jpeg,.png,.tif,.tiff,.csv,.xlsx,.xls,.ods,.dwg,.dxf,.pptx,.ppt,.doc,.rtf,.odt,.odp";
/** How many passages one search asks for. The RPC caps at 25. */
const SEARCH_LIMIT = 10;

/**
 * The four outcomes of a search, kept apart on purpose. A failed read and a
 * successful read that matched nothing are DIFFERENT FACTS, and only the
 * second one may be shown as "nothing matched" — that is a claim about the
 * planner's own corpus.
 */
type KbSearchState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; query: string; scopeProjectId: string; hits: KnowledgeBaseExcerpt[] }
  | { status: "failed"; query: string; message: string };

/**
 * WHERE the list currently in `documents` came from, and whether the read that
 * produced it succeeded — kept apart from the rows themselves for the same
 * reason as above.
 *
 * "12 documents" is a count of the planner's corpus and "linked to Corridor
 * Rehab" is a claim about what a project holds. Neither may be assembled from a
 * read that failed. Two ways they were before: the page's own `kb_documents`
 * read failing rendered "0 documents in this workspace" directly above the
 * paragraph saying the list could not be read; and a failed project refetch
 * kept the PREVIOUS workspace-wide rows on screen and relabelled them
 * "N documents linked to <Project>" — a count and a scope, both invented.
 */
type KbDocumentListState =
  | { status: "loaded"; scopeProjectId: string }
  | { status: "failed"; scopeProjectId: string };

function statusTone(status: KbDocumentStatus): StatusTone {
  switch (status) {
    case "ready":
      return "success";
    case "failed":
      return "danger";
    case "pending":
    case "extracting":
      return "warning";
    // "stored" lands in the default arm on purpose: kept by design, neither a
    // success to celebrate nor a failure to flag.
    default:
      return "neutral";
  }
}

/** Library badge tones (Lane B's vocabulary) mapped onto the app's StatusBadge tones. */
function libraryBadgeTone(tone: DocumentLibraryBadgeTone): StatusTone {
  switch (tone) {
    case "positive":
      return "success";
    case "warning":
      return "warning";
    case "critical":
      return "danger";
    default:
      return "neutral";
  }
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

export type KnowledgeBaseProjectOption = {
  id: string;
  name: string;
  status: string;
};

/**
 * The Document Library lane, serialized by the page: `ReadFailureLog` is a
 * class and cannot cross the server/client boundary, so the page sends its
 * `describe()` sentence and the per-source outcomes instead. Everything here
 * came from `loadDocumentLibrary` — the component only renders it and never
 * reads or writes anything on its own.
 */
export type DocumentLibraryView = {
  entries: DocumentLibraryEntry[];
  perSource: Partial<Record<DocumentLibrarySourceId, DocumentSourceOutcome>>;
  limitPerSource: number;
  sourceLabels: Partial<Record<DocumentLibrarySourceId, string>>;
  /** `reads.describe()` — null when every source read cleanly. */
  readFailureSummary: string | null;
};

type KnowledgeBaseWorkspaceProps = {
  workspaceId: string;
  initialDocuments: KbDocumentRow[];
  /** The workspace's projects, powering attach-on-upload and the list filter. */
  projects?: KnowledgeBaseProjectOption[];
  /** Deep-link filter (?projectId=), pre-validated against `projects` by the page. */
  initialProjectId?: string | null;
  /**
   * Which of the page's reads failed. Without this the list cannot tell an empty
   * corpus from an unreadable one, and says the first.
   */
  readFailures?: { documents: boolean; projects: boolean };
  /**
   * This deployment's per-file ceiling, resolved by the page from
   * OPENPLAN_KB_DOCUMENT_MAX_BYTES. The server enforces it either way; this
   * only lets the pre-flight check and the copy tell the truth about it.
   */
  maxUploadBytes?: number;
  /** The cross-module file index. Absent = the page did not load it (older callers). */
  library?: DocumentLibraryView | null;
  /**
   * Whether this deployment has an OCR service, resolved by the page from
   * OPENPLAN_KB_OCR_WORKER_URL + _TOKEN (server-only env vars that must never
   * reach a browser bundle — hence a prop, not a read).
   *
   * This decides which honest sentence a scanned document gets, so it defaults
   * to FALSE: a caller that forgot to pass it under-promises rather than
   * offering a button that answers 501.
   */
  ocrConfigured?: boolean;
};

export function KnowledgeBaseWorkspace({
  workspaceId,
  initialDocuments,
  projects = [],
  initialProjectId = null,
  readFailures = { documents: false, projects: false },
  maxUploadBytes = DEFAULT_KB_DOCUMENT_MAX_BYTES,
  library = null,
  ocrConfigured = false,
}: KnowledgeBaseWorkspaceProps) {
  const [documents, setDocuments] = useState<KbDocumentRow[]>(initialDocuments);
  const [documentList, setDocumentList] = useState<KbDocumentListState>(() => ({
    status: readFailures.documents ? "failed" : "loaded",
    scopeProjectId: initialProjectId ?? "",
  }));
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [docKind, setDocKind] = useState<KbDocKind>("other");
  const [title, setTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  // One selector, two duties: new uploads attach to this project, and the
  // document list narrows to it. "" means no attachment and no filter.
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<KbSearchState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Which document's OCR request is in flight, so only its own button spins. */
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null);
  // Library filters: null = every source; the set = only the chips toggled on.
  const [activeSources, setActiveSources] = useState<ReadonlySet<DocumentLibrarySourceId> | null>(
    null
  );
  const [citableOnly, setCitableOnly] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maxUploadMiB = Math.floor(maxUploadBytes / (1024 * 1024));

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );
  const selectedProjectName = projectId ? projectNameById.get(projectId) ?? null : null;
  // The scope the ROWS belong to, which is not always the scope the selector
  // shows: a failed refetch leaves the selector on the project the planner
  // picked while the list itself was never read for it.
  const listScopeName = documentList.scopeProjectId
    ? projectNameById.get(documentList.scopeProjectId) ?? "the selected project"
    : null;

  // Only `ready` documents are indexed by the search RPC. A planner reading
  // "nothing matched" is owed the fact that some of their corpus was never
  // looked at — otherwise an extraction failure reads as an absent passage.
  const unsearchableCount = documents.filter((entry) => entry.status !== "ready").length;

  /**
   * What the search could NOT look at. This is owed to the planner on BOTH
   * outcomes, not just the empty one: "3 passages matched" reads as the whole
   * answer, so a corpus with documents that never finished extracting turns a
   * partial result into an apparently complete one. Same fact, same sentence,
   * whether or not anything matched.
   */
  const coverageCaveat = documentList.status === "failed"
    ? "The document list could not be read, so this screen cannot say how many of your documents were searchable."
    : unsearchableCount > 0
      ? `${unsearchableCount} of the ${documents.length} document${documents.length === 1 ? "" : "s"} listed below ${unsearchableCount === 1 ? "is" : "are"} not indexed yet (only documents with status "ready" are searched).`
      : "";

  function upsertDocument(document: KbDocumentRow) {
    setDocuments((prev) => [document, ...prev.filter((entry) => entry.id !== document.id)]);
  }

  async function changeProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    setError(null);
    setNotice(null);
    setListLoading(true);
    try {
      // Refetch instead of filtering the loaded page client-side: the initial
      // list is capped at 200 workspace-wide, so a client-side filter could
      // silently miss a project's older documents.
      const params = new URLSearchParams({ workspaceId });
      if (nextProjectId) params.set("projectId", nextProjectId);
      const response = await fetch(`/api/knowledge-base/documents?${params.toString()}`);
      const payload = (await response.json()) as {
        documents?: KbDocumentRow[];
        error?: string;
        hint?: string;
      };
      if (!response.ok) {
        throw new Error(
          [payload.error, payload.hint].filter(Boolean).join(" — ") || "Failed to load documents"
        );
      }
      setDocuments(payload.documents ?? []);
      setDocumentList({ status: "loaded", scopeProjectId: nextProjectId });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load documents");
      // The rows on screen belong to the scope the planner just LEFT. Keeping
      // them would restate them as this project's documents — a count and a
      // link for a project whose list was never read. Drop them and say so.
      setDocuments([]);
      setDocumentList({ status: "failed", scopeProjectId: nextProjectId });
    } finally {
      setListLoading(false);
    }
  }

  /**
   * Ask the OCR service to read a scanned document.
   *
   * The row is left as it is on success: OCR of a long scan takes minutes, and
   * flipping the badge to "ready" here would be this screen asserting an
   * outcome nothing has reported yet. The notice says what was started, and the
   * list is refreshed when the planner comes back to it.
   */
  async function requestOcr(documentId: string, documentTitle: string) {
    setOcrBusyId(documentId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/knowledge-base/documents/${documentId}/ocr`, {
        method: "POST",
      });
      const payload = (await response.json()) as { detail?: string; error?: string };
      if (!response.ok) {
        throw new Error(
          payload.detail || payload.error || "The request to read this document was not accepted"
        );
      }
      setNotice(
        payload.detail ??
          `OCR started for “${documentTitle}”. Reading a long scan can take many minutes.`
      );
    } catch (ocrError) {
      setError(
        ocrError instanceof Error
          ? ocrError.message
          : "The request to read this document was not accepted"
      );
    } finally {
      setOcrBusyId(null);
    }
  }

  async function runSearch() {
    const query = searchInput.replace(/\s+/g, " ").trim();
    if (!query) {
      setSearch({ status: "idle" });
      return;
    }
    const scopeProjectId = projectId;
    setSearch({ status: "running" });
    try {
      const params = new URLSearchParams({ workspaceId, q: query, limit: String(SEARCH_LIMIT) });
      if (scopeProjectId) params.set("projectId", scopeProjectId);
      const response = await fetch(`/api/knowledge-base/search?${params.toString()}`);
      const payload = (await response.json()) as {
        excerpts?: KnowledgeBaseExcerpt[];
        error?: string;
        hint?: string;
      };
      if (!response.ok) {
        throw new Error(
          [payload.error, payload.hint].filter(Boolean).join(" — ") || "The search could not be run"
        );
      }
      // Only a response the server actually answered 2xx to may become a
      // statement about the corpus. `?? []` here is the parsed body of a
      // successful read, never a swallowed failure.
      setSearch({ status: "done", query, scopeProjectId, hits: payload.excerpts ?? [] });
    } catch (searchError) {
      setSearch({
        status: "failed",
        query,
        message:
          searchError instanceof Error ? searchError.message : "The search could not be run",
      });
    }
  }

  async function uploadFile(file: File) {
    if (file.size > maxUploadBytes) {
      setError(
        `That file is larger than this deployment's ${maxUploadMiB} MiB per-file ceiling. ` +
          "Whoever operates this deployment can raise it — OpenPlan itself has no usage tiers."
      );
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams({ workspaceId, filename: file.name, docKind });
      if (title.trim()) params.set("title", title.trim());
      if (projectId) params.set("projectId", projectId);
      const response = await fetch(`/api/knowledge-base/documents?${params.toString()}`, {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      const payload = (await response.json()) as {
        document?: KbDocumentRow;
        error?: string;
        hint?: string;
        warning?: string;
        deduped?: boolean;
        stored?: boolean;
        notice?: string;
      };
      if (!response.ok) {
        throw new Error([payload.error, payload.hint].filter(Boolean).join(" — ") || "Upload failed");
      }
      if (payload.document) {
        upsertDocument(payload.document);
        if (payload.stored) {
          // The route's own honest sentence: kept, findable, not citable.
          setNotice(`Kept "${payload.document.title}". ${payload.notice ?? KB_STORED_DOCUMENT_NOTICE}`);
        } else if (payload.warning) {
          setNotice(`Stored "${payload.document.title}", but its text could not be extracted: ${payload.warning}`);
        } else if (payload.deduped) {
          setNotice("That document is already in your library.");
        } else {
          setNotice(`Added "${payload.document.title}".`);
        }
      }
      setTitle("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function savePastedText() {
    if (!title.trim()) {
      setError("Pasted text needs a title.");
      return;
    }
    if (!pasteText.trim()) {
      setError("Paste some text before saving.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/knowledge-base/documents/paste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          title: title.trim(),
          text: pasteText,
          docKind,
          ...(projectId ? { projectId } : {}),
        }),
      });
      const payload = (await response.json()) as { document?: KbDocumentRow; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save text");
      }
      if (payload.document) {
        upsertDocument(payload.document);
        setNotice(`Saved "${payload.document.title}".`);
      }
      setTitle("");
      setPasteText("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save text");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDocument(id: string, docTitle: string) {
    setError(null);
    setNotice(null);
    const previous = documents;
    setDocuments((prev) => prev.filter((entry) => entry.id !== id));
    try {
      const response = await fetch(`/api/knowledge-base/documents/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Failed to delete document");
      }
      setNotice(`Removed "${docTitle}".`);
    } catch (deleteError) {
      setDocuments(previous);
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete document");
    }
  }

  // --- Document Library (cross-module file index) -------------------------
  // Only sources the page actually QUERIED get a chip; an absent perSource key
  // means the caller excluded the source, which is different from zero rows.
  const librarySourceIds = library
    ? DOCUMENT_LIBRARY_SOURCE_IDS.filter((id) => library.perSource[id] !== undefined)
    : [];
  const pendingLibrarySources = librarySourceIds.filter((id) => library?.perSource[id]?.pending);
  const libraryEntries = library?.entries ?? [];
  const filteredLibraryEntries = libraryEntries.filter(
    (entry) =>
      (activeSources === null || activeSources.has(entry.sourceId)) &&
      (!citableOnly || entry.groundable)
  );

  function librarySourceLabel(id: DocumentLibrarySourceId): string {
    return library?.sourceLabels[id] ?? id;
  }

  // The library is loaded SERVER-SIDE with the page's initial project scope.
  // The selector above refetches only the Knowledge Base list, so a changed
  // selection must not relabel the library — it keeps its loaded scope and
  // offers a reload link to the new one instead of a false caption.
  const libraryScopeName = initialProjectId
    ? projectNameById.get(initialProjectId) ?? "the selected project"
    : null;
  const libraryScopeStale = projectId !== (initialProjectId ?? "");

  function toggleLibrarySource(id: DocumentLibrarySourceId) {
    setActiveSources((previous) => {
      // From "all sources" to just the clicked one; clicking the only active
      // chip returns to all — a filter with nothing selected shows everything
      // rather than an empty shelf.
      if (previous === null) return new Set([id]);
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size === 0 ? null : next;
    });
  }

  return (
    <section className="module-page">
      <header className="module-section-header">
        <span className="module-section-label">Library</span>
        <h1 className="module-section-title">Documents</h1>
        <p className="module-section-description">
          Your workspace&apos;s file cabinet. Upload your agency&apos;s own documents — adopted plans,
          comment letters, prior studies, grant notices — so the Planner Agent and Grant Writer can
          ground and cite from them; images, spreadsheets, CAD drawings, and other office files are
          kept for reference and download. Retrieval is keyword-based (screening-grade); scanned,
          image-only PDFs without a text layer are stored but not indexed yet.
        </p>
      </header>

      <div className="module-section-surface">
        <Tabs value={mode} onValueChange={(value) => setMode(value as "upload" | "paste")}>
          <TabsList className="module-tabs-list">
            <TabsTrigger value="upload" className="module-tab-trigger">
              Upload a file
            </TabsTrigger>
            <TabsTrigger value="paste" className="module-tab-trigger">
              Paste text
            </TabsTrigger>
          </TabsList>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="text-foreground/70">Document type</span>
              <select
                className="module-select"
                value={docKind}
                onChange={(event) => setDocKind(event.target.value as KbDocKind)}
                disabled={busy}
              >
                {KB_DOC_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {DOC_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-foreground/70">
                Title {mode === "upload" ? "(optional — defaults to the filename)" : "(required)"}
              </span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. 2045 RTP (Draft)"
                maxLength={200}
                disabled={busy}
              />
            </label>
            {projects.length > 0 ? (
              <label className="grid gap-1 text-sm sm:col-span-2">
                <span className="text-foreground/70">
                  Project (optional — attaches new documents and filters the list below)
                </span>
                <select
                  className="module-select"
                  value={projectId}
                  onChange={(event) => void changeProject(event.target.value)}
                  disabled={busy || listLoading}
                  aria-label="Project for Knowledge Base documents"
                >
                  <option value="">All documents · no project attachment</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : readFailures.projects ? (
              // Disclose, never restrict. When the project read fails the selector
              // cannot be built — but silently dropping it would leave a planner
              // believing this workspace has no projects, and would let a search
              // they meant to scope run workspace-wide without saying so.
              <p className="module-note sm:col-span-2">
                Your project list could not be read, so the project selector is not shown. This does
                not mean the workspace has no projects. Uploads will not be attached to a project,
                and the search below covers every document in the workspace rather than a project
                you choose.
              </p>
            ) : null}
          </div>

          <TabsContent value="upload" className="mt-3">
            <Input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFile(file);
              }}
            />
            <p className="module-note mt-2 flex items-center gap-2">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              PDF, Word (.docx), plain text, and Markdown are indexed for citation — extraction runs
              immediately. Images (JPEG/PNG/TIFF), spreadsheets, CAD files, and other office documents
              are kept for reference: findable and downloadable, not citable. Up to {maxUploadMiB} MiB
              per file on this deployment.
            </p>
          </TabsContent>

          <TabsContent value="paste" className="mt-3 grid gap-2">
            <Textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder="Paste the document text here…"
              rows={6}
              maxLength={200000}
              disabled={busy}
            />
            <div>
              <Button type="button" onClick={() => void savePastedText()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Save text
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-3 grid gap-2">
          <FormError error={error} />
          {notice ? <p className="module-note">{notice}</p> : null}
        </div>
      </div>

      <div className="module-section-surface">
        <div className="module-section-header">
          <h2 className="module-section-title">Search these documents</h2>
          <p className="module-section-description">
            Keyword search across the passages of every document that finished extracting. It matches
            on any significant word and ranks by relevance — screening-grade, not semantic — and
            returns up to {SEARCH_LIMIT} passages.{" "}
            {projectId
              ? `Scoped to ${selectedProjectName ?? "the selected project"} plus documents not attached to any project.`
              : "Scoped to every document in this workspace."}
          </p>
        </div>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="e.g. complete streets policy, Title VI outreach, bridge scour"
            aria-label="Search the Knowledge Base"
            maxLength={500}
            className="max-w-md"
            disabled={search.status === "running"}
          />
          <Button type="submit" disabled={search.status === "running" || !searchInput.trim()}>
            {search.status === "running" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
        </form>

        <div className="mt-3 grid gap-2">
          {search.status === "failed" ? (
            <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              The search for &ldquo;{search.query}&rdquo; could not be run, so this screen cannot say
              whether your documents contain it. Nothing was searched. {search.message}
            </p>
          ) : null}

          {search.status === "done" && search.hits.length === 0 ? (
            <div className="module-empty-state">
              No passage in the searched documents matched &ldquo;{search.query}&rdquo;. The search
              itself succeeded — this is a result, not a failure.
              {coverageCaveat ? ` ${coverageCaveat}` : ""}
            </div>
          ) : null}

          {search.status === "done" && search.hits.length > 0 ? (
            <>
              <p className="module-note">
                {/*
                  The space before "matched" lives INSIDE the ternary on purpose.

                  Written as `passage{n === 1 ? "" : "s"} matched`, the singular
                  case renders "1 passagematched" IN A REAL BROWSER while jsdom
                  renders "1 passage matched" — an empty-string child between two
                  text segments is serialised differently by the server renderer
                  than it is assembled in a test DOM. `knowledge-base-search.test`
                  asserts /1 passage matched/ and passes; the page was wrong
                  anyway. Found by reading the rendered textContent in Chrome.

                  Carrying the space in the branch removes the empty child, so
                  both environments produce the same string and the test means
                  what it says.
                */}
                {search.hits.length} passage{search.hits.length === 1 ? " " : "s "}matched &ldquo;
                {search.query}&rdquo;
                {search.scopeProjectId
                  ? ` in ${projectNameById.get(search.scopeProjectId) ?? "the selected project"} plus unattached documents`
                  : " in this workspace"}
                , best match first
                {search.hits.length === SEARCH_LIMIT
                  ? ` — capped at ${SEARCH_LIMIT}, so there may be more`
                  : ""}
                .{coverageCaveat ? ` ${coverageCaveat}` : ""}
              </p>
              <ul className="module-record-list">
                {search.hits.map((hit) => (
                  <li key={hit.chunkId} className="module-record-row">
                    <div className="module-record-main">
                      <div className="module-record-head">
                        <span className="module-record-title">{hit.documentTitle}</span>
                      </div>
                      <p className="module-record-summary">{hit.snippet}</p>
                      <div className="module-record-meta">
                        <span className="module-record-chip">
                          {DOC_KIND_LABELS[hit.docKind as KbDocKind] ?? hit.docKind}
                        </span>
                        {excerptPageLabel(hit.pageFrom, hit.pageTo) ? (
                          <span className="module-record-chip">
                            {excerptPageLabel(hit.pageFrom, hit.pageTo)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      <div className="module-section-surface">
        <div className="module-section-header">
          <h2 className="module-section-title">Knowledge Base documents</h2>
          <p className="module-section-description">
            {listLoading
              ? "Loading documents…"
              : documentList.status === "failed"
                ? listScopeName
                  ? `The list of documents linked to ${listScopeName} could not be read, so this screen cannot say how many there are.`
                  : "The document list could not be read, so this screen cannot say how many documents this workspace has."
                : `${documents.length} document${documents.length === 1 ? "" : "s"} ${
                    listScopeName ? `linked to ${listScopeName}` : "in this workspace"
                  }.`}
          </p>
        </div>

        {documents.length === 0 ? (
          <div className="module-empty-state">
            {documentList.status === "failed"
              ? listScopeName
                ? `The list of documents linked to ${listScopeName} could not be read, so it is not shown. This does not mean none are linked — do not re-upload on the strength of this screen.`
                : "The document list could not be read, so it is not shown. This does not mean the workspace has no documents — do not re-upload on the strength of this screen."
              : projectId
                ? "No documents are attached to this project yet. Pick it in the selector above and upload — or switch back to all documents. Other workspace documents may still exist."
                : "No documents yet. Upload a plan or paste text above to start building this workspace's library."}
          </div>
        ) : (
          <ul className="module-record-list">
            {documents.map((doc) => (
              <li key={doc.id} className="module-record-row">
                <div className="module-record-main">
                  <div className="module-record-head">
                    <span className="module-record-title">{doc.title}</span>
                    <StatusBadge tone={statusTone(doc.status)}>{doc.status}</StatusBadge>
                  </div>
                  <p className="module-record-summary">
                    {DOC_KIND_LABELS[doc.doc_kind] ?? doc.doc_kind}
                    {doc.status === "ready"
                      ? ` · ${doc.chunk_count} chunk${doc.chunk_count === 1 ? "" : "s"}${
                          doc.page_count ? ` · ${doc.page_count} page${doc.page_count === 1 ? "" : "s"}` : ""
                        }`
                      : ""}
                    {/* The one honest sentence a stored file gets, here too — never "processing". */}
                    {doc.status === "stored" ? ` · ${KB_STORED_DOCUMENT_NOTICE}` : ""}
                    {/*
                      NOT the stored `extraction_error` verbatim. That string was
                      written at upload time and ends "OCR is not enabled" — a
                      claim about the DEPLOYMENT, recorded as a fact, that stops
                      being true the day an operator wires up a worker. The
                      parser's finding survives; the deployment half is
                      re-derived from what is true now.
                    */}
                    {doc.status === "failed"
                      ? ` · ${describeUnreadableDocument(doc.extraction_error, ocrConfigured)}`
                      : ""}
                    {doc.status === "ready" && doc.extraction_source === "ocr"
                      ? ` · ${KB_OCR_PROVENANCE_NOTICE}`
                      : ""}
                  </p>
                  <div className="module-record-meta">
                    <span className="module-record-stamp">{formatDate(doc.created_at)}</span>
                    {doc.project_id ? (
                      <Link
                        href={`/projects/${doc.project_id}`}
                        className="module-record-chip inline-flex items-center gap-1"
                        aria-label={`Open project ${projectNameById.get(doc.project_id) ?? "linked to this document"}`}
                      >
                        <FolderKanban className="size-3" />
                        {projectNameById.get(doc.project_id) ?? "Linked project"}
                      </Link>
                    ) : null}
                    {doc.original_filename ? (
                      <span className="module-record-chip">{doc.original_filename}</span>
                    ) : (
                      <span className="module-record-chip">Pasted text</span>
                    )}
                    {formatBytes(doc.byte_size) ? (
                      <span className="module-record-chip">{formatBytes(doc.byte_size)}</span>
                    ) : null}
                    {/* Pasted text has no stored original — nothing to link, honestly nothing. */}
                    {doc.storage_ref ? (
                      <a
                        href={`/api/knowledge-base/documents/${doc.id}/download`}
                        className="module-record-chip inline-flex items-center gap-1"
                        aria-label={`Download ${doc.title}`}
                      >
                        <Download className="size-3" />
                        Download
                      </a>
                    ) : null}
                  </div>
                </div>
                {/*
                  The one place a planner can act on a scan. Rendered only when
                  the document is a failed PDF AND this deployment has an OCR
                  service: a button that answers 501 would be worse than no
                  button, and the sentence above already says why it is absent.
                */}
                {ocrConfigured && documentCanBeOcred(doc) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={ocrBusyId === doc.id}
                    onClick={() => void requestOcr(doc.id, doc.title)}
                    aria-label={`Read ${doc.title} with OCR`}
                  >
                    {ocrBusyId === doc.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ScanText className="size-4" />
                    )}
                    Read with OCR
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void deleteDocument(doc.id, doc.title)}
                  aria-label={`Delete ${doc.title}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {library ? (
        <div className="module-section-surface">
          <div className="module-section-header">
            <h2 className="module-section-title">All files in this workspace</h2>
            <p className="module-section-description">
              One index across every module that holds files — generated reports, grant application
              exports, client invoices, aerial imagery and deliverables, model run outputs, and the
              documents above. Each file stays where its module keeps it; this list only points at
              it.{" "}
              {/* The memo's decision: the merged ordering is LABELED, never presented as a global sort. */}
              {describeDocumentLibraryOrdering(library.limitPerSource)}
              {libraryScopeName
                ? ` Scoped to ${libraryScopeName}.`
                : " Covering the whole workspace."}
            </p>
          </div>

          {libraryScopeStale ? (
            <p className="module-note">
              This file index still shows {libraryScopeName ? `${libraryScopeName}'s files` : "the whole workspace"}
              {" — it does not follow the project selector above. "}
              <Link
                className="underline underline-offset-2"
                href={projectId ? `/knowledge-base?projectId=${projectId}` : "/knowledge-base"}
              >
                Reload it for {selectedProjectName ?? "the whole workspace"}
              </Link>
              .
            </p>
          ) : null}

          {library.readFailureSummary ? (
            <p className="rounded-[0.5rem] border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              {library.readFailureSummary}
            </p>
          ) : null}

          {pendingLibrarySources.length > 0 ? (
            // One template literal → one text node, so tests (and translations,
            // later) see the sentence the planner sees.
            <p className="module-note">
              {`${pendingLibrarySources.map((id) => librarySourceLabel(id)).join(", ")}: ${
                pendingLibrarySources.length === 1
                  ? "this source is behind a database migration on this deployment, so its files are"
                  : "these sources are behind a database migration on this deployment, so their files are"
              } not listed here yet. That lane reads as unavailable, not as empty.`}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {librarySourceIds.map((id) => {
              const outcome = library.perSource[id];
              const active = activeSources === null || activeSources.has(id);
              const unavailable = Boolean(outcome?.pending || outcome?.failed);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleLibrarySource(id)}
                  aria-pressed={active}
                  className={`module-record-chip transition-opacity ${active ? "" : "opacity-50"}`}
                >
                  {librarySourceLabel(id)}
                  {/* A failed or pending lane has no count to claim. */}
                  {unavailable ? " (unavailable)" : ` (${outcome?.count ?? 0})`}
                </button>
              );
            })}
            <label className="module-record-chip inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={citableOnly}
                onChange={(event) => setCitableOnly(event.target.checked)}
              />
              Citable only
            </label>
          </div>

          {filteredLibraryEntries.length === 0 ? (
            <div className="module-empty-state">
              {libraryEntries.length > 0
                ? "No files match the current filters. Clear a source chip or the citable-only filter to see the rest."
                : library.readFailureSummary || pendingLibrarySources.length > 0
                  ? "No files are listed — but some sources could not be read (see above), so this is not a statement about what the workspace holds."
                  : "No files yet. Files appear here as reports are generated, grant applications are exported, imagery is uploaded, and documents are added above."}
            </div>
          ) : (
            <ul className="module-record-list">
              {filteredLibraryEntries.map((entry) => (
                <li key={`${entry.sourceId}:${entry.id}`} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-head">
                      <span className="module-record-title">{entry.title}</span>
                      <StatusBadge tone={libraryBadgeTone(entry.badge.tone)}>
                        {entry.badge.label}
                      </StatusBadge>
                    </div>
                    {entry.detail ? (
                      <p className="module-record-summary">{entry.detail}</p>
                    ) : null}
                    <div className="module-record-meta">
                      <span className="module-record-chip">{librarySourceLabel(entry.sourceId)}</span>
                      {formatDate(entry.createdAt) ? (
                        <span className="module-record-stamp">{formatDate(entry.createdAt)}</span>
                      ) : null}
                      {formatBytes(entry.byteSize) ? (
                        <span className="module-record-chip">{formatBytes(entry.byteSize)}</span>
                      ) : null}
                      {entry.projectId ? (
                        <Link
                          href={`/projects/${entry.projectId}`}
                          className="module-record-chip inline-flex items-center gap-1"
                        >
                          <FolderKanban className="size-3" />
                          {projectNameById.get(entry.projectId) ?? "Linked project"}
                        </Link>
                      ) : null}
                      {/* Always the owning module's ROUTE, never a storage URL (Lane B's invariant). */}
                      {entry.downloadHref ? (
                        <a
                          href={entry.downloadHref}
                          className="module-record-chip inline-flex items-center gap-1"
                          aria-label={`${entry.hasBytes ? "Download" : "Open"} ${entry.title}`}
                        >
                          <Download className="size-3" />
                          {entry.hasBytes ? "Download" : "Open"}
                        </a>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
