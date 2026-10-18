"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { SAFETY_SEED_CAVEAT } from "@/lib/grants/safety-seed-origin";
import type { ReportArtifactAttachOption } from "./funding-opportunity-application-workspace";

type Preview = { artifactId: string; previewHash: string; snapshotHash: string; sections: { section_key: string; draft_markdown: string }[] };
const sourcePageSchema = z.object({
  artifacts: z.array(z.object({ id: z.string().uuid(), reportTitle: z.string(), artifactKind: z.enum(["html", "pdf"]), generatedAt: z.string().nullable() })).max(50),
  nextCursor: z.string().uuid().nullable(), requiresProject: z.boolean(),
});

/** Selection and apply are explicit; a preview never writes application content. */
export function SafetyPlanSeedPanel({ opportunityId, onApplied }: {
  opportunityId: string; onApplied: () => Promise<void>;
}) {
  const [artifacts, setArtifacts] = useState<ReportArtifactAttachOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingSources, setLoadingSources] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [requiresProject, setRequiresProject] = useState(false);
  const sourceRequest = useRef<AbortController | null>(null);
  const [artifactId, setArtifactId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadSources = useCallback(async (cursor: string | null) => {
    sourceRequest.current?.abort();
    const controller = new AbortController(); sourceRequest.current = controller;
    const signal = controller.signal;
    setLoadingSources(true); setSourceError(null);
    try {
      const suffix = cursor ? `?before=${encodeURIComponent(cursor)}` : "";
      const response = await fetch(`/api/funding-opportunities/${opportunityId}/application/safety-seed${suffix}`, { signal });
      const raw = await response.json();
      if (!response.ok) throw new Error(raw.error || "Safety report artifacts could not be loaded");
      const parsed = sourcePageSchema.safeParse(raw);
      if (!parsed.success) throw new Error("Safety source response is unavailable");
      const payload = parsed.data;
      if (signal.aborted) return;
      setArtifacts((previous) => cursor ? [...previous, ...payload.artifacts.filter((row: ReportArtifactAttachOption) => !previous.some((prior) => prior.id === row.id))] : payload.artifacts);
      setNextCursor(payload.nextCursor); setRequiresProject(payload.requiresProject);
    } catch (caught) {
      if (!signal.aborted) setSourceError(caught instanceof Error ? caught.message : "Safety source read failed");
    } finally { if (!signal.aborted) setLoadingSources(false); }
  }, [opportunityId]);

  useEffect(() => {
    setArtifacts([]); setArtifactId(""); setPreview(null); setMessage(null); setError(null);
    void loadSources(null);
    return () => sourceRequest.current?.abort();
  }, [loadSources]);

  async function operate(operation: "preview" | "apply") {
    if (!artifactId || (operation === "apply" && !preview)) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/funding-opportunities/${opportunityId}/application/safety-seed`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation, artifactId, ...(operation === "apply" ? { previewHash: preview!.previewHash } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 409 || response.status === 422) setPreview(null);
        throw new Error(payload.error || "Safety seed request failed");
      }
      if (operation === "preview") setPreview(payload.preview as Preview);
      else {
        setMessage(payload.replayed ? "This seed was already applied. Its existing six drafts are retained." : "Six working drafts added. Final text, prior drafts and attachments are retained.");
        setPreview(null);
        await onApplied();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Safety seed request failed");
    } finally { setBusy(false); }
  }

  return <div className="space-y-3 rounded-xl border border-border p-4" data-testid="safety-plan-seed-panel">
    <h3 className="font-semibold">Seed from Safety plan</h3>
    <p className="text-sm text-muted-foreground">{SAFETY_SEED_CAVEAT}</p>
    <label className="block space-y-1 text-sm">
      <span>Exact project report artifact</span>
      <select className="w-full min-w-0 rounded border bg-background p-2" value={artifactId} disabled={busy}
        onChange={(event) => { setArtifactId(event.target.value); setPreview(null); setMessage(null); setError(null); }}>
        <option value="">Select a generated artifact</option>
        {artifacts.map((artifact) => <option key={artifact.id} value={artifact.id}>
          {artifact.reportTitle} · {artifact.generatedAt ?? "Date not recorded"} · {artifact.id}
        </option>)}
      </select>
    </label>
    {loadingSources ? <p className="text-sm">Loading linked-project Safety artifacts.</p> : null}
    {sourceError ? <p role="alert" className="text-sm text-destructive">{sourceError}</p> : null}
    {!loadingSources && !sourceError && !artifacts.length ? <p className="text-sm">{requiresProject ? "Link this opportunity to the Safety report project first." : "No Safety artifacts are listed for this project. Generate a Safety report for the selected acquisition first."}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy || loadingSources} onClick={() => { setArtifactId(""); setPreview(null); void loadSources(null); }}>Refresh Safety sources</Button>
      {nextCursor ? <Button type="button" variant="outline" disabled={busy || loadingSources} onClick={() => void loadSources(nextCursor)}>Load more Safety artifacts</Button> : null}
    </div>
    <Button type="button" variant="outline" disabled={!artifactId || busy} onClick={() => void operate("preview")}>Preview Safety seed</Button>
    {preview ? <div className="space-y-3">
      <p className="break-all text-xs">Artifact {preview.artifactId}. Snapshot SHA-256 {preview.snapshotHash}.</p>
      <p className="text-sm">Review all six working drafts. Apply appends history and keeps existing final text.</p>
      {preview.sections.map((section) => <details key={section.section_key} className="rounded border p-2">
        <summary>{section.section_key}</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words text-sm">{section.draft_markdown}</pre>
      </details>)}
      <Button type="button" disabled={busy} onClick={() => void operate("apply")}>Apply six working drafts</Button>
    </div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </div>;
}
