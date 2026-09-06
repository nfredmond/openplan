"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { WorkProgramSource } from "@/lib/programs/work-program/types";
import type { WorkProgramSourceElement } from "@/lib/programs/work-program/source-extraction";
import { Field, SelectField, fieldClass } from "./fields";

type Props = {
  programId: string; workspaceId: string; sources: WorkProgramSource[];
  documents: { id: string; title: string }[]; canWrite: boolean;
  onAttached: () => Promise<void>;
  onPropose: (source: WorkProgramSource, elements: WorkProgramSourceElement[]) => void;
};
export function WorkProgramSources({ programId, workspaceId, sources, documents, canWrite, onAttached, onPropose }: Props) {
  const [documentId, setDocumentId] = useState("");
  const [role, setRole] = useState("predecessor");
  const [url, setUrl] = useState("");
  const [extraction, setExtraction] = useState("review");
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
      const response = await fetch(`/api/programs/${programId}/work-program/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: selected, role, sourceUrl: url.trim() || null, extraction }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The source attachment could not be confirmed");
      await onAttached();
      setMessage(result.reused ? "This source was already retained. Its existing review is shown below." : "Source retained. Review the extraction against the original before proposing work.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The source could not be attached. Retry with the same document."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-lg border p-4">
    <h2 className="text-xl font-semibold">Predecessor and source documents</h2>
    <p className="text-sm text-muted-foreground">Keep the predecessor, each amendment and comparison program as separate originals. Imported approval and prior-year money provide context; they grant no new spending authority.</p>
    {canWrite && <fieldset disabled={busy} className="grid min-w-0 gap-4 md:grid-cols-2">
      <SelectField label="Retained PDF" value={documentId} onChange={(value) => { setDocumentId(value); setFile(null); }}><option value="">Choose a document</option>{[...documents, ...uploaded.filter((row) => !documents.some((document) => document.id === row.id))].map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</SelectField>
      <label className="min-w-0 text-sm font-medium">Or upload a PDF<input className={`${fieldClass} mt-1`} type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <SelectField label="Source role" value={role} onChange={setRole}>{["predecessor", "amendment", "comparison", "authority", "supplement"].map((value) => <option key={value} value={value}>{value}</option>)}</SelectField>
      <Field label="Official source URL, if known" value={url} onChange={setUrl} type="url" />
      <SelectField label="Source review" value={extraction} onChange={setExtraction}><option value="review">Extract recognized work elements</option><option value="manual">Manual page review</option></SelectField>
      <div className="self-end"><Button type="button" onClick={() => void attach()}>{busy ? "Retaining source…" : "Retain and review source"}</Button></div>
    </fieldset>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {sources.length === 0 && <p className="text-sm text-muted-foreground">No sources attached yet.</p>}
    {sources.map((source) => <details key={source.id} className="min-w-0 rounded-md border p-3">
      <summary className="cursor-pointer font-medium break-words">{source.title} · {source.source_role} · {source.page_count} PDF pages</summary>
      <div className="mt-4 space-y-4 text-sm">
        <p><a className="underline" href={`/api/knowledge-base/documents/${source.document_id}/download`}>Download retained original</a>{source.source_url && <> · <a className="underline" href={source.source_url} target="_blank" rel="noreferrer">Official source</a></>}</p>
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
