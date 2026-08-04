"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FolderKanban, Loader2, Search, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/lib/ui/status";
import { KB_DOC_KINDS, type KbDocKind, type KbDocumentStatus } from "@/lib/knowledge-base/types";
import type { KbDocumentRow } from "@/lib/knowledge-base/documents";
import { excerptPageLabel, type KnowledgeBaseExcerpt } from "@/lib/knowledge-base/retrieval";

const DOC_KIND_LABELS: Record<KbDocKind, string> = {
  rtp: "Regional Transportation Plan",
  comment_letter: "Comment letter",
  prior_study: "Prior study",
  nofo: "Grant notice (NOFO)",
  staff_report: "Staff report",
  policy: "Policy / guidance",
  other: "Other",
};

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.txt,.md,.markdown";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
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

function statusTone(status: KbDocumentStatus): StatusTone {
  switch (status) {
    case "ready":
      return "success";
    case "failed":
      return "danger";
    case "pending":
    case "extracting":
      return "warning";
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
};

export function KnowledgeBaseWorkspace({
  workspaceId,
  initialDocuments,
  projects = [],
  initialProjectId = null,
  readFailures = { documents: false, projects: false },
}: KnowledgeBaseWorkspaceProps) {
  const [documents, setDocuments] = useState<KbDocumentRow[]>(initialDocuments);
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );
  const selectedProjectName = projectId ? projectNameById.get(projectId) ?? null : null;

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
  const coverageCaveat = readFailures.documents
    ? "The document list could not be read, so this screen cannot say how much of your corpus was searchable."
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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load documents");
    } finally {
      setListLoading(false);
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
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That file is larger than the 25 MB limit.");
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
      };
      if (!response.ok) {
        throw new Error([payload.error, payload.hint].filter(Boolean).join(" — ") || "Upload failed");
      }
      if (payload.document) {
        upsertDocument(payload.document);
        if (payload.warning) {
          setNotice(`Stored "${payload.document.title}", but its text could not be extracted: ${payload.warning}`);
        } else if (payload.deduped) {
          setNotice("That document is already in your Knowledge Base.");
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

  return (
    <section className="module-page">
      <header className="module-section-header">
        <span className="module-section-label">Analyze</span>
        <h1 className="module-section-title">Knowledge Base</h1>
        <p className="module-section-description">
          Upload your agency&apos;s own documents — adopted plans, comment letters, prior studies, grant
          notices — so the Planner Agent and Grant Writer can ground and cite from them. Retrieval is
          keyword-based (screening-grade); scanned, image-only PDFs without a text layer are not supported
          yet.
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
              PDF, Word (.docx), plain text, or Markdown. Up to 25 MB. Extraction runs immediately.
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
                {search.hits.length} passage{search.hits.length === 1 ? "" : "s"} matched &ldquo;
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
          <h2 className="module-section-title">Documents</h2>
          <p className="module-section-description">
            {listLoading
              ? "Loading documents…"
              : `${documents.length} document${documents.length === 1 ? "" : "s"} ${
                  selectedProjectName
                    ? `linked to ${selectedProjectName}`
                    : projectId
                      ? "linked to the selected project"
                      : "in this workspace"
                }.`}
          </p>
        </div>

        {documents.length === 0 ? (
          <div className="module-empty-state">
            {readFailures.documents
              ? "The document list could not be read, so it is not shown. This does not mean the workspace has no documents — do not re-upload on the strength of this screen."
              : projectId
                ? "No documents are attached to this project yet. Pick it in the selector above and upload — or switch back to all documents. Other workspace documents may still exist."
                : "No documents yet. Upload a plan or paste text above to start building this workspace's corpus."}
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
                    {doc.status === "failed" && doc.extraction_error ? ` · ${doc.extraction_error}` : ""}
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
                  </div>
                </div>
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
    </section>
  );
}
