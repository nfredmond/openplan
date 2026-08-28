"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Copy, Download, Loader2, Send } from "lucide-react";
import { PROJECT_EVIDENCE_BUNDLE_CREATED_EVENT } from "./project-evidence-bundle-panel";

type Bundle = {
  id: string;
  bundle_sha256: string;
  generated_by: string;
  generated_at: string;
  readinessError: string | null;
  freshnessError: string | null;
  staleForCurrentUse: boolean;
};
type Submission = {
  id: string;
  bundle_id: string;
  bundle_sha256: string;
  submitted_by: string;
  assigned_approver_id: string;
  replaces_submission_id: string | null;
  submitted_at: string;
};
type Decision = {
  id: string;
  submission_id: string;
  decision: "approved" | "returned";
  reason: string | null;
  receipt_sha256: string;
  decided_at: string;
};
type Data = {
  currentUserId: string;
  canApprove: boolean;
  bundles: Bundle[];
  submissions: Submission[];
  decisions: Decision[];
  approvers: Array<{ user_id: string; role: string; label: string }>;
};

async function readDecisionPackageData(projectId: string, signal?: AbortSignal): Promise<
  { data: Data; error: null } | { data: null; error: string }
> {
  const response = await fetch(`/api/projects/${projectId}/decision-packages`, { cache: "no-store", signal });
  const payload = await response.json().catch(() => null) as Data | { error?: string } | null;
  if (!response.ok || !payload || !("bundles" in payload)) {
    return {
      data: null,
      error: payload && "error" in payload
        ? payload.error ?? "Decision packages could not be read."
        : "Decision packages could not be read.",
    };
  }
  return { data: payload, error: null };
}

function HashValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 grid min-w-0 gap-2 text-xs text-muted-foreground sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
      <span className="shrink-0 font-medium text-foreground">{label}</span>
      <code className="min-w-0 break-all leading-relaxed">{value}</code>
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 justify-self-start rounded-[0.3rem] border border-border px-2 py-1 text-foreground hover:bg-muted sm:justify-self-auto"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_500);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function ProjectDecisionPackagePanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approverByBundle, setApproverByBundle] = useState<Record<string, string>>({});
  const [returnReason, setReturnReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const result = await readDecisionPackageData(projectId);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setData(result.data);
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void readDecisionPackageData(projectId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.error) setError(result.error);
      else {
        setError(null);
        setData(result.data);
      }
    }).catch((loadError: unknown) => {
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : "Decision packages could not be read.");
      }
    });
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener(PROJECT_EVIDENCE_BUNDLE_CREATED_EVENT, refresh);
    return () => window.removeEventListener(PROJECT_EVIDENCE_BUNDLE_CREATED_EVENT, refresh);
  }, [load]);

  const decisionsBySubmission = useMemo(
    () => new Map((data?.decisions ?? []).map((decision) => [decision.submission_id, decision])),
    [data],
  );
  const replacementBySubmission = useMemo(
    () => new Map((data?.submissions ?? []).flatMap((submission) => submission.replaces_submission_id ? [[submission.replaces_submission_id, submission]] : [])),
    [data],
  );

  async function submit(bundle: Bundle, replacesSubmissionId?: string) {
    const assignedApproverId = approverByBundle[bundle.id];
    if (!assignedApproverId) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/projects/${projectId}/decision-packages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bundleId: bundle.id,
        bundleSha256: bundle.bundle_sha256,
        assignedApproverId,
        replacesSubmissionId: replacesSubmissionId ?? null,
      }),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) setError(payload?.error ?? "The package could not be submitted.");
    else await load();
    setBusy(false);
  }

  async function decide(submission: Submission, decision: "approved" | "returned") {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/projects/${projectId}/decision-packages/${submission.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bundleId: submission.bundle_id,
        bundleSha256: submission.bundle_sha256,
        decision,
        reason: decision === "returned" ? returnReason[submission.id] ?? "" : null,
      }),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) setError(payload?.error ?? "The decision could not be saved.");
    else await load();
    setBusy(false);
  }

  return (
    <div id="project-decision-packages" className="mb-6 rounded-[0.5rem] border border-border bg-muted/20 p-4">
      <div>
        <p className="text-sm font-semibold">Agency decision handoff</p>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Submit one exact frozen bundle to a different owner or admin. Approval saves the bundle hash; it does not publish, adopt, or validate the package.
        </p>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {!data ? <p className="mt-3 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading decision custody…</p> : null}

      {data?.bundles.map((bundle) => {
        const bundleSubmissions = data.submissions.filter((submission) => submission.bundle_id === bundle.id);
        const returnedToReplace = data.submissions.find((submission) => {
          const decision = decisionsBySubmission.get(submission.id);
          return decision?.decision === "returned" && !replacementBySubmission.has(submission.id) && submission.submitted_by === data.currentUserId;
        });
        const eligibleApprovers = data.approvers.filter(
          (approver) => approver.user_id !== data.currentUserId && approver.user_id !== bundle.generated_by,
        );
        return (
          <div key={bundle.id} data-bundle-sha={bundle.bundle_sha256} className="mt-4 rounded-[0.45rem] border border-border bg-background p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Bundle frozen {new Date(bundle.generated_at).toLocaleString()}</span>
              <a href={`/api/projects/${projectId}/evidence-bundles/${bundle.id}/download`} className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2">
                <Download className="h-4 w-4" /> Download
              </a>
            </div>
            <HashValue label="Bundle SHA-256" value={bundle.bundle_sha256} />
            {bundle.staleForCurrentUse ? <p className="mt-2 text-amber-700 dark:text-amber-200">Historical custody preserved. This bundle is stale for current use; freeze a new one. {bundle.freshnessError}</p> : null}
            {bundle.readinessError ? <p className="mt-2 text-amber-700 dark:text-amber-200">Not approvable: {bundle.readinessError}</p> : null}
            {!bundle.readinessError && !bundle.staleForCurrentUse && bundleSubmissions.length === 0 && returnedToReplace?.bundle_id !== bundle.id ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label>
                  <span className="sr-only">Assigned approver</span>
                  <select
                    value={approverByBundle[bundle.id] ?? ""}
                    onChange={(event) => setApproverByBundle((current) => ({ ...current, [bundle.id]: event.target.value }))}
                    className="rounded-[0.4rem] border border-border bg-background px-3 py-2"
                  >
                    <option value="">Choose a different approver</option>
                    {eligibleApprovers.map((approver) => <option key={approver.user_id} value={approver.user_id}>{approver.label} · {approver.role}</option>)}
                  </select>
                </label>
                <button type="button" disabled={busy || !approverByBundle[bundle.id]} onClick={() => void submit(bundle, returnedToReplace?.id)} className="inline-flex items-center gap-1 rounded-[0.4rem] bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">
                  <Send className="h-4 w-4" /> {returnedToReplace ? "Submit replacement bundle" : "Submit exact bundle"}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      {data?.submissions.map((submission) => {
        const decision = decisionsBySubmission.get(submission.id);
        const assignedHere = submission.assigned_approver_id === data.currentUserId;
        return (
          <div key={submission.id} data-submission-bundle-sha={submission.bundle_sha256} className="mt-3 rounded-[0.45rem] border border-border bg-background p-3 text-sm">
            <p>Submission {submission.id.slice(0, 8)}…</p>
            <HashValue label="Bundle SHA-256" value={submission.bundle_sha256} />
            {decision ? (
              <div className="mt-2" data-decision={decision.decision}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p><CheckCircle2 className="mr-1 inline h-4 w-4" /> {decision.decision}{decision.reason ? ` · ${decision.reason}` : ""}</p>
                  <a href={`/api/projects/${projectId}/decision-packages/${submission.id}/decision`} className="underline decoration-dotted underline-offset-2">Download receipt</a>
                </div>
                <HashValue label="Receipt SHA-256" value={decision.receipt_sha256} />
              </div>
            ) : assignedHere && data.canApprove ? (
              <div className="mt-3 space-y-2">
                <label className="block">Return reason
                  <textarea value={returnReason[submission.id] ?? ""} onChange={(event) => setReturnReason((current) => ({ ...current, [submission.id]: event.target.value }))} className="mt-1 block min-h-20 w-full rounded-[0.4rem] border border-border bg-background px-3 py-2" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => void decide(submission, "approved")} className="rounded-[0.4rem] bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">Approve exact bundle</button>
                  <button type="button" disabled={busy || (returnReason[submission.id]?.trim().length ?? 0) < 3} onClick={() => void decide(submission, "returned")} className="rounded-[0.4rem] border border-border px-3 py-2 disabled:opacity-50">Return with reason</button>
                </div>
              </div>
            ) : <p className="mt-1 text-muted-foreground">Pending assigned approver.</p>}
          </div>
        );
      })}
    </div>
  );
}
