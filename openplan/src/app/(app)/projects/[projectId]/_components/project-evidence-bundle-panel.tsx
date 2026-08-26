"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Archive, Download, Loader2, ShieldAlert } from "lucide-react";
import { ModalDialog } from "@/components/ui/modal-dialog";
import type {
  ProjectEvidenceCandidate,
  ProjectEvidenceCandidateInventory,
} from "@/lib/project-evidence-bundles/contracts";

type InventoryResponse = ProjectEvidenceCandidateInventory & {
  readFailed: boolean;
  failureMessage: string | null;
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function sourceGroups(candidates: ProjectEvidenceCandidate[]) {
  const groups = new Map<string, ProjectEvidenceCandidate[]>();
  for (const candidate of candidates) {
    const current = groups.get(candidate.sourceLabel) ?? [];
    current.push(candidate);
    groups.set(candidate.sourceLabel, current);
  }
  return [...groups.entries()];
}

function BundleReviewDialog({
  inventory,
  canGenerate,
  projectId,
  onClose,
  onCreated,
}: {
  inventory: InventoryResponse;
  canGenerate: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (downloadHref: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const detailId = useId();
  const [selected, setSelected] = useState(
    () => new Set(inventory.candidates.filter((candidate) => candidate.defaultSelected).map((candidate) => candidate.id))
  );
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState<"idle" | "freezing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [downloadHref, setDownloadHref] = useState<string | null>(null);

  const selectedCandidates = inventory.candidates.filter((candidate) => selected.has(candidate.id));
  const selectedFileCount = selectedCandidates.filter((candidate) => !candidate.required).length;
  const knownSelectedBytes = selectedCandidates.reduce((sum, candidate) => sum + (candidate.byteSize ?? 0), 0);
  const canSubmit =
    canGenerate &&
    confirmed &&
    !inventory.readFailed &&
    selectedFileCount <= inventory.limits.selectedFileLimit &&
    knownSelectedBytes <= inventory.limits.totalSelectedFileBytes &&
    progress === "idle";

  async function freezeBundle() {
    setProgress("freezing");
    setError(null);
    setDownloadHref(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/evidence-bundles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectRevision: inventory.projectRevision,
          confirmed: true,
          selected: selectedCandidates.map((candidate) => ({
            candidateId: candidate.id,
            revisionToken: candidate.revisionToken,
          })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; detail?: string; downloadHref?: string }
        | null;
      if (!response.ok || !payload?.downloadHref) {
        throw new Error(payload?.detail ?? payload?.error ?? "OpenPlan could not freeze the bundle.");
      }
      setDownloadHref(payload.downloadHref);
      onCreated(payload.downloadHref);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OpenPlan could not freeze the bundle.");
    } finally {
      setProgress("idle");
    }
  }

  const grouped = sourceGroups(inventory.candidates);
  return (
    <ModalDialog
      titleId={titleId}
      descriptionId={detailId}
      onRequestClose={onClose}
      closeBlocked={progress !== "idle"}
      initialFocusRef={closeRef}
      className="m-auto max-h-[92dvh] w-[min(58rem,calc(100vw-1.5rem))] overflow-hidden rounded-[0.5rem] border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="flex max-h-[92dvh] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">Review project evidence bundle</h2>
            <p id={detailId} className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Choose the files to freeze beside the project details, source history, modeling evidence, and GeoPackage.
              This creates a retained snapshot. It does not approve, adopt, or publish anything.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={progress !== "idle"}
            className="rounded-[0.35rem] border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Close
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          {inventory.readFailed ? (
            <div role="alert" className="mb-4 rounded-[0.45rem] border border-destructive/40 bg-destructive/10 p-3 text-sm">
              OpenPlan could not read every source, so it will not generate a bundle. {inventory.failureMessage}
            </div>
          ) : null}
          {inventory.inventoryTruncated ? (
            <div role="status" className="mb-4 rounded-[0.45rem] border border-amber-400/50 bg-amber-400/10 p-3 text-sm">
              Review stops at {inventory.limits.reviewCandidateLimit} candidates. Later records remain outside this bundle and the manifest records the limit.
            </div>
          ) : null}
          <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span>{selectedCandidates.length} selected</span>
            <span>{formatBytes(knownSelectedBytes)} known selected size</span>
            <span>{inventory.limits.selectedFileLimit} optional-file limit</span>
            <span>{formatBytes(inventory.limits.totalSelectedFileBytes)} total limit</span>
          </div>

          <div className="space-y-6">
            {grouped.map(([label, candidates]) => (
              <fieldset key={label} className="space-y-2">
                <legend className="module-section-label">{label}</legend>
                {candidates.map((candidate) => {
                  const tooLarge =
                    candidate.byteSize !== null && candidate.byteSize > inventory.limits.perFileBytes;
                  const disabled = candidate.required || !candidate.selectable || tooLarge || progress !== "idle";
                  return (
                    <label
                      key={candidate.id}
                      className="flex cursor-pointer items-start gap-3 rounded-[0.45rem] border border-border px-3 py-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={selected.has(candidate.id)}
                        disabled={disabled}
                        onChange={(event) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(candidate.id);
                            else next.delete(candidate.id);
                            return next;
                          });
                          setConfirmed(false);
                        }}
                        aria-label={`Include ${candidate.title}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                          <span className="break-words">{candidate.title}</span>
                          {candidate.required ? <span className="text-xs text-muted-foreground">Required</span> : null}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {formatBytes(candidate.byteSize)} · {candidate.custodyState.replaceAll("_", " ")} · {candidate.retrievalState.replaceAll("_", " ")}
                        </span>
                        {candidate.exclusionReason ? (
                          <span className="mt-1 block text-xs text-amber-700 dark:text-amber-200">{candidate.exclusionReason}</span>
                        ) : null}
                        {tooLarge ? (
                          <span className="mt-1 block text-xs text-amber-700 dark:text-amber-200">
                            Reference only. This file exceeds the {formatBytes(inventory.limits.perFileBytes)} per-file limit.
                          </span>
                        ) : null}
                        {candidate.knownLimits.map((limit) => (
                          <span key={limit} className="mt-1 block text-xs text-muted-foreground">{limit}</span>
                        ))}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </div>

        <footer className="border-t border-border bg-muted/20 px-5 py-4">
          {!canGenerate ? (
            <p className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Viewers can review candidates and download ready bundles, but cannot create a retained file.
            </p>
          ) : (
            <label className="mb-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={progress !== "idle"}
              />
              <span>I reviewed this exact selection and understand that the bundle may contain sensitive project files.</span>
            </label>
          )}
          {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
          {downloadHref ? (
            <a
              href={downloadHref}
              className="mb-3 inline-flex items-center gap-2 rounded-[0.4rem] border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium"
            >
              <Download className="h-4 w-4" /> Download frozen bundle
            </a>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={progress !== "idle"}
              className="rounded-[0.35rem] border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={freezeBundle}
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-[0.35rem] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {progress === "freezing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
              {progress === "freezing" ? "Freezing bundle…" : "Freeze evidence bundle"}
            </button>
          </div>
        </footer>
      </div>
    </ModalDialog>
  );
}

export function ProjectEvidenceBundlePanel({ projectId, canGenerate }: { projectId: string; canGenerate: boolean }) {
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/evidence-bundles/candidates`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as InventoryResponse | { error?: string } | null;
      if (!response.ok || !payload || !("candidates" in payload)) {
        throw new Error(payload && "error" in payload ? payload.error : "Evidence candidates could not be loaded.");
      }
      setInventory(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Evidence candidates could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const readyBundles = useMemo(
    () => inventory?.priorBundles.filter((bundle) => bundle.status === "ready") ?? [],
    [inventory]
  );

  return (
    <div className="mb-6 rounded-[0.5rem] border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Frozen project handoff</p>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Review candidate files, freeze their source history and gaps, then download one standard ZIP.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReviewOpen(true)}
          disabled={loading || !inventory}
          className="inline-flex items-center gap-2 rounded-[0.4rem] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
          Prepare evidence bundle
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {inventory?.priorBundles.length ? (
        <div className="mt-4 space-y-2">
          <p className="module-section-label">Prior bundles</p>
          {inventory.priorBundles.map((bundle) => (
            <div key={bundle.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[0.4rem] border border-border bg-background px-3 py-2 text-sm">
              <span>
                {formatDate(bundle.generatedAt)} · {formatBytes(bundle.byteCount)} · {bundle.selectedCount} optional selected · {bundle.status}
                {bundle.manifestSha256 ? ` · manifest ${bundle.manifestSha256.slice(0, 12)}…` : ""}
                {bundle.failureCode ? ` · ${bundle.failureCode}` : ""}
              </span>
              {bundle.downloadHref ? (
                <a href={bundle.downloadHref} className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2">
                  <Download className="h-4 w-4" /> Download
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : inventory && readyBundles.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No retained evidence bundles have been created for this project.</p>
      ) : null}
      {reviewOpen && inventory ? (
        <BundleReviewDialog
          inventory={inventory}
          canGenerate={canGenerate}
          projectId={projectId}
          onClose={() => setReviewOpen(false)}
          onCreated={() => void load()}
        />
      ) : null}
    </div>
  );
}
