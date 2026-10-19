"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { RTP_EXTRACTION_TARGET_KINDS, RTP_EXTRACTION_TARGETS, type RtpExtractionTargetKind } from "@/lib/rtp/extraction/contract";
import { retainedPageSchema, type RetainedSourcePage } from "@/lib/rtp/extraction/source-pages";

const fieldLabels: Record<string, string> = {
  entryKind: "Revenue or cost category", sourceName: "Source or cost item name", amount: "Amount in whole dollars",
  amountBasisYear: "Dollar year", horizonBandLabel: "Planning period as printed", label: "Name as printed",
  unit: "Unit", baselineValue: "Baseline value", baselineYear: "Baseline year", targetValue: "Target value",
  targetYear: "Target year", dataSource: "Measurement source", startYear: "First year", endYear: "Last year",
  escalationTargetYear: "Escalation dollar year", costEstimateBasis: "Cost estimate basis",
  projectName: "Project name as printed", estimatedCost: "Project cost in whole dollars", costBasisYear: "Cost dollar year",
  portfolioRole: "Project classification", financialBasisYear: "Plan-wide dollar year", text: "Copied chapter text",
};
const kindHelp: Record<RtpExtractionTargetKind, string> = {
  financial_line: "Copy one stated revenue or cost row, excluding totals, subtotals and balances. Do not add rows or fill a missing amount.",
  performance_measure: "Copy one measure and its stated baseline or target. Leave missing measurements blank.",
  horizon_band: "Copy one planning period. Enter an escalation year only when this page states it.",
  programmed_project: "Copy one project name and any stated cost. Review and match the project separately; an unknown cost stays blank.",
  cycle_financial_basis: "Copy the year that defines the plan's dollar basis. Enter any inflation assumption separately during plan review.",
  chapter_block: "Copy the policy or goal text word for word, up to 4,000 characters. This same text is the quote; whitespace may normalize. Choose its chapter through Place copied chapter text after staging.",
};
const draftSchema = z.object({ requestId: z.string(), kbDocumentId: z.string(), documentExtractionId: z.string(),
  sourcePage: z.number().int().positive(), targetKind: z.enum(RTP_EXTRACTION_TARGET_KINDS), quote: z.string(), fields: z.record(z.string(), z.string()) });
type Draft = z.infer<typeof draftSchema>;
const initialDraft: Draft = { requestId: "", kbDocumentId: "", documentExtractionId: "", sourcePage: 1, targetKind: "financial_line", quote: "", fields: {} };
const versionsSchema = z.object({ extractions: z.array(z.object({ id: z.string().uuid(), created_at: z.string(), page_count: z.number() })),
  workerConfigured: z.boolean(), latestJob: z.object({ status: z.string(), failure_detail: z.string().nullable().optional() }).nullable() });

export function ManualSourceIntake({ rtpCycleId, actorId, documents, canWrite }: {
  rtpCycleId: string; actorId: string; documents: Array<{ id: string; title: string }>; canWrite: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [hydrated, setHydrated] = useState(false);
  const [source, setSource] = useState<RetainedSourcePage | null>(null);
  const [versions, setVersions] = useState<Array<{ id: string; created_at: string; page_count: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState("Draft recovery stays in this browser tab. Reopen the retained page after reloading.");
  const storageKey = `rtp-manual-source:${actorId}:${rtpCycleId}`;
  useEffect(() => {
    try {
      const retained = sessionStorage.getItem(storageKey);
      if (retained) {
        const parsed = draftSchema.safeParse(JSON.parse(retained));
        if (parsed.success) { setDraft(parsed.data); setRecovery("Draft restored in this tab. Reload versions and open the selected page before staging."); }
        else setRecovery("The saved draft could not be restored. Keep a separate copy before reloading.");
      }
    } catch { setRecovery("Draft recovery is unavailable. Keep a separate copy before reloading."); }
    setHydrated(true);
  }, [storageKey]);
  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); }
    catch { setRecovery("This tab cannot save draft recovery. Copy your quote and values before reloading."); }
  }, [draft, hydrated, storageKey]);

  function update(patch: Partial<Draft>) { setDraft((current) => ({ ...current, ...patch })); }
  async function loadVersions() {
    setBusy(true); setSource(null); setVersions([]); setMessage("");
    try {
      const response = await fetch(`/api/knowledge-base/documents/${draft.kbDocumentId}/ocr`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Retained versions could not be read.");
      const parsed = versionsSchema.safeParse(payload);
      if (!parsed.success) throw new Error("Retained version status could not be interpreted. Keep your draft and retry.");
      const data = parsed.data;
      setVersions(data.extractions);
      if (!data.extractions.length) setMessage(`No retained page version is available. Latest reading: ${data.latestJob?.status ?? "not requested"}. ${data.latestJob?.failure_detail ?? ""} ${data.workerConfigured ? "Use Documents to request local text reading or OCR, then reload versions." : "A text/OCR worker is unavailable on this installation. The retained original remains available in Documents."}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Retained versions are unavailable."); }
    finally { setBusy(false); }
  }
  async function openPage() {
    setBusy(true); setSource(null); setMessage("");
    try {
      const query = new URLSearchParams({ kbDocumentId: draft.kbDocumentId, documentExtractionId: draft.documentExtractionId, page: String(draft.sourcePage) });
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/extraction-source-pages?${query}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "This retained page is unavailable.");
      const parsed = retainedPageSchema.safeParse(payload);
      if (!parsed.success) throw new Error("The retained page response is incomplete. Nothing can be staged from it; keep your draft and retry.");
      setSource(parsed.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "This retained page is unavailable."); }
    finally { setBusy(false); }
  }
  async function stage() {
    if (!source) return;
    const requestId = draft.requestId || crypto.randomUUID();
    update({ requestId }); setBusy(true); setMessage("");
    const fields = Object.fromEntries(RTP_EXTRACTION_TARGETS[draft.targetKind].fields.map((field) => [field.key,
      field.kind === "verbatim_block" ? draft.quote : (draft.fields[`${draft.targetKind}:${field.key}`] ?? "")]));
    try {
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/extraction-candidates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        requestId, kbDocumentId: draft.kbDocumentId, documentExtractionId: draft.documentExtractionId,
        sourcePage: draft.sourcePage, documentChecksum: source.checksum, contentSha256: source.contentSha256,
        targetKind: draft.targetKind, quote: draft.quote, fields,
      }) });
      const payload = await response.json();
      if (!response.ok) throw new Error([payload.error, ...(Array.isArray(payload.details) ? payload.details : []).map((detail: { field: string | null; message: string }) => `${detail.field ? `${fieldLabels[detail.field] ?? "Value"}: ` : ""}${detail.message}`)].filter(Boolean).join(" "));
      setMessage(payload.deduped ? "This same proposal is already retained. Review it below or use Place copied chapter text." : "Proposal retained for review. Review it below or use Place copied chapter text. No plan text or figures changed.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The save could not be confirmed. Retry the same proposal."); }
    finally { setBusy(false); }
  }
  const spec = RTP_EXTRACTION_TARGETS[draft.targetKind];
  return <details className="mt-4 rounded border p-4">
    <summary className="cursor-pointer font-semibold">Enter from source page</summary>
    <p className="my-3 text-sm">Stage one quoted source item without an AI account. This reads one retained page at a time, up to 200,000 characters. It does not establish complete predecessor coverage, source authority or adoption.</p>
    <p className="text-sm">Blank values stay unknown. Enter exact whole dollars without rounding. Classifications need your review. The verifier checks presence, not column attribution, units or OCR accuracy. Tables across pages, maps and unextractable material remain unresolved.</p>
    <p className="my-2 text-sm"><Link className="underline" href="/knowledge-base">Open Documents for the retained original and local text/OCR reading</Link>. Retained text is required for verified proposals.</p>
    <p role="status" className="my-2 text-sm">{recovery}</p>
    <fieldset disabled={!canWrite || busy || !hydrated} className="space-y-3 disabled:opacity-60">
      <label className="block">Source document<select className="mt-1 block w-full rounded border bg-background p-2" value={draft.kbDocumentId} onChange={(event) => { update({ kbDocumentId: event.target.value, documentExtractionId: "", sourcePage: 1 }); setSource(null); setVersions([]); }}>
        <option value="">Choose a document</option>{documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
      </select></label>
      <button type="button" className="module-inline-action" disabled={!draft.kbDocumentId} onClick={loadVersions}>Load retained versions</button>
      <label className="block">Retained text version<select className="mt-1 block w-full rounded border bg-background p-2" value={draft.documentExtractionId} onChange={(event) => { update({ documentExtractionId: event.target.value }); setSource(null); }}>
        <option value="">Choose a version</option>{versions.map((version) => <option key={version.id} value={version.id}>{new Date(version.created_at).toLocaleString("en-US")} · {version.page_count} pages · {version.id}</option>)}
      </select></label>
      <label className="block">PDF page number<input className="mt-1 block w-full rounded border bg-background p-2" type="number" min={1} value={draft.sourcePage} onChange={(event) => { const page = Number(event.target.value); if (Number.isInteger(page) && page > 0) update({ sourcePage: page }); setSource(null); }} /></label>
      <button type="button" className="module-inline-action" disabled={!draft.documentExtractionId} onClick={openPage}>Open retained page</button>
      {source ? <section aria-label="Retained source page" className="min-w-0 space-y-2">
        <p className="text-sm">Page {source.page} of {source.pageCount}. {source.source === "ocr" ? "Text recognised from a scan" : "PDF text layer"}. Retained version <span className="break-all">{source.extractionId}</span>.</p>
        <a className="text-sm underline" href={`/api/knowledge-base/documents/${source.documentId}/download`}>Download retained original</a>
        <details><summary>Source identity</summary><p className="break-all text-xs">Original checksum: {source.checksum}<br />Retained content checksum: {source.contentSha256}</p></details>
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded border p-3 text-sm" tabIndex={0}>{source.text}</pre>
      </section> : null}
      <label className="block">Source record<select className="mt-1 block w-full rounded border bg-background p-2" value={draft.targetKind} onChange={(event) => update({ targetKind: event.target.value as RtpExtractionTargetKind })}>
        {RTP_EXTRACTION_TARGET_KINDS.map((kind) => <option key={kind} value={kind}>{RTP_EXTRACTION_TARGETS[kind].label}</option>)}
      </select></label>
      <p className="text-sm">{kindHelp[draft.targetKind]}</p>
      <label className="block">{draft.targetKind === "chapter_block" ? "Verbatim chapter text and source quote" : "Short source quote containing these values"}<textarea className="mt-1 block min-h-28 w-full rounded border bg-background p-2" maxLength={draft.targetKind === "chapter_block" ? 4000 : 8000} value={draft.quote} onChange={(event) => update({ quote: event.target.value })} /></label>
      {spec.fields.filter((field) => field.kind !== "verbatim_block").map((field) => {
        const key = `${draft.targetKind}:${field.key}`;
        return <label className="block" key={key}>{fieldLabels[field.key] ?? field.key} {field.required ? "(required)" : "(optional, leave blank if unknown)"}
          {field.kind === "classification" ? <select className="mt-1 block w-full rounded border bg-background p-2" value={draft.fields[key] ?? ""} onChange={(event) => update({ fields: { ...draft.fields, [key]: event.target.value } })}>
            <option value="">Not stated / choose for review</option>{field.enumValues?.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select> : <input className="mt-1 block w-full rounded border bg-background p-2" inputMode={field.kind === "numeric" ? "decimal" : "text"} maxLength={field.maxChars ?? 200} value={draft.fields[key] ?? ""} onChange={(event) => update({ fields: { ...draft.fields, [key]: event.target.value } })} />}
          <span className="block text-xs text-muted-foreground">{field.describe}</span>
        </label>;
      })}
      <div className="flex flex-wrap gap-3"><button type="button" className="module-inline-action" disabled={!source || !draft.quote} onClick={stage}>{busy ? "Saving proposal…" : "Stage source proposal"}</button>
        <button type="button" className="module-inline-action" onClick={() => { update({ requestId: "" }); setMessage("New proposal started. Enter the next source record before staging."); }}>Start a new proposal</button></div>
      <p className="text-sm">Retry unchanged work with the same request. After changing a saved or uncertain request, start a new proposal explicitly. Earlier proposals remain available.</p>
    </fieldset>
    {!canWrite ? <p className="text-sm">Your role has read-only access.</p> : null}
    {message ? <p role="status" className="mt-3 whitespace-pre-wrap text-sm">{message}</p> : null}
  </details>;
}
