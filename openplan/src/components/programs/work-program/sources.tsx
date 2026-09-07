"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WorkProgramSource } from "@/lib/programs/work-program/types";
import type { WorkProgramSourceElement } from "@/lib/programs/work-program/source-extraction";
import { Field, SelectField, fieldClass } from "./fields";

type Props = {
  programId: string; workspaceId: string; sources: WorkProgramSource[];
  documents: { id: string; title: string }[]; canWrite: boolean;
  onAttached: () => Promise<void>;
  onSelectVersion: (sourceId: string, versionId: string | null) => void;
  onPropose: (source: WorkProgramSource, elements: WorkProgramSourceElement[]) => void;
};
export function WorkProgramSources({ programId, workspaceId, sources, documents, canWrite, onAttached, onPropose, onSelectVersion }: Props) {
  const [documentId, setDocumentId] = useState("");
  const [role, setRole] = useState("predecessor");
  const [url, setUrl] = useState("");
  const [extraction, setExtraction] = useState("review");
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pageCount, setPageCount] = useState("");
  const [job, setJob] = useState<{ id: string; status: string; progress: number | null; message: string | null; failure_detail: string | null } | null>(null);
  const [documentExtractions, setDocumentExtractions] = useState<{ id: string; created_at: string; page_count: number }[]>([]);
  const [extractionId, setExtractionId] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (!documentId) return;
    let alive = true;
    async function status() {
      try {
        const response = await fetch(`/api/knowledge-base/documents/${documentId}/ocr`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Reading status is unavailable");
        if (alive) { setJob(result.latestJob); setDocumentExtractions(result.extractions ?? []); }
      } catch (error) { if (alive) setMessage(error instanceof Error ? error.message : "Reading status is unavailable"); }
    }
    void status(); const timer = setInterval(() => void status(), 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [documentId]);
  async function read(mode: "text" | "ocr", cancel = false) {
    setBusy(true);
    try {
      const response = await fetch(`/api/knowledge-base/documents/${documentId}/ocr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cancel ? { action: "cancel", jobId: job?.id } : { mode, requestId: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Reading request could not be recorded");
      setMessage(result.notice); if (result.job) setJob(result.job);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Reading request unavailable"); }
    finally { setBusy(false); }
  }
  async function attach() {
    setBusy(true); setMessage("");
    try {
      let selected = documentId;
      if (file) {
        const query = new URLSearchParams({ workspaceId, filename: file.name });
        const response = await fetch(`/api/knowledge-base/documents?${query}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "The original could not be uploaded");
        selected = result.document.id;
        setDocumentId(selected); setUploaded((current) => current.some((row) => row.id === selected) ? current : [...current, { id: selected, title: file.name }]);
        setFile(null);
      }
      if (!selected) throw new Error("Choose a retained PDF or a file to upload");
      const payload = { documentId: selected, role, sourceUrl: url.trim() || null, extraction, ...(extractionId ? { documentExtractionId: extractionId } : {}), ...(pageCount ? { pageCount: Number(pageCount) } : {}) };
      const key = JSON.stringify(payload);
      if (!request.current || request.current.key !== key) request.current = { key, id: crypto.randomUUID() };
      const response = await fetch(`/api/programs/${programId}/work-program/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: request.current.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The source attachment could not be confirmed");
      if (result.job) { setJob(result.job); setMessage(result.notice); return; }
      await onAttached();
      if (result.extractionVersionId) onSelectVersion(result.sourceId, result.extractionVersionId);
      request.current = null;
      setMessage(result.reused ? "This source was already retained. Its existing review is shown below." : "Source retained. Review the extraction against the original before proposing work.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The source could not be attached. Retry with the same document."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-lg border p-4">
    <h2 className="text-xl font-semibold">Predecessor and source documents</h2>
    <p className="text-sm text-muted-foreground">Keep the predecessor, each amendment and comparison program as separate originals. Imported approval and prior-year money provide context; they grant no new spending authority.</p>
    {canWrite && <fieldset disabled={busy} className="grid min-w-0 gap-4 md:grid-cols-2">
      <SelectField label="Retained PDF" value={documentId} onChange={(value) => { setDocumentId(value); setExtractionId(""); setFile(null); }}><option value="">Choose a document</option>{[...documents, ...uploaded.filter((row) => !documents.some((document) => document.id === row.id))].map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</SelectField>
      <label className="min-w-0 text-sm font-medium">Or upload a PDF<input className={`${fieldClass} mt-1`} type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <SelectField label="Source role" value={role} onChange={setRole}>{["predecessor", "amendment", "comparison", "authority", "supplement"].map((value) => <option key={value} value={value}>{value}</option>)}</SelectField>
      <Field label="Official source URL, if known" value={url} onChange={setUrl} type="url" />
      <SelectField label="Source review" value={extraction} onChange={setExtraction}><option value="review">Extract recognized work elements</option><option value="manual">Manual page review</option></SelectField>
      {extraction === "manual" && <Field label="PDF page count, if indexing failed" type="number" value={pageCount} onChange={setPageCount} />}
      {documentExtractions.length > 0 && <SelectField label="Retained document extraction" value={extractionId} onChange={setExtractionId}><option value="">Latest retained extraction</option>{documentExtractions.map((row) => <option key={row.id} value={row.id}>{row.created_at} · {row.page_count} pages</option>)}</SelectField>}
      <div className="self-end"><Button type="button" onClick={() => void attach()}>{busy ? "Retaining source…" : "Retain and review source"}</Button></div>
    </fieldset>}
    {documentId && <div className="space-y-3 text-sm"><a className="underline" target="_blank" rel="noreferrer" href={`/api/knowledge-base/documents/${documentId}/download?disposition=inline`}>Open retained original for manual review</a>{job && <p role="status">Reading: {job.status}. {job.progress ?? 0}% {job.failure_detail || job.message}</p>}{canWrite && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => void read("text")}>Read or retry embedded text</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void read("ocr")}>Read scanned pages with OCR</Button>{job && ["queued", "running"].includes(job.status) && <Button type="button" variant="outline" disabled={busy} onClick={() => void read("text", true)}>Cancel reading</Button>}</div>}</div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {sources.length === 0 && <p className="text-sm text-muted-foreground">No sources attached yet.</p>}
    {sources.map((source) => <details key={source.id} className="min-w-0 rounded-md border p-3">
      <summary className="cursor-pointer font-medium break-words">{source.title} · {source.source_role} · {source.page_count} PDF pages</summary>
      <div className="mt-4 space-y-4 text-sm">
        <p><a className="underline" href={`/api/knowledge-base/documents/${source.document_id}/download`}>Download retained original</a>{source.source_url && <> · <a className="underline" href={source.source_url} target="_blank" rel="noreferrer">Official source</a></>}</p>
        <SelectField label="Review extraction version" value={source.selectedVersionId ?? ""} onChange={(id) => onSelectVersion(source.id, id || null)}><option value="">Original attachment</option>{source.versions?.map((version) => <option key={version.id} value={version.id}>{version.created_at} · {version.extraction_json.parser}</option>)}</SelectField>
        <p className="break-all text-xs text-muted-foreground">Original SHA-256: {source.document_checksum}</p>
        {source.extraction_json.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        {canWrite && source.extraction_json.elements.length > 0 && <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => onPropose(source, source.extraction_json.elements)}>Add all work elements for review</Button>}
        {source.extraction_json.elements.map((element) => <details key={element.key} className="rounded border p-3">
          <summary className="cursor-pointer break-words">{element.code} · {element.title} · PDF pages {element.pageFrom}–{element.pageTo}</summary>
          <div className="mt-3 space-y-3"><p>Printed source revenue: {element.revenueTotal ?? "unresolved"}. Printed source cost: {element.costTotal ?? "unresolved"}.</p>{element.warnings.map((warning) => <p key={warning}>{warning}</p>)}<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-sm" tabIndex={0} aria-label={`Original text for ${element.code}`}>{element.originalText}</pre>{canWrite && <Button type="button" variant="outline" onClick={() => onPropose(source, [element])}>Propose work element {element.code}</Button>}</div>
        </details>)}
      </div>
    </details>)}
  </section>;
}
