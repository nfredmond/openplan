"use client";

import { parse as parseCsv } from "csv-parse/browser/esm/sync";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { DocumentLibraryEntry } from "@/lib/document-library/types";

type ProjectCostRecord = {
  id: string;
  workspace_id: string;
  estimated_cost_amount: number | string | null;
  estimated_cost_currency: string | null;
  estimated_cost_basis_year: number | null;
  estimated_cost_source_document_id: string | null;
};

type ProjectEstimatedCostEditorProps = {
  project: ProjectCostRecord;
  canWrite: boolean;
  documents: Array<Pick<DocumentLibraryEntry, "sourceId" | "id" | "title" | "projectId">>;
};

type CsvPreview = { columns: string[]; rows: string[][]; truncated: boolean };
type CsvSelection = { name: string; summary: string };

function displayCost(amount: number | string, currency: string): string {
  const numeric = typeof amount === "number" ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(numeric)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${currency} ${numeric.toLocaleString()}`;
  }
}

function suggestedColumn(columns: string[], patterns: RegExp[]): string {
  const index = columns.findIndex((column) => patterns.some((pattern) => pattern.test(column.trim())));
  return index < 0 ? "" : String(index);
}

function currencyFromHeader(header: string): string {
  const match = header.trim().match(/(?:^|[_ (\-])([a-z]{3})\)?$/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function parseCsvPreview(text: string): CsvPreview {
  const parsed = parseCsv(text, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as unknown[][];
  const [header = [], ...dataRows] = parsed;
  const columns = header.map((cell, index) => String(cell ?? "").trim() || `Column ${index + 1}`);
  return {
    columns,
    rows: dataRows.slice(0, 200).map((row) => columns.map((_, index) => String(row[index] ?? "").trim())),
    truncated: dataRows.length > 200,
  };
}

export function ProjectEstimatedCostEditor({
  project,
  canWrite,
  documents,
}: ProjectEstimatedCostEditorProps) {
  const router = useRouter();
  const sourceOptions = useMemo(
    () => documents
      .filter((entry) => entry.sourceId === "knowledge_base" && entry.projectId === project.id)
      .map((entry) => ({ id: entry.id, title: entry.title })),
    [documents, project.id]
  );
  const [availableSources, setAvailableSources] = useState(sourceOptions);
  const [amount, setAmount] = useState(project.estimated_cost_amount === null ? "" : String(project.estimated_cost_amount));
  const [currency, setCurrency] = useState(project.estimated_cost_currency ?? "");
  const [priceYear, setPriceYear] = useState(project.estimated_cost_basis_year === null ? "" : String(project.estimated_cost_basis_year));
  const [sourceDocumentId, setSourceDocumentId] = useState(project.estimated_cost_source_document_id ?? "");
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [nameColumn, setNameColumn] = useState("");
  const [summaryColumn, setSummaryColumn] = useState("");
  const [costColumn, setCostColumn] = useState("");
  const [currencyColumn, setCurrencyColumn] = useState("");
  const [selectedCsv, setSelectedCsv] = useState<CsvSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(estimatedCost: Record<string, unknown> | null) {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = { estimatedCost };
      if (estimatedCost && selectedCsv) {
        payload.name = selectedCsv.name;
        if (selectedCsv.summary) payload.summary = selectedCsv.summary;
      }
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save the estimate.");
      setMessage(estimatedCost ? "Project candidate and estimated cost saved." : "Estimated project cost cleared.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the estimate.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadCsv(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const preview = parseCsvPreview(await file.text());
      if (preview.columns.length === 0 || preview.rows.length === 0) {
        throw new Error("This CSV has no header and project rows to review.");
      }
      const query = new URLSearchParams({
        workspaceId: project.workspace_id,
        projectId: project.id,
        filename: file.name,
        docKind: "other",
      });
      const response = await fetch(`/api/knowledge-base/documents?${query}`, {
        method: "POST",
        headers: { "content-type": file.type || "text/csv" },
        body: file,
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        warning?: string;
        document?: { id: string; title: string };
      };
      if (!response.ok || !body.document) throw new Error(body.error ?? "Could not store the CSV.");
      if (body.warning) throw new Error(body.warning);

      setCsvPreview(preview);
      setNameColumn(suggestedColumn(preview.columns, [/^name$/i, /project.*name/i, /^title$/i]));
      setSummaryColumn(suggestedColumn(preview.columns, [/description/i, /summary/i]));
      const suggestedCost = suggestedColumn(preview.columns, [/cost/i, /amount/i, /estimate/i]);
      setCostColumn(suggestedCost);
      setCurrencyColumn(suggestedColumn(preview.columns, [/currency/i]));
      if (suggestedCost) setCurrency(currencyFromHeader(preview.columns[Number(suggestedCost)] ?? ""));
      setSourceDocumentId(body.document.id);
      setAvailableSources((current) => current.some((option) => option.id === body.document?.id)
        ? current
        : [...current, { id: body.document.id, title: body.document.title }]);
      setSelectedCsv(null);
      setMessage(`${body.document.title} is stored and indexed. Review one row before applying it.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read this CSV.");
    } finally {
      setUploading(false);
    }
  }

  function selectCandidate(row: string[]) {
    if (nameColumn === "" || costColumn === "") return;
    const name = row[Number(nameColumn)]?.trim() ?? "";
    const parsedAmount = Number.parseFloat((row[Number(costColumn)] ?? "").replace(/[$,\s]/g, ""));
    const selectedCurrency = currencyColumn
      ? (row[Number(currencyColumn)] ?? "").trim().toUpperCase()
      : currency.trim().toUpperCase();
    if (!name || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || !/^[A-Z]{3}$/.test(selectedCurrency)) {
      setMessage("Choose name and cost columns, and enter a three-letter currency code before using this row.");
      return;
    }
    const summary = summaryColumn ? (row[Number(summaryColumn)] ?? "").trim() : "";
    setAmount(String(parsedAmount));
    setCurrency(selectedCurrency);
    setSelectedCsv({ name, summary });
    setMessage(`${name} selected. Save below to apply it to this project.`);
  }

  const currentSource = availableSources.find((option) => option.id === project.estimated_cost_source_document_id);

  return (
    <article className="module-section-surface" aria-labelledby="estimated-project-cost-heading">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Project identity</p>
          <h2 id="estimated-project-cost-heading" className="module-section-title">Planning-level estimated project cost</h2>
          <p className="module-section-description">
            The candidate&apos;s estimated capital or planning cost. This is separate from the
            project-management budget, funding need, and awards below.
          </p>
        </div>
      </div>

      {project.estimated_cost_amount !== null && project.estimated_cost_currency ? (
        <div className="mt-4 rounded-lg border bg-background/70 p-3 text-sm">
          <p className="font-semibold">{displayCost(project.estimated_cost_amount, project.estimated_cost_currency)}</p>
          <p className="text-muted-foreground">
            {project.estimated_cost_basis_year ? `Price year ${project.estimated_cost_basis_year}. ` : "Price year not entered. "}
            {currentSource
              ? `Source: ${currentSource.title}.`
              : project.estimated_cost_source_document_id
                ? "The linked source document is not readable in this document list."
                : "No source document linked."}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No planning-level cost estimate has been entered.</p>
      )}

      {canWrite ? (
        <>
          <section className="mt-5 rounded-lg border bg-muted/20 p-4" aria-labelledby="csv-project-candidate-heading">
            <h3 id="csv-project-candidate-heading" className="font-semibold">Bring in a project candidate from CSV</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              OpenPlan stores and indexes the file, then lets you review one row before it changes this project.
            </p>
            <label className="mt-3 grid max-w-md gap-1 text-sm">
              Project candidates CSV
              <input className="rounded-md border bg-background px-3 py-2" type="file" accept=".csv,text/csv" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCsv(file); }} />
            </label>
            {uploading ? <p className="mt-2 text-sm text-muted-foreground">Reading and storing the CSV…</p> : null}

            {csvPreview ? (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Project name column", nameColumn, setNameColumn, true],
                    ["Description column", summaryColumn, setSummaryColumn, false],
                    ["Estimated cost column", costColumn, setCostColumn, true],
                    ["Currency column", currencyColumn, setCurrencyColumn, false],
                  ].map(([label, selected, setter, required]) => (
                    <label className="grid gap-1 text-sm" key={String(label)}>
                      {label}{required ? " (required)" : " (optional)"}
                      <select className="rounded-md border bg-background px-3 py-2" value={String(selected)} onChange={(event) => (setter as (value: string) => void)(event.target.value)}>
                        <option value="">Choose a column</option>
                        {csvPreview.columns.map((column, index) => <option key={`${column}-${index}`} value={index}>{column}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="overflow-x-auto rounded-md border bg-background">
                  <table className="min-w-full text-left text-sm">
                    <thead><tr>{csvPreview.columns.map((column, index) => <th className="border-b px-3 py-2 font-medium" key={`${column}-${index}`}>{column}</th>)}<th className="border-b px-3 py-2">Review</th></tr></thead>
                    <tbody>{csvPreview.rows.map((row, rowIndex) => <tr className="border-b last:border-0" key={rowIndex}>{row.map((cell, cellIndex) => <td className="px-3 py-2" key={cellIndex}>{cell || "—"}</td>)}<td className="px-3 py-2"><button className="rounded-md border px-2 py-1 whitespace-nowrap" type="button" onClick={() => selectCandidate(row)}>Use this candidate</button></td></tr>)}</tbody>
                  </table>
                </div>
                {csvPreview.truncated ? <p className="text-sm text-muted-foreground">Showing the first 200 rows. The complete file is stored and indexed.</p> : null}
              </div>
            ) : null}
          </section>

          <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); void save({ amount: Number.parseFloat(amount), currency: currency.trim().toUpperCase(), basisYear: priceYear ? Number.parseInt(priceYear, 10) : null, sourceDocumentId: sourceDocumentId || null }); }}>
            <label className="grid gap-1 text-sm">Amount<input className="rounded-md border bg-background px-3 py-2" inputMode="decimal" required min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
            <label className="grid gap-1 text-sm">Currency<input className="rounded-md border bg-background px-3 py-2 uppercase" required minLength={3} maxLength={3} placeholder="USD" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
            <label className="grid gap-1 text-sm">Price year (optional)<input className="rounded-md border bg-background px-3 py-2" type="number" min={1800} max={3000} value={priceYear} onChange={(event) => setPriceYear(event.target.value)} /></label>
            <label className="grid gap-1 text-sm">Source document (optional)<select className="rounded-md border bg-background px-3 py-2" value={sourceDocumentId} onChange={(event) => setSourceDocumentId(event.target.value)}><option value="">No document linked</option>{availableSources.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label>
            <div className="flex flex-wrap items-center gap-2 md:col-span-4">
              <button className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60" type="submit" disabled={saving}>{saving ? "Saving…" : selectedCsv ? "Apply selected project" : "Save estimated cost"}</button>
              {project.estimated_cost_amount !== null ? <button className="rounded-md border px-3 py-2 text-sm" type="button" disabled={saving} onClick={() => void save(null)}>Clear estimate</button> : null}
              {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
            </div>
          </form>
        </>
      ) : null}
    </article>
  );
}
