"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, FileSpreadsheet, Link2, Upload } from "lucide-react";
import {
  PROJECT_DELIVERY_PHASE_LABELS,
  PROJECT_DELIVERY_PHASES,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
} from "@/lib/projects/project-record-fields";
import type {
  PortfolioCostScale,
  PortfolioImportMapping,
  PortfolioSheetConfiguration,
  PortfolioWorkbookReview,
  PortfolioWorkbookRowReview,
} from "@/lib/projects/portfolio-import";
import type { PortfolioWorkbookInspection } from "@/lib/projects/portfolio-workbook";

type StoredDocument = { id: string; title: string; original_filename?: string | null };
export type PortfolioImportSummary = {
  id: string; sourceTitle: string | null; sourceFilename: string | null; sourceHash: string;
  sourceFormat: "csv" | "xls" | "xlsx" | "ods"; sheetCount: number;
  rowCount: number; createdCount: number; skippedCount: number; conflictedCount: number;
  invalidCount: number; previouslyCreatedCount: number; importedAt: string;
};
type Committed = {
  batchId: string; created: number; skipped: number; conflicted: number;
  invalid: number; previouslyCreated: number; projectIds: string[];
};
type ImportResponse = {
  error?: string;
  source?: { id: string; title: string; filename: string | null; format: string; sha256: string; byteLength: number };
  inspection?: PortfolioWorkbookInspection;
  review?: PortfolioWorkbookReview;
  committed?: Committed;
};
type MappingKey = keyof PortfolioImportMapping;
type SheetDraft = PortfolioSheetConfiguration;

const SOURCE_MAX_BYTES = 10 * 1024 * 1024;
const defaultSetup = (worksheetIndex: number): SheetDraft => ({
  worksheetIndex,
  headerRow: 1,
  mapping: { name: 0 },
  defaults: { planType: "capital_program", status: "draft", deliveryPhase: "programming" },
});

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
function normalizedHeaders(headers: string[]): string[] {
  return headers.map((header) => header.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"));
}
function sampleHeaders(inspection: PortfolioWorkbookInspection, draft: SheetDraft): string[] {
  const sheet = inspection.worksheets.find((candidate) => candidate.index === draft.worksheetIndex);
  return sheet?.sampleRows.find((row) => row.rowNumber === draft.headerRow)?.cells.map((cell) => cell.display.trim()) ?? [];
}
function rowKey(worksheetIndex: number, rowNumber: number): string {
  return `${worksheetIndex}:${rowNumber}`;
}
function rowIssues(row: PortfolioWorkbookReview["rows"][number]): string {
  return [...row.errors, ...row.warnings].map((entry) => entry.message).join(" ");
}

export function ProjectPortfolioImporter({
  workspaceId,
  recentImports,
  historyReadFailed,
}: {
  workspaceId: string;
  recentImports: PortfolioImportSummary[];
  historyReadFailed: boolean;
}) {
  const router = useRouter();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [originalDocumentId, setOriginalDocumentId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<PortfolioWorkbookInspection | null>(null);
  const [drafts, setDrafts] = useState<Record<number, SheetDraft>>({});
  const [rowReviews, setRowReviews] = useState<Record<string, PortfolioWorkbookRowReview>>({});
  const [review, setReview] = useState<PortfolioWorkbookReview | null>(null);
  const [approvedPreviewHash, setApprovedPreviewHash] = useState<string | null>(null);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isCsv = /\.csv$/i.test(sourceFile?.name ?? "");
  const selectedDrafts = useMemo(
    () => Object.values(drafts).sort((a, b) => a.worksheetIndex - b.worksheetIndex),
    [drafts]
  );
  const selectedCount = useMemo(
    () => Object.values(rowReviews).filter((row) => row.decision === "create").length,
    [rowReviews]
  );
  const hasUncreatableSelection = useMemo(
    () => review?.rows.some((row) => row.decision === "create" && !row.canCreate) ?? false,
    [review]
  );

  function invalidateReview() {
    setReview(null);
    setApprovedPreviewHash(null);
    setCommitted(null);
  }
  function resetSource() {
    setSourceDocumentId(null);
    setOriginalDocumentId(null);
    setInspection(null);
    setDrafts({});
    setRowReviews({});
    invalidateReview();
  }
  async function uploadDocument(file: File): Promise<StoredDocument> {
    const query = new URLSearchParams({ workspaceId, filename: file.name, title: file.name });
    const response = await fetch(`/api/knowledge-base/documents?${query.toString()}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    const payload = (await response.json()) as { document?: StoredDocument; error?: string };
    if (!response.ok || !payload.document) throw new Error(payload.error ?? `Could not store ${file.name}.`);
    return payload.document;
  }
  async function callImport(body: Record<string, unknown>): Promise<ImportResponse> {
    const response = await fetch("/api/projects/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, sourceDocumentId, originalWorkbookDocumentId: originalDocumentId ?? undefined, ...body }),
    });
    const payload = (await response.json()) as ImportResponse;
    if (!response.ok) throw new Error(payload.error ?? "The portfolio import request failed.");
    return payload;
  }

  async function storeAndInspect() {
    if (!sourceFile) return;
    if (sourceFile.size > SOURCE_MAX_BYTES) {
      setMessage("The source is larger than 10 MiB. Nothing was uploaded.");
      return;
    }
    if (!/\.(csv|xls|xlsx|ods)$/i.test(sourceFile.name) || /\.(xlsm|xlsb)$/i.test(sourceFile.name)) {
      setMessage("Choose a CSV, XLS, XLSX, or ODS project list. Macro-enabled and XLSB files are refused.");
      return;
    }
    if (originalFile && (!isCsv || !/\.(xls|xlsx|ods)$/i.test(originalFile.name))) {
      setMessage("A separate authoritative workbook is optional only for a CSV source and must be XLS, XLSX, or ODS.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const source = await uploadDocument(sourceFile);
      const original = originalFile ? await uploadDocument(originalFile) : null;
      setSourceDocumentId(source.id);
      setOriginalDocumentId(original?.id ?? null);
      const response = await fetch("/api/projects/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "inspect", workspaceId, sourceDocumentId: source.id, originalWorkbookDocumentId: original?.id ?? undefined }),
      });
      const payload = (await response.json()) as ImportResponse;
      if (!response.ok || !payload.inspection) throw new Error(payload.error ?? "Could not inspect the stored source.");
      setInspection(payload.inspection);
      setMessage(`Stored ${sourceFile.name}. Choose the worksheets and setup for this import.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not store and inspect the source.");
    } finally {
      setBusy(false);
    }
  }

  function toggleSheet(index: number, selected: boolean) {
    setDrafts((current) => {
      const next = { ...current };
      if (selected) next[index] = defaultSetup(index);
      else delete next[index];
      return next;
    });
    setRowReviews({});
    invalidateReview();
  }
  function updateDraft(index: number, update: (draft: SheetDraft) => SheetDraft) {
    setDrafts((current) => ({ ...current, [index]: update(current[index]) }));
    setRowReviews({});
    invalidateReview();
  }
  function changeMapping(index: number, key: MappingKey, raw: string) {
    updateDraft(index, (draft) => {
      const mapping = { ...draft.mapping };
      if (raw === "") delete mapping[key];
      else mapping[key] = Number.parseInt(raw, 10);
      return { ...draft, mapping };
    });
  }
  function updateCost(index: number, patch: Partial<{ currency: string; scale: PortfolioCostScale; priceYear: number }>) {
    updateDraft(index, (draft) => ({
      ...draft,
      defaults: {
        ...draft.defaults,
        cost: { currency: "USD", scale: "ones", priceYear: new Date().getFullYear(), ...draft.defaults.cost, ...patch },
      },
    }));
  }
  function copySetup(source: SheetDraft) {
    if (!inspection) return;
    const sourceHeaders = normalizedHeaders(sampleHeaders(inspection, source));
    const unmatched: string[] = [];
    let copied = 0;
    const next = { ...drafts };
    for (const target of Object.values(drafts)) {
      if (target.worksheetIndex === source.worksheetIndex) continue;
      const targetHeaders = normalizedHeaders(sampleHeaders(inspection, target));
      const same = sourceHeaders.length > 0 && JSON.stringify(sourceHeaders) === JSON.stringify(targetHeaders);
      const name = inspection.worksheets.find((sheet) => sheet.index === target.worksheetIndex)?.name ?? `Sheet ${target.worksheetIndex + 1}`;
      if (!same) {
        unmatched.push(name);
        continue;
      }
      next[target.worksheetIndex] = {
        ...target,
        mapping: { ...source.mapping },
        defaults: { ...source.defaults, cost: source.defaults.cost ? { ...source.defaults.cost } : undefined },
      };
      copied += 1;
    }
    setDrafts(next);
    setRowReviews({});
    invalidateReview();
    setMessage(
      `Copied setup to ${copied} matching selected worksheet${copied === 1 ? "" : "s"}.` +
      (unmatched.length ? ` Headers did not match: ${unmatched.join(", ")}.` : "")
    );
  }

  function currentReviews(): PortfolioWorkbookRowReview[] {
    return Object.values(rowReviews).sort((a, b) => a.worksheetIndex - b.worksheetIndex || a.rowNumber - b.rowNumber);
  }
  function adoptReview(payload: ImportResponse) {
    if (!payload.review) throw new Error("The server returned no row review.");
    setReview(payload.review);
    const next: Record<string, PortfolioWorkbookRowReview> = {};
    for (const row of payload.review.rows) {
      const local = rowReviews[rowKey(row.worksheetIndex, row.rowNumber)];
      next[rowKey(row.worksheetIndex, row.rowNumber)] = {
        worksheetIndex: row.worksheetIndex,
        rowNumber: row.rowNumber,
        decision: row.decision,
        confirmNameMatch: row.confirmNameMatch,
        confirmFormula: row.confirmFormula,
        ...(local?.planType ? { planType: row.planType } : {}),
        ...(local?.status ? { status: row.status } : {}),
        ...(local?.deliveryPhase ? { deliveryPhase: row.deliveryPhase } : {}),
      };
    }
    setRowReviews(next);
    setApprovedPreviewHash(payload.review.previewHash);
  }
  async function previewRows() {
    if (!sourceDocumentId || selectedDrafts.length === 0) return;
    setBusy(true);
    setMessage(null);
    setApprovedPreviewHash(null);
    try {
      adoptReview(await callImport({ mode: "preview", configurations: selectedDrafts, rowReviews: currentReviews() }));
      setMessage("This is the current combined review. Confirm only the rows you intend to create.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not review the selected worksheets.");
    } finally {
      setBusy(false);
    }
  }
  async function commitRows() {
    if (!approvedPreviewHash) return;
    setBusy(true);
    setMessage(null);
    try {
      const payload = await callImport({ mode: "commit", configurations: selectedDrafts, rowReviews: currentReviews(), approvedPreviewHash });
      setCommitted(payload.committed ?? null);
      setReview(payload.review ?? review);
      setMessage(`Import complete. ${payload.committed?.created ?? 0} project${payload.committed?.created === 1 ? "" : "s"} created.`);
      router.refresh();
    } catch (error) {
      setApprovedPreviewHash(null);
      setMessage(error instanceof Error ? error.message : "The import did not commit.");
    } finally {
      setBusy(false);
    }
  }
  function updateRow(worksheetIndex: number, rowNumber: number, patch: Partial<PortfolioWorkbookRowReview>) {
    const key = rowKey(worksheetIndex, rowNumber);
    setRowReviews((current) => ({
      ...current,
      [key]: { ...current[key], ...patch, worksheetIndex, rowNumber, decision: patch.decision ?? current[key]?.decision ?? "skip" },
    }));
    setApprovedPreviewHash(null);
  }
  function createAllClean() {
    if (!review) return;
    setRowReviews((current) => {
      const next = { ...current };
      for (const row of review.rows) {
        if (row.state !== "clean") continue;
        const key = rowKey(row.worksheetIndex, row.rowNumber);
        next[key] = { ...next[key], worksheetIndex: row.worksheetIndex, rowNumber: row.rowNumber, decision: "create" };
      }
      return next;
    });
    setApprovedPreviewHash(null);
  }

  return (
    <section id="import-project-list" className="module-section-surface w-full min-w-0 max-w-full space-y-5">
      <div className="module-section-header">
        <div className="module-section-heading"><p className="module-section-label">Reviewed upload</p><h2 className="module-section-title">Import project list</h2></div>
        <span className="module-record-chip"><FileSpreadsheet className="h-3.5 w-3.5" />CSV or workbook, create only</span>
      </div>
      <p className="max-w-5xl text-sm leading-relaxed text-muted-foreground">
        Store one CSV, XLS, XLSX, or ODS source, choose worksheets, and decide row by row. Every row starts as skip. This importer never updates, merges, translates status, infers currency, or interprets location text.
      </p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">Project list, up to 2,000 rows and 10 MiB
          <input type="file" accept=".csv,.xls,.xlsx,.ods" className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm" onChange={(event) => { setSourceFile(event.target.files?.[0] ?? null); setOriginalFile(null); resetSource(); }} />
        </label>
        {isCsv ? <label className="grid min-w-0 gap-1.5 text-sm font-medium">Authoritative original workbook, optional
          <input type="file" accept=".xls,.xlsx,.ods" className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm" onChange={(event) => { setOriginalFile(event.target.files?.[0] ?? null); resetSource(); }} />
        </label> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60" disabled={!sourceFile || busy} onClick={() => void storeAndInspect()}>
          <Upload className="h-4 w-4" />{busy && !inspection ? "Storing source…" : "Store source and inspect worksheets"}
        </button>
        {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
      </div>

      {inspection ? <div className="space-y-4">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-relaxed">
          <strong>Location text is provenance, not verified geography.</strong> It never sets a project place, study area, bounding box, coordinates, or geometry. Formula cells use only the workbook's cached value and require individual confirmation. OpenPlan never recalculates them.
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground"><span>{inspection.format.toUpperCase()}</span><span>{inspection.worksheets.length} worksheet{inspection.worksheets.length === 1 ? "" : "s"}</span><span>No worksheet is selected automatically.</span></div>
        {inspection.worksheets.map((sheet) => {
          const draft = drafts[sheet.index];
          const headers = draft ? sampleHeaders(inspection, draft) : [];
          return <article key={sheet.index} className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" aria-label={`Select worksheet ${sheet.name}`} checked={Boolean(draft)} onChange={(event) => toggleSheet(sheet.index, event.target.checked)} />{sheet.index + 1}. {sheet.name}</label>
              <span className="text-xs text-muted-foreground">{sheet.visibility.replace("_", " ")} · {sheet.rowCount} rows · {sheet.columnCount} columns</span>
            </div>
            <div className="overflow-x-auto rounded border"><table className="min-w-max text-xs"><tbody>{sheet.sampleRows.map((row) => <tr key={row.rowNumber} className="border-b last:border-0"><th className="bg-muted/50 px-2 py-1 text-right font-mono">{row.rowNumber}</th>{row.cells.map((cell, index) => <td key={index} className="max-w-48 truncate border-l px-2 py-1" title={cell.formula ? "Cached formula value" : cell.display}>{cell.display || " "}{cell.formula ? " [formula]" : ""}</td>)}</tr>)}</tbody></table></div>
            {draft ? <div className="space-y-4 rounded-md bg-muted/25 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-xs font-semibold">Header row<input aria-label={`Header row for ${sheet.name}`} type="number" min={1} max={Math.max(1, sheet.rowCount)} value={draft.headerRow} className="w-24 rounded border bg-background px-2 py-1.5" onChange={(event) => updateDraft(sheet.index, (current) => ({ ...current, headerRow: Number(event.target.value) }))} /></label>
                <button type="button" className="inline-flex items-center gap-1 rounded border px-2 py-1.5 text-xs font-semibold" onClick={() => copySetup(draft)}><Copy className="h-3.5 w-3.5" />Copy setup to exact-header matches</button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{([
                ["name", "Project name", true], ["sourceId", "Source ID", false], ["description", "Description", false], ["estimatedCost", "Estimated cost", false], ["sourceLocation", "Source-location text", false],
              ] as const).map(([key, label, required]) => <label key={key} className="grid gap-1 text-xs font-semibold">{label}{required ? " (required)" : ""}<select aria-label={`${label} for ${sheet.name}`} className="min-w-0 rounded border bg-background px-2 py-1.5 font-normal" value={draft.mapping[key] ?? ""} onChange={(event) => changeMapping(sheet.index, key, event.target.value)}>{!required ? <option value="">Not mapped</option> : null}{headers.map((header, index) => <option key={`${index}-${header}`} value={index}>{index + 1}. {header || "Unnamed column"}</option>)}</select></label>)}</div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-xs font-semibold">Project type<input className="rounded border bg-background px-2 py-1.5" maxLength={80} value={draft.defaults.planType} onChange={(event) => updateDraft(sheet.index, (current) => ({ ...current, defaults: { ...current.defaults, planType: event.target.value } }))} /></label>
                <label className="grid gap-1 text-xs font-semibold">Status<select className="rounded border bg-background px-2 py-1.5" value={draft.defaults.status} onChange={(event) => updateDraft(sheet.index, (current) => ({ ...current, defaults: { ...current.defaults, status: event.target.value as (typeof PROJECT_STATUSES)[number] } }))}>{PROJECT_STATUSES.map((value) => <option key={value} value={value}>{PROJECT_STATUS_LABELS[value]}</option>)}</select></label>
                <label className="grid gap-1 text-xs font-semibold">Delivery phase<select className="rounded border bg-background px-2 py-1.5" value={draft.defaults.deliveryPhase} onChange={(event) => updateDraft(sheet.index, (current) => ({ ...current, defaults: { ...current.defaults, deliveryPhase: event.target.value as (typeof PROJECT_DELIVERY_PHASES)[number] } }))}>{PROJECT_DELIVERY_PHASES.map((value) => <option key={value} value={value}>{PROJECT_DELIVERY_PHASE_LABELS[value]}</option>)}</select></label>
              </div>
              {draft.mapping.estimatedCost !== undefined ? <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-xs font-semibold">Currency<input className="rounded border bg-background px-2 py-1.5 uppercase" maxLength={3} value={draft.defaults.cost?.currency ?? "USD"} onChange={(event) => updateCost(sheet.index, { currency: event.target.value.toUpperCase() })} /></label>
                <label className="grid gap-1 text-xs font-semibold">Scale<select className="rounded border bg-background px-2 py-1.5" value={draft.defaults.cost?.scale ?? "ones"} onChange={(event) => updateCost(sheet.index, { scale: event.target.value as PortfolioCostScale })}><option value="ones">Units</option><option value="thousands">Thousands</option><option value="millions">Millions</option></select></label>
                <label className="grid gap-1 text-xs font-semibold">Price year<input type="number" min={1800} max={3000} className="rounded border bg-background px-2 py-1.5" value={draft.defaults.cost?.priceYear ?? new Date().getFullYear()} onChange={(event) => updateCost(sheet.index, { priceYear: Number(event.target.value) })} /></label>
              </div> : null}
            </div> : null}
          </article>;
        })}
        <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60" disabled={busy || selectedDrafts.length === 0} onClick={() => void previewRows()}>{busy ? "Reviewing…" : "Preview selected worksheets"}</button>
      </div> : null}

      {review ? <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><button type="button" className="rounded-md border px-3 py-2 text-sm font-semibold" onClick={createAllClean}>Create all clean rows</button><button type="button" className="rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-60" disabled={busy} onClick={() => void previewRows()}>{busy ? "Reviewing…" : "Review selections"}</button><span className="text-sm text-muted-foreground">{selectedCount} marked create. Every warning needs row-level confirmation.</span></div>
        <div className="overflow-x-auto rounded-md border"><table className="min-w-[1180px] w-full text-left text-sm"><thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Source row</th><th className="px-3 py-2">Decision</th><th className="px-3 py-2">Project</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Phase</th><th className="px-3 py-2">Review</th></tr></thead><tbody className="divide-y">{review.rows.map((row) => {
          const key = rowKey(row.worksheetIndex, row.rowNumber); const local = rowReviews[key]; const decision = local?.decision ?? row.decision; const blocked = row.state === "blocked" || row.state === "created_before"; const needsName = row.matchingProjectIds.length > 0 || row.matchingBatchRows.length > 0;
          return <tr key={`${key}-${row.fingerprint}`} className="align-top"><td className="px-3 py-3"><p className="font-semibold">{row.worksheetName}</p><p className="font-mono text-xs">row {row.rowNumber}</p></td><td className="px-3 py-3"><select aria-label={`Decision for ${row.worksheetName} row ${row.rowNumber}`} className="rounded border bg-background px-2 py-1" value={decision} disabled={blocked} onChange={(event) => updateRow(row.worksheetIndex, row.rowNumber, { decision: event.target.value as "skip" | "create" })}><option value="skip">Skip</option><option value="create">Create</option></select></td><td className="px-3 py-3"><p className="font-semibold">{row.name || "Missing name"}</p>{row.sourceId ? <p className="text-xs text-muted-foreground">Source ID {row.sourceId}</p> : null}{row.description ? <p className="mt-1 max-w-sm text-xs text-muted-foreground">{row.description}</p> : null}{row.estimatedCost ? <p className="mt-1 text-xs text-muted-foreground">{row.estimatedCost.amount} {row.estimatedCost.currency}, price year {row.estimatedCost.priceYear}</p> : null}{row.sourceLocationText ? <p className="mt-1 text-xs text-muted-foreground">Source says: {row.sourceLocationText}</p> : null}</td><td className="px-3 py-3"><input aria-label={`Project type for ${row.worksheetName} row ${row.rowNumber}`} className="w-40 rounded border bg-background px-2 py-1" value={local?.planType ?? row.planType} disabled={blocked} onChange={(event) => updateRow(row.worksheetIndex, row.rowNumber, { planType: event.target.value })} /></td><td className="px-3 py-3"><select className="rounded border bg-background px-2 py-1" value={local?.status ?? row.status} disabled={blocked} onChange={(event) => updateRow(row.worksheetIndex, row.rowNumber, { status: event.target.value as (typeof PROJECT_STATUSES)[number] })}>{PROJECT_STATUSES.map((value) => <option key={value} value={value}>{PROJECT_STATUS_LABELS[value]}</option>)}</select></td><td className="px-3 py-3"><select className="rounded border bg-background px-2 py-1" value={local?.deliveryPhase ?? row.deliveryPhase} disabled={blocked} onChange={(event) => updateRow(row.worksheetIndex, row.rowNumber, { deliveryPhase: event.target.value as (typeof PROJECT_DELIVERY_PHASES)[number] })}>{PROJECT_DELIVERY_PHASES.map((value) => <option key={value} value={value}>{PROJECT_DELIVERY_PHASE_LABELS[value]}</option>)}</select></td><td className="max-w-sm px-3 py-3 text-xs leading-relaxed"><p className={row.state === "blocked" ? "font-semibold text-destructive" : row.state === "warning" ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>{row.state === "created_before" ? "Already created from this exact source sheet and row. Locked to skip." : rowIssues(row) || "Clean row"}</p>{needsName && decision === "create" ? <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={local?.confirmNameMatch ?? row.confirmNameMatch} onChange={(event) => updateRow(row.worksheetIndex, row.rowNumber, { confirmNameMatch: event.target.checked })} />Create separately despite the normalized-name match</label> : null}{row.formulaFields.length > 0 && decision === "create" ? <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={local?.confirmFormula ?? row.confirmFormula} onChange={(event) => updateRow(row.worksheetIndex, row.rowNumber, { confirmFormula: event.target.checked })} />Use cached formula values for {row.formulaFields.join(", ")}</label> : null}</td></tr>;
        })}</tbody></table></div>
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-4"><div className="text-sm"><strong>{review.counts.rows}</strong> rows from {review.sheets.length} sheets. {review.counts.conflicted} conflicted, {review.counts.invalid} invalid, {review.counts.previouslyCreated} created before.</div><button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60" disabled={busy || !approvedPreviewHash || hasUncreatableSelection || Boolean(committed)} onClick={() => void commitRows()}>{busy ? "Committing one transaction…" : selectedCount > 0 ? `Confirm and create ${selectedCount}` : "Confirm review"}</button>{approvedPreviewHash ? <p className="text-xs text-muted-foreground">Approved preview {approvedPreviewHash.slice(0, 12)}…</p> : <p className="text-xs text-muted-foreground">Review again after every setup or row change.</p>}</div>
        {committed ? <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">Created {committed.created}, skipped {committed.skipped}, conflicted {committed.conflicted}, invalid {committed.invalid}, already created {committed.previouslyCreated}.{committed.projectIds.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{committed.projectIds.map((projectId, index) => <a key={projectId} href={`/projects/${projectId}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"><Link2 className="h-3.5 w-3.5" />Open created project {index + 1}</a>)}</div> : null}</div> : null}
      </div> : null}

      <div className="border-t pt-4"><h3 className="text-sm font-semibold">Recent imports</h3>{historyReadFailed ? <p className="mt-2 text-sm text-destructive">Import history could not be read. This is unavailable, not a finding that no imports exist.</p> : recentImports.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No reviewed portfolio imports have been completed yet.</p> : <div className="mt-3 grid gap-2 lg:grid-cols-2">{recentImports.map((entry) => <article key={entry.id} className="rounded-md border p-3 text-sm"><p className="font-semibold">{entry.sourceTitle || entry.sourceFilename || `Source ${entry.sourceHash.slice(0, 12)}…`}</p><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(entry.importedAt)} · {entry.sourceFormat.toUpperCase()} · {entry.sheetCount} sheet{entry.sheetCount === 1 ? "" : "s"} · {entry.rowCount} rows · {entry.sourceHash.slice(0, 12)}…</p><p className="mt-2 text-xs">Created {entry.createdCount}; skipped {entry.skippedCount}; conflicted {entry.conflictedCount}; invalid {entry.invalidCount}; already created {entry.previouslyCreatedCount}.</p></article>)}</div>}</div>
    </section>
  );
}
