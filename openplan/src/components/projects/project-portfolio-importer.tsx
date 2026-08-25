"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Link2, Upload } from "lucide-react";
import {
  PROJECT_DELIVERY_PHASES,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  PROJECT_DELIVERY_PHASE_LABELS,
} from "@/lib/projects/project-record-fields";
import type {
  PortfolioCostScale,
  PortfolioImportMapping,
  PortfolioImportReview,
  PortfolioImportRowReview,
} from "@/lib/projects/portfolio-import";

type StoredDocument = {
  id: string;
  title: string;
  original_filename?: string | null;
};

export type PortfolioImportSummary = {
  id: string;
  sourceTitle: string | null;
  sourceFilename: string | null;
  sourceHash: string;
  rowCount: number;
  createdCount: number;
  skippedCount: number;
  conflictedCount: number;
  invalidCount: number;
  previouslyCreatedCount: number;
  importedAt: string;
};

type ImportResponse = {
  error?: string;
  code?: string;
  source?: {
    id: string;
    title: string;
    filename: string | null;
    sha256: string;
    byteLength: number;
    originalWorkbook: {
      id: string;
      title: string;
      filename: string | null;
      sha256: string | null;
    } | null;
  };
  review?: PortfolioImportReview;
  committed?: {
    batchId: string;
    created: number;
    skipped: number;
    conflicted: number;
    invalid: number;
    previouslyCreated: number;
    projectIds: string[];
  };
};

type MappingKey = keyof PortfolioImportMapping;

const CSV_MAX_BYTES = 10 * 1024 * 1024;

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function rowIssues(row: PortfolioImportReview["rows"][number]): string {
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
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [originalWorkbookDocumentId, setOriginalWorkbookDocumentId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<PortfolioImportMapping>({ name: 0 });
  const [planType, setPlanType] = useState("capital_program");
  const [status, setStatus] = useState<(typeof PROJECT_STATUSES)[number]>("draft");
  const [deliveryPhase, setDeliveryPhase] =
    useState<(typeof PROJECT_DELIVERY_PHASES)[number]>("programming");
  const [currency, setCurrency] = useState("");
  const [costScale, setCostScale] = useState<PortfolioCostScale>("ones");
  const [priceYear, setPriceYear] = useState("");
  const [review, setReview] = useState<PortfolioImportReview | null>(null);
  const [rowReviews, setRowReviews] = useState<Record<number, PortfolioImportRowReview>>({});
  const [approvedPreviewHash, setApprovedPreviewHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [committed, setCommitted] = useState<ImportResponse["committed"] | null>(null);

  const selectedCount = useMemo(
    () =>
      review?.rows.filter(
        (row) => (rowReviews[row.rowNumber]?.decision ?? row.decision) === "create"
      ).length ?? 0,
    [review, rowReviews]
  );

  function resetStoredFile() {
    setSourceDocumentId(null);
    setOriginalWorkbookDocumentId(null);
    setReview(null);
    setRowReviews({});
    setApprovedPreviewHash(null);
    setCommitted(null);
    setMessage(null);
  }

  function defaults() {
    return {
      planType,
      status,
      deliveryPhase,
      ...(mapping.estimatedCost === undefined
        ? {}
        : {
            cost: {
              currency: currency.trim().toUpperCase(),
              scale: costScale,
              priceYear: Number.parseInt(priceYear, 10),
            },
          }),
    };
  }

  function currentReviews(): PortfolioImportRowReview[] {
    return Object.values(rowReviews).sort((a, b) => a.rowNumber - b.rowNumber);
  }

  async function uploadDocument(file: File): Promise<StoredDocument> {
    const params = new URLSearchParams({
      workspaceId,
      docKind: "other",
      filename: file.name,
      title: `Portfolio import source: ${file.name}`,
    });
    const response = await fetch(`/api/knowledge-base/documents?${params.toString()}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    const payload = (await response.json()) as { error?: string; document?: StoredDocument };
    if (!response.ok || !payload.document) {
      throw new Error(payload.error ?? `Could not store ${file.name}.`);
    }
    return payload.document;
  }

  async function requestReview(input: {
    mode: "preview" | "commit";
    sourceId: string;
    originalId: string | null;
    reviews: PortfolioImportRowReview[];
    approvedHash?: string;
  }): Promise<ImportResponse> {
    const response = await fetch("/api/projects/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: input.mode,
        workspaceId,
        sourceDocumentId: input.sourceId,
        ...(input.originalId ? { originalWorkbookDocumentId: input.originalId } : {}),
        mapping,
        defaults: defaults(),
        rowReviews: input.reviews,
        ...(input.approvedHash ? { approvedPreviewHash: input.approvedHash } : {}),
      }),
    });
    const payload = (await response.json()) as ImportResponse;
    if (!response.ok) throw new Error(payload.error ?? "The portfolio import request failed.");
    return payload;
  }

  function adoptServerReview(payload: ImportResponse, keepLocal: boolean) {
    if (!payload.review) throw new Error("The server returned no row review.");
    setReview(payload.review);
    const next: Record<number, PortfolioImportRowReview> = {};
    for (const row of payload.review.rows) {
      const local = keepLocal ? rowReviews[row.rowNumber] : undefined;
      next[row.rowNumber] = {
        rowNumber: row.rowNumber,
        decision: row.decision,
        confirmNameMatch: row.confirmNameMatch,
        ...(local?.planType ? { planType: row.planType } : {}),
        ...(local?.status ? { status: row.status } : {}),
        ...(local?.deliveryPhase ? { deliveryPhase: row.deliveryPhase } : {}),
      };
    }
    setRowReviews(next);
    setApprovedPreviewHash(payload.review.previewHash);
  }

  async function storeAndInspect() {
    if (!csvFile) return;
    if (csvFile.size > CSV_MAX_BYTES) {
      setMessage("The CSV is larger than 10 MiB. Nothing was uploaded.");
      return;
    }
    if (!/\.csv$/i.test(csvFile.name)) {
      setMessage("Choose a .csv file. XLS, XLSX, and ODS can be retained as the optional original workbook.");
      return;
    }
    if (workbookFile && !/\.(xlsx?|ods)$/i.test(workbookFile.name)) {
      setMessage("The optional original workbook must be an XLS, XLSX, or ODS file.");
      return;
    }

    setBusy(true);
    setMessage(null);
    setApprovedPreviewHash(null);
    try {
      const csvDocument = await uploadDocument(csvFile);
      const workbookDocument = workbookFile ? await uploadDocument(workbookFile) : null;
      setSourceDocumentId(csvDocument.id);
      setOriginalWorkbookDocumentId(workbookDocument?.id ?? null);
      const payload = await requestReview({
        mode: "preview",
        sourceId: csvDocument.id,
        originalId: workbookDocument?.id ?? null,
        reviews: [],
      });
      adoptServerReview(payload, false);
      setMessage(
        `Stored ${csvFile.name}${workbookFile ? ` and linked ${workbookFile.name}` : ""}. Map the columns, then review every row.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not store and inspect the source.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshReview() {
    if (!sourceDocumentId) return;
    setBusy(true);
    setMessage(null);
    setApprovedPreviewHash(null);
    try {
      const payload = await requestReview({
        mode: "preview",
        sourceId: sourceDocumentId,
        originalId: originalWorkbookDocumentId,
        reviews: currentReviews(),
      });
      adoptServerReview(payload, true);
      setMessage("This is the current server review. Confirm only if these are the rows you intend to create.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not review the source.");
    } finally {
      setBusy(false);
    }
  }

  async function commitReview() {
    if (!sourceDocumentId || !approvedPreviewHash) return;
    setBusy(true);
    setMessage(null);
    try {
      const payload = await requestReview({
        mode: "commit",
        sourceId: sourceDocumentId,
        originalId: originalWorkbookDocumentId,
        reviews: currentReviews(),
        approvedHash: approvedPreviewHash,
      });
      setCommitted(payload.committed ?? null);
      setReview(payload.review ?? review);
      setMessage(
        `Import complete. ${payload.committed?.created ?? 0} project${payload.committed?.created === 1 ? "" : "s"} created.`
      );
      router.refresh();
    } catch (error) {
      setApprovedPreviewHash(null);
      setMessage(error instanceof Error ? error.message : "The import did not commit.");
    } finally {
      setBusy(false);
    }
  }

  function changeMapping(key: MappingKey, raw: string) {
    setMapping((current) => {
      const next = { ...current };
      if (raw === "") delete next[key];
      else next[key] = Number.parseInt(raw, 10);
      return next;
    });
    setApprovedPreviewHash(null);
  }

  function updateRow(rowNumber: number, patch: Partial<PortfolioImportRowReview>) {
    setRowReviews((current) => ({
      ...current,
      [rowNumber]: {
        ...current[rowNumber],
        rowNumber,
        decision: current[rowNumber]?.decision ?? "skip",
        ...patch,
      },
    }));
    setApprovedPreviewHash(null);
  }

  function createAllCleanRows() {
    if (!review) return;
    setRowReviews((current) => {
      const next = { ...current };
      for (const row of review.rows) {
        if (row.state !== "clean") continue;
        next[row.rowNumber] = { ...next[row.rowNumber], rowNumber: row.rowNumber, decision: "create" };
      }
      return next;
    });
    setApprovedPreviewHash(null);
  }

  return (
    <section
      id="import-project-list"
      className="module-section-surface w-full min-w-0 max-w-full space-y-5"
    >
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Reviewed upload</p>
          <h2 className="module-section-title">Import project list</h2>
        </div>
        <span className="module-record-chip">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          CSV, create only
        </span>
      </div>

      <p className="max-w-5xl text-sm leading-relaxed text-muted-foreground">
        Store the source, map its columns, and decide row by row. Every valid row starts as skip.
        This importer never updates or merges projects. XLS, XLSX, and ODS are retained only as an
        optional original workbook; save the sheet you want to import as CSV.
      </p>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          CSV project list, up to 2,000 rows and 10 MiB
          <input
            type="file"
            accept=".csv,text/csv"
            className="w-full min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-sm"
            onChange={(event) => {
              setCsvFile(event.target.files?.[0] ?? null);
              resetStoredFile();
            }}
          />
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm font-medium">
          Original workbook, optional
          <input
            type="file"
            accept=".xls,.xlsx,.ods"
            className="w-full min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-sm"
            onChange={(event) => {
              setWorkbookFile(event.target.files?.[0] ?? null);
              resetStoredFile();
            }}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          disabled={!csvFile || busy}
          onClick={() => void storeAndInspect()}
        >
          <Upload className="h-4 w-4" />
          {busy && !sourceDocumentId ? "Storing source…" : "Store source and read headers"}
        </button>
        {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
      </div>

      {review ? (
        <>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-relaxed">
            <strong>Location text is not verified geography.</strong> OpenPlan keeps it only in the
            import history. It does not set a project place, study area, bounding box, coordinates, or
            geometry.
          </div>

          <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {(
              [
                ["name", "Project name", true],
                ["sourceId", "Source ID", false],
                ["description", "Description", false],
                ["estimatedCost", "Estimated cost", false],
                ["sourceLocation", "Source-location text", false],
              ] as const
            ).map(([key, label, required]) => (
              <label key={key} className="grid min-w-0 gap-1 text-xs font-semibold">
                {label}{required ? " (required)" : ""}
                <select
                  aria-label={`${label}${required ? " (required)" : ""}`}
                  className="w-full min-w-0 rounded-md border bg-background px-2 py-2 text-sm font-normal"
                  value={mapping[key] ?? ""}
                  onChange={(event) => changeMapping(key, event.target.value)}
                >
                  {!required ? <option value="">Not mapped</option> : null}
                  {review.headers.map((header, index) => (
                    <option key={`${index}-${header}`} value={index}>
                      {index + 1}. {header || "Unnamed column"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {review.duplicateHeaders.length > 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Repeated header names are shown with column numbers. Mappings use those numbers, not the
              repeated text.
            </p>
          ) : null}

          <div className="grid min-w-0 gap-4 md:grid-cols-3">
            <label className="grid min-w-0 gap-1 text-sm font-medium">
              File-wide project type
              <input
                className="w-full min-w-0 rounded-md border bg-background px-3 py-2"
                value={planType}
                maxLength={80}
                onChange={(event) => { setPlanType(event.target.value); setApprovedPreviewHash(null); }}
              />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-medium">
              File-wide status
              <select className="w-full min-w-0 rounded-md border bg-background px-3 py-2" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setApprovedPreviewHash(null); }}>
                {PROJECT_STATUSES.map((value) => <option key={value} value={value}>{PROJECT_STATUS_LABELS[value]}</option>)}
              </select>
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-medium">
              File-wide delivery phase
              <select className="w-full min-w-0 rounded-md border bg-background px-3 py-2" value={deliveryPhase} onChange={(event) => { setDeliveryPhase(event.target.value as typeof deliveryPhase); setApprovedPreviewHash(null); }}>
                {PROJECT_DELIVERY_PHASES.map((value) => <option key={value} value={value}>{PROJECT_DELIVERY_PHASE_LABELS[value]}</option>)}
              </select>
            </label>
          </div>

          {mapping.estimatedCost !== undefined ? (
            <div className="grid min-w-0 gap-4 rounded-md border p-4 md:grid-cols-3">
              <label className="grid min-w-0 gap-1 text-sm font-medium">Three-letter currency<input className="w-full min-w-0 rounded-md border bg-background px-3 py-2 uppercase" maxLength={3} placeholder="USD" value={currency} onChange={(event) => { setCurrency(event.target.value.toUpperCase()); setApprovedPreviewHash(null); }} /></label>
              <label className="grid min-w-0 gap-1 text-sm font-medium">Scale<select className="w-full min-w-0 rounded-md border bg-background px-3 py-2" value={costScale} onChange={(event) => { setCostScale(event.target.value as PortfolioCostScale); setApprovedPreviewHash(null); }}><option value="ones">Units</option><option value="thousands">Thousands</option><option value="millions">Millions</option></select></label>
              <label className="grid min-w-0 gap-1 text-sm font-medium">Price year<input className="w-full min-w-0 rounded-md border bg-background px-3 py-2" type="number" min={1800} max={3000} value={priceYear} onChange={(event) => { setPriceYear(event.target.value); setApprovedPreviewHash(null); }} /></label>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="rounded-md border px-3 py-2 text-sm font-semibold" onClick={createAllCleanRows}>Create all clean rows</button>
            <button type="button" className="rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-60" disabled={busy} onClick={() => void refreshReview()}>{busy ? "Reviewing…" : "Review selections"}</button>
            <span className="text-sm text-muted-foreground">{selectedCount} marked create. Warnings always require an individual confirmation.</span>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-[1120px] w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Decision</th><th className="px-3 py-2">Project</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Phase</th><th className="px-3 py-2">Review</th></tr>
              </thead>
              <tbody className="divide-y">
                {review.rows.map((row) => {
                  const local = rowReviews[row.rowNumber];
                  const decision = local?.decision ?? row.decision;
                  const blocked = row.state === "blocked" || row.state === "created_before";
                  const needsNameConfirmation = row.warnings.some((entry) => entry.code === "name_match");
                  return (
                    <tr key={`${row.rowNumber}-${row.fingerprint}`} className="align-top">
                      <td className="px-3 py-3 font-mono text-xs">{row.rowNumber}</td>
                      <td className="px-3 py-3"><select aria-label={`Decision for CSV row ${row.rowNumber}`} className="rounded border bg-background px-2 py-1" value={decision} disabled={blocked} onChange={(event) => updateRow(row.rowNumber, { decision: event.target.value as "skip" | "create" })}><option value="skip">Skip</option><option value="create">Create</option></select></td>
                      <td className="px-3 py-3"><p className="font-semibold">{row.name || "Missing name"}</p>{row.sourceId ? <p className="text-xs text-muted-foreground">Source ID {row.sourceId}</p> : null}{row.description ? <p className="mt-1 max-w-sm text-xs text-muted-foreground">{row.description}</p> : null}{row.estimatedCost ? <p className="mt-1 text-xs text-muted-foreground">{row.estimatedCost.amount} {row.estimatedCost.currency}, price year {row.estimatedCost.priceYear}</p> : null}{row.sourceLocationText ? <p className="mt-1 text-xs text-muted-foreground">Source says: {row.sourceLocationText}</p> : null}</td>
                      <td className="px-3 py-3"><input aria-label={`Project type for CSV row ${row.rowNumber}`} className="w-40 rounded border bg-background px-2 py-1" value={local?.planType ?? row.planType} disabled={blocked} onChange={(event) => updateRow(row.rowNumber, { planType: event.target.value })} /></td>
                      <td className="px-3 py-3"><select aria-label={`Status for CSV row ${row.rowNumber}`} className="rounded border bg-background px-2 py-1" value={local?.status ?? row.status} disabled={blocked} onChange={(event) => updateRow(row.rowNumber, { status: event.target.value as typeof status })}>{PROJECT_STATUSES.map((value) => <option key={value} value={value}>{PROJECT_STATUS_LABELS[value]}</option>)}</select></td>
                      <td className="px-3 py-3"><select aria-label={`Delivery phase for CSV row ${row.rowNumber}`} className="rounded border bg-background px-2 py-1" value={local?.deliveryPhase ?? row.deliveryPhase} disabled={blocked} onChange={(event) => updateRow(row.rowNumber, { deliveryPhase: event.target.value as typeof deliveryPhase })}>{PROJECT_DELIVERY_PHASES.map((value) => <option key={value} value={value}>{PROJECT_DELIVERY_PHASE_LABELS[value]}</option>)}</select></td>
                      <td className="max-w-xs px-3 py-3 text-xs leading-relaxed"><p className={row.state === "blocked" ? "font-semibold text-destructive" : row.state === "warning" ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>{row.state === "created_before" ? "Already created from this exact source row. Locked to skip." : rowIssues(row) || "Clean row"}</p>{needsNameConfirmation && decision === "create" ? <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={local?.confirmNameMatch ?? row.confirmNameMatch} onChange={(event) => updateRow(row.rowNumber, { confirmNameMatch: event.target.checked })} />Create a separate project despite the name match</label> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-md border p-4">
            <div className="text-sm"><strong>{review.counts.rows}</strong> rows. {review.counts.conflicted} conflicted, {review.counts.invalid} invalid, {review.counts.previouslyCreated} created before.</div>
            <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60" disabled={busy || !approvedPreviewHash || Boolean(committed)} onClick={() => void commitReview()}>{busy ? "Committing one transaction…" : selectedCount > 0 ? `Confirm and create ${selectedCount}` : "Confirm review"}</button>
            {!approvedPreviewHash ? <p className="text-xs text-muted-foreground">Review selections after every mapping, default, or row change.</p> : <p className="text-xs text-muted-foreground">Approved preview {approvedPreviewHash.slice(0, 12)}…</p>}
          </div>

          {committed ? (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
              Created {committed.created}, skipped {committed.skipped}, conflicted {committed.conflicted}, invalid {committed.invalid}, already created {committed.previouslyCreated}.
              {committed.projectIds.length > 0 ? <div className="mt-2 flex flex-wrap gap-2">{committed.projectIds.map((projectId, index) => <a key={projectId} href={`/projects/${projectId}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"><Link2 className="h-3.5 w-3.5" />Open created project {index + 1}</a>)}</div> : null}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold">Recent imports</h3>
        {historyReadFailed ? (
          <p className="mt-2 text-sm text-destructive">Import history could not be read. This is unavailable, not a finding that no imports exist.</p>
        ) : recentImports.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No reviewed portfolio imports have been completed yet.</p>
        ) : (
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {recentImports.map((entry) => (
              <article key={entry.id} className="rounded-md border p-3 text-sm">
                <p className="font-semibold">{entry.sourceTitle || entry.sourceFilename || `Source ${entry.sourceHash.slice(0, 12)}…`}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(entry.importedAt)} · {entry.rowCount} rows · {entry.sourceHash.slice(0, 12)}…</p>
                <p className="mt-2 text-xs">Created {entry.createdCount}; skipped {entry.skippedCount}; conflicted {entry.conflictedCount}; invalid {entry.invalidCount}; already created {entry.previouslyCreatedCount}.</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
