"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Notice = { id: string; title: string; filename: string | null };
type Props = { workspaceId: string; value: string; onChange: (id: string) => void; label?: string };

/** Selection is a convenience. Preview still verifies source scope and original bytes. */
export function AwardNoticePicker({ workspaceId, value, onChange, label = "Actual notice PDF" }: Props) {
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState<Notice[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function search() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage("");
    try {
      const parameters = new URLSearchParams({ workspaceId, q: query.trim(), sort: "newest" });
      const response = await fetch(`/api/knowledge-base/documents?${parameters}`, { signal: controller.signal, cache: "no-store" });
      const data: unknown = await response.json();
      if (controller.signal.aborted || request.current !== controller) return;
      if (!response.ok || !data || typeof data !== "object" || !("documents" in data) || !Array.isArray(data.documents)) throw new Error("Notice list unavailable. Try again.");
      const notices: Notice[] = [];
      for (const candidate of data.documents) {
        if (!candidate || typeof candidate !== "object") continue;
        const row = candidate as Record<string, unknown>;
        if (row.workspace_id !== workspaceId || row.source_kind !== "uploaded_pdf" || row.content_type !== "application/pdf" || !["stored", "ready"].includes(String(row.status)) || typeof row.id !== "string" || typeof row.title !== "string") continue;
        notices.push({ id: row.id, title: row.title, filename: typeof row.original_filename === "string" ? row.original_filename : null });
      }
      setDocuments(notices);
      const limit = "limit" in data && typeof data.limit === "number" ? data.limit : null;
      setMessage(notices.length ? `Found ${notices.length} uploaded PDF${notices.length === 1 ? "" : "s"}. Preview checks whether the selected original can be used.` : "No uploaded PDF matches this search. Upload the notice in Documents, then search again.");
      if (limit !== null && data.documents.length >= limit) setMessage((current) => `${current} The document list reached its ${limit}-file limit. Search by filename to find an older notice.`);
    } catch (error) {
      if (!controller.signal.aborted && request.current === controller) { setDocuments([]); setMessage(error instanceof Error ? error.message : "Notice list unavailable."); }
    } finally { if (request.current === controller) setBusy(false); }
  }

  return <div className="space-y-2">
    <label className="grid gap-1 text-sm">Find notice by title or filename<Input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <Button type="button" variant="outline" disabled={busy || !workspaceId} onClick={() => void search()}>Find an uploaded notice</Button>
    <label className="grid gap-1 text-sm">{label}<select className="module-select" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select an uploaded PDF</option>
      {value && !documents.some((document) => document.id === value) ? <option value={value}>Previously selected notice. Search to see its title.</option> : null}
      {documents.map((document) => <option key={document.id} value={document.id}>{document.title}{document.filename && document.filename !== document.title ? ` (${document.filename})` : ""}</option>)}
    </select></label>
    <p role="status" className="text-sm">{message}</p>
  </div>;
}
