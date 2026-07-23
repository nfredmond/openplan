"use client";

import { useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/lib/ui/status";
import { KB_DOC_KINDS, type KbDocKind, type KbDocumentStatus } from "@/lib/knowledge-base/types";
import type { KbDocumentRow } from "@/lib/knowledge-base/documents";

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

type KnowledgeBaseWorkspaceProps = {
  workspaceId: string;
  initialDocuments: KbDocumentRow[];
};

export function KnowledgeBaseWorkspace({ workspaceId, initialDocuments }: KnowledgeBaseWorkspaceProps) {
  const [documents, setDocuments] = useState<KbDocumentRow[]>(initialDocuments);
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [docKind, setDocKind] = useState<KbDocKind>("other");
  const [title, setTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function upsertDocument(document: KbDocumentRow) {
    setDocuments((prev) => [document, ...prev.filter((entry) => entry.id !== document.id)]);
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
        body: JSON.stringify({ workspaceId, title: title.trim(), text: pasteText, docKind }),
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
          <h2 className="module-section-title">Documents</h2>
          <p className="module-section-description">
            {documents.length} document{documents.length === 1 ? "" : "s"} in this workspace.
          </p>
        </div>

        {documents.length === 0 ? (
          <div className="module-empty-state">
            No documents yet. Upload a plan or paste text above to start building this workspace&apos;s
            corpus.
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
