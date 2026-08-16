"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { useCountyRunDetail, useCountyRunMutations } from "@/lib/hooks/use-county-onramp";
import {
  getCountyRunEnqueueHelpText,
  getCountyRunEnqueueStatusLabel,
  getCountyRunEnqueueStatusTone,
} from "@/lib/models/county-onramp";
import {
  buildCountyRunManifestProofSummary,
  buildCountyRunUiCard,
  getCountyRunMetricHighlights,
} from "@/lib/ui/county-onramp";
import { getCountyRunsBackContextLabel, getSafeCountyRunsBackHref } from "@/lib/ui/county-runs-navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { CountyRunModelingEvidence } from "@/components/county-runs/county-run-modeling-evidence";
import { CountyRunValidationPrep } from "@/components/county-runs/county-run-validation-prep";

const COUNTY_RUN_STUCK_THRESHOLD_MS = 10 * 60 * 1000;

export function CountyRunDetailClient({ countyRunId }: { countyRunId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // We own the polling loop (the hook's built-in interval is disabled with 0):
  // poll every 5s while the run is non-terminal, stop when it settles, and pause
  // while the tab is hidden. `now` advances only inside the timer so there is no
  // setState during render or the effect body.
  const { data, loading, error, refresh } = useCountyRunDetail(countyRunId, 0);
  const [now, setNow] = useState(0);
  const stageIsTerminal = data?.stage === "validated-screening";
  const shouldPoll = Boolean(data) && !stageIsTerminal;
  const awaitingWorker =
    data?.enqueueStatus === "submitted" && data?.stage === "bootstrap-incomplete";
  useEffect(() => {
    if (!shouldPoll) return;
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setNow(Date.now());
      void refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [shouldPoll, refresh]);
  const enqueuedAtMs = data?.lastEnqueuedAt ? Date.parse(data.lastEnqueuedAt) : Number.NaN;
  const runIsStuck =
    Boolean(awaitingWorker) &&
    now > 0 &&
    Number.isFinite(enqueuedAtMs) &&
    now - enqueuedAtMs > COUNTY_RUN_STUCK_THRESHOLD_MS;
  const { enqueue, loading: actionLoading, error: actionError } = useCountyRunMutations();
  const [enqueueState, setEnqueueState] = useState<{
    status: "prepared" | "submitted";
    manifestIngestUrl: string;
    manifestPath: string;
    hasBearerToken: boolean;
  } | null>(null);
  // Only the planner can clear the refusal below: whether a worker has since
  // been configured is a fact about the deployment that this page cannot read.
  const [workerConfiguredSinceLastAttempt, setWorkerConfiguredSinceLastAttempt] = useState(false);
  const [linkCopyState, setLinkCopyState] = useState<"idle" | "copied" | "error">("idle");

  const backTo = searchParams.get("backTo");
  const safeBackHref = useMemo(() => getSafeCountyRunsBackHref(backTo), [backTo]);
  const backContextLabel = useMemo(() => getCountyRunsBackContextLabel(backTo), [backTo]);
  const detailHref = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);
  const stageReasonLabel = (data as { stageReasonLabel?: string } | null)?.stageReasonLabel ?? null;

  const copyDetailLink = async () => {
    try {
      await navigator.clipboard.writeText(detailHref);
      setLinkCopyState("copied");
    } catch {
      setLinkCopyState("error");
    }
  };

  if (error) {
    return (
      <section className="module-page pb-10">
        <StateBlock
          title="Unable to load county run"
          description={error}
          tone="danger"
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      </section>
    );
  }

  if (!data && loading) {
    return (
      <section className="module-page pb-10">
        <StateBlock title="Loading county run" description="Loading this county run…" tone="info" />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="module-page pb-10">
        <StateBlock title="County run unavailable" description="No county run data is currently available." tone="warning" />
      </section>
    );
  }

  const card = buildCountyRunUiCard({
    geographyLabel: data.geographyLabel,
    manifest: data.manifest,
    stage: data.stage,
  });
  const manifestProof = buildCountyRunManifestProofSummary({
    manifest: data.manifest,
    artifacts: data.artifacts,
    stage: data.stage,
    statusLabel: data.statusLabel,
  });
  const metrics = getCountyRunMetricHighlights(data.manifest);
  const enqueueStatus = data.enqueueStatus ?? "not-enqueued";
  const enqueueLabel = getCountyRunEnqueueStatusLabel(enqueueStatus);
  const enqueueTone = getCountyRunEnqueueStatusTone(enqueueStatus);
  const enqueueHelp = getCountyRunEnqueueHelpText(enqueueStatus);
  /**
   * A previous attempt on this run proved there is no worker to hand it to.
   *
   * `prepared` comes from exactly one branch of `dispatchCountyOnrampJob` — the
   * one where no county onramp worker URL is configured and no HTTP request is
   * made — and the stored `worker_url` is null with it. So this is an observed
   * fact about this deployment, not an inference from a run that is merely
   * slow. Pressing the button again would build the identical payload and hand
   * it to nothing, which is why the control refuses before it does that rather
   * than reporting another success.
   */
  const lastAttemptReachedNoWorker = enqueueStatus === "prepared" && data.workerUrl == null;
  const enqueueRefused = lastAttemptReachedNoWorker && !workerConfiguredSinceLastAttempt;
  const canEnqueue = enqueueStatus !== "submitted" && !enqueueRefused;

  const runEnqueue = async () => {
    const result = await enqueue(countyRunId);
    if (result?.status === "prepared" || result?.status === "submitted") {
      setEnqueueState({
        status: result.status,
        manifestIngestUrl: result.workerPayload.callback.manifestIngestUrl,
        manifestPath: result.workerPayload.artifactTargets.manifestPath,
        hasBearerToken: result.workerPayload.callback.hasBearerToken,
      });
    }
  };

  return (
    <section className="module-page pb-10">
      <div className="module-intro-card">
        <div className="module-intro-kicker">County onboarding</div>
        <div className="module-intro-body">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={card.tone}>{card.stageLabel}</StatusBadge>
            {card.statusLabel ? <StatusBadge tone={card.tone}>{card.statusLabel}</StatusBadge> : null}
            <StatusBadge tone={enqueueTone}>{enqueueLabel}</StatusBadge>
          </div>
          <h1 className="module-intro-title">{data.geographyLabel}</h1>
          <p className="module-intro-description">
            {data.runName}. This page is the record for this county run: the files it produced, its
            setup status, why it is at this stage, and the next safe step.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => void runEnqueue()} disabled={actionLoading || !canEnqueue}>
            {enqueueStatus === "submitted"
              ? "Sent to the worker"
              : enqueueRefused
                ? "No worker to hand this to"
                : "Prepare run handoff"}
          </Button>
          <Button asChild variant="outline">
            <Link href={safeBackHref}>Back to county runs</Link>
          </Button>
          <Button variant="outline" onClick={() => void copyDetailLink()}>
            {linkCopyState === "copied" ? "Copied detail link" : "Copy page link"}
          </Button>
        </div>
        {/* The stored status alone cannot tell these two apart: "prepared" reads
            as background execution, and on a deployment with no worker it means
            the opposite. The record knows which one this is, so the record's
            wording wins over the generic label. */}
        {lastAttemptReachedNoWorker ? (
          <div
            data-testid="county-enqueue-refusal"
            className="mt-3 rounded-xl border border-amber-300/80 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <p className="font-semibold">
              This handoff was prepared, not sent — nothing is going to run it
            </p>
            <p className="mt-2">
              The last attempt found no processing worker configured on this OpenPlan
              installation to run county validation, so no request was made and no setup started. The payload below is
              complete and usable:
              an operator can run <code>scripts/modeling/bootstrap_county_validation_onramp.py</code>{" "}
              and POST the resulting manifest to the callback URL, and this page will pick it up.
              Configuring a worker instead is described in{" "}
              <code>workers/county_onramp_worker/DEPLOY.md</code>. Nothing about this workspace or
              this county is blocking it, and there is nothing to buy — OpenPlan is free.
            </p>
            <label className="mt-3 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-border"
                checked={workerConfiguredSinceLastAttempt}
                onChange={(event) => setWorkerConfiguredSinceLastAttempt(event.target.checked)}
              />
              <span>
                A validation worker has been configured on this OpenPlan installation since that
                attempt — prepare the handoff again. (This page reads the stored result, not the
                installation&apos;s configuration, so only you can tell it that changed.)
              </span>
            </label>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{enqueueHelp}</p>
        )}
        {stageReasonLabel ? (
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Why this stage:</span> {stageReasonLabel}
          </p>
        ) : null}
        {awaitingWorker ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Waiting for the modeling worker to pick up this run — auto-refreshing every few seconds
            (paused when the tab is hidden).
          </p>
        ) : null}
        {runIsStuck ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/80 bg-amber-50/70 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              This run has been submitted for over 10 minutes with no worker progress. No worker has
              picked this up — check that the modeling worker is running (see{" "}
              <code>workers/aequilibrae_worker/DEPLOY.md</code>).
            </span>
          </div>
        ) : null}
        {actionError ? <p className="mt-2 text-sm text-destructive">{actionError}</p> : null}
        {linkCopyState === "error" ? <p className="mt-2 text-sm text-destructive">Unable to copy the current detail link.</p> : null}
        {enqueueState ? (
          <div className="mt-2 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">
              {enqueueState.status === "submitted"
                ? "Setup handoff sent to the worker"
                : "Setup handoff prepared — nothing was sent"}
            </div>
            {enqueueState.status === "prepared" ? (
              <div className="mt-1">
                No processing worker is configured on this OpenPlan installation to run county
                validation, so this payload is waiting for a person to run it. It will not start on
                its own.
              </div>
            ) : null}
            <div className="mt-1 break-all">Callback: {enqueueState.manifestIngestUrl}</div>
            <div className="mt-1 break-all">Manifest: {enqueueState.manifestPath}</div>
            <div className="mt-1">Callback bearer: {enqueueState.hasBearerToken ? "configured" : "not configured"}</div>
          </div>
        ) : null}
      </div>

      {backContextLabel ? (
        <StateBlock
          className="mt-4"
          title="Saved dashboard view"
          description={backContextLabel}
          tone="info"
          compact
          action={
            <Link
              href={safeBackHref}
              className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground transition hover:border-primary/35 hover:text-primary"
            >
              Return to that view
            </Link>
          }
        />
      ) : null}

      <StateBlock
        className="mt-4"
        title="How to read this page"
        description="Use the stage and status badges for the current recorded state, use the guidance card for safe claims and next actions, and read the files below as evidence of what happened — not proof the run finished."
        tone="info"
        compact
      />

      <CountyRunModelingEvidence evidence={data.modelingEvidence} />

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Where these numbers came from</CardTitle>
          <CardDescription>
            One file you can attach to a grant application. It says which data the figures came
            from and when that data was published, how finely the area was divided, whether the
            traffic calculation settled, whether the results were checked against published traffic
            counts and what that found, and what the numbers may be used for. Anything the model did
            not measure is marked as missing, so a reviewer can see what was skipped as easily as
            what was done.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* A plain link, not a fetch-and-blob: the browser downloads it
              directly, so it works with the keyboard, with right-click "save
              as", and on a connection too slow for a spinner to be honest. */}
          <Button asChild variant="outline">
            <a href={`/api/county-runs/${countyRunId}/provenance`} download>
              Download for a grant appendix
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Manifest proof checklist</CardTitle>
            <StatusBadge tone={manifestProof.proofStatusTone}>{manifestProof.proofStatusLabel}</StatusBadge>
          </div>
          <CardDescription>
            The audit record for this county run: the inputs it captured, the files it generated, its
            validation status, the next operator action, and the caveats that must travel with any
            report built on it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 text-sm xl:grid-cols-[1.1fr_1.1fr_1fr]">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Inputs captured</div>
            <dl className="mt-3 space-y-3">
              {manifestProof.inputRows.map((row) => (
                <div key={`${row.label}:${row.value}`} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
                  <dt className="font-medium text-foreground">{row.label}</dt>
                  <dd className="mt-1 break-words text-muted-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Generated artifacts</div>
            <dl className="mt-3 space-y-3">
              {manifestProof.artifactRows.map((row) => (
                <div key={`${row.label}:${row.value}`} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
                  <dt className="font-medium text-foreground">{row.label}</dt>
                  <dd className="mt-1 break-all text-muted-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="space-y-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Validation status</div>
              <dl className="mt-3 space-y-3">
                {manifestProof.validationRows.map((row) => (
                  <div key={`${row.label}:${row.value}`} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
                    <dt className="font-medium text-foreground">{row.label}</dt>
                    <dd className="mt-1 text-muted-foreground">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Operator next action</div>
              <p className="mt-3 text-muted-foreground">{manifestProof.operatorNextAction}</p>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Caveat boundaries</div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                {manifestProof.caveatRows.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Runtime summary</CardTitle>
            <CardDescription>High-level outputs from the county screening run.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div>Zones: {metrics.zoneCount ?? "—"}</div>
            <div>Loaded links: {metrics.loadedLinks ?? "—"}</div>
            <div>Total trips: {metrics.totalTrips ?? "—"}</div>
            <div>Final gap: {metrics.finalGap ?? "—"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Validation summary</CardTitle>
            <CardDescription>Shown when a local validation slice exists.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div>Median APE: {metrics.medianApe ?? "—"}</div>
            <div>Max APE: {metrics.maxApe ?? "—"}</div>
            <div>Status: {card.statusLabel ?? "Not available"}</div>
            {/*
              WHAT THOSE THREE LINES CAN AND CANNOT ESTABLISH.
              A median APE beside a gate status is the entire validation story a
              county run tells. At a coarse zone system it is a story about the
              zone system: the trips that never reach a link cannot show up on
              one, so the gap is expected and is not evidence about the demand.
              Rendered only when the zone system actually disqualifies the
              comparison, so it never becomes boilerplate a reader learns to skip.
            */}
            {metrics.zoneResolutionCaveat ? (
              <p
                className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
                data-testid="county-run-zone-resolution-caveat"
              >
                {metrics.zoneResolutionCaveat}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Guidance</CardTitle>
            <CardDescription>What this run&apos;s results can and cannot support.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div>
              <div className="font-medium text-foreground">Allowed claim</div>
              <p className="mt-1">{card.allowedClaim}</p>
            </div>
            <div>
              <div className="font-medium text-foreground">Next action</div>
              <p className="mt-1">{card.nextAction}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
            <CardDescription>Files recorded for this county run.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data.artifacts.length === 0 ? (
              <p className="text-muted-foreground">No files have been recorded for this county run yet.</p>
            ) : (
              data.artifacts.map((artifact) => (
                <div key={`${artifact.artifactType}:${artifact.path}`} className="rounded-xl border border-border/70 p-3">
                  <div className="font-medium text-foreground">{artifact.artifactType}</div>
                  <div className="mt-1 break-all text-muted-foreground">{artifact.path}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Worker handoff</CardTitle>
            <CardDescription>The stored handoff for this run: what a worker or an operator needs to run the county setup.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {data.workerPayload ? (
              <>
                {data.workerJobId ? (
                  <div>
                    <div className="font-medium text-foreground">Worker job ID</div>
                    <div className="mt-1 break-all">{data.workerJobId}</div>
                  </div>
                ) : null}
                {data.workerUrl ? (
                  <div>
                    <div className="font-medium text-foreground">Worker URL</div>
                    <div className="mt-1 break-all">{data.workerUrl}</div>
                  </div>
                ) : null}
                {data.workerDispatchError ? (
                  <div>
                    <div className="font-medium text-destructive">Dispatch error</div>
                    <div className="mt-1 break-all text-destructive">{data.workerDispatchError}</div>
                  </div>
                ) : null}
                <div>
                  <div className="font-medium text-foreground">County prefix</div>
                  <div className="mt-1">{data.workerPayload.countyPrefix}</div>
                </div>
                <div>
                  <div className="font-medium text-foreground">Callback URL</div>
                  <div className="mt-1 break-all">{data.workerPayload.callback.manifestIngestUrl}</div>
                  <div className="mt-1">
                    Bearer credential: {data.workerPayload.callback.hasBearerToken ? "configured" : "not configured"}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-foreground">Artifact targets</div>
                  <ul className="mt-1 space-y-1 break-all">
                    <li>Scaffold CSV: {data.workerPayload.artifactTargets.scaffoldCsvPath}</li>
                    <li>Review packet: {data.workerPayload.artifactTargets.reviewPacketMdPath}</li>
                    <li>Manifest: {data.workerPayload.artifactTargets.manifestPath}</li>
                  </ul>
                </div>
                <div>
                  <div className="font-medium text-foreground">Runtime options</div>
                  <ul className="mt-1 space-y-1">
                    <li>keepProject: {String(data.workerPayload.runtimeOptions.keepProject)}</li>
                    <li>force: {String(data.workerPayload.runtimeOptions.force)}</li>
                    <li>overallDemandScalar: {data.workerPayload.runtimeOptions.overallDemandScalar ?? "—"}</li>
                    <li>externalDemandScalar: {data.workerPayload.runtimeOptions.externalDemandScalar ?? "—"}</li>
                    <li>hbwScalar: {data.workerPayload.runtimeOptions.hbwScalar ?? "—"}</li>
                    <li>hboScalar: {data.workerPayload.runtimeOptions.hboScalar ?? "—"}</li>
                    <li>nhbScalar: {data.workerPayload.runtimeOptions.nhbScalar ?? "—"}</li>
                  </ul>
                </div>
              </>
            ) : (
              <p>No stored worker handoff is currently available for this county run.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/*
        Shown only once a manifest exists, because that is the precondition the
        readiness check itself requires — offering it earlier would produce a
        refusal ("this run has not brought in its worker output file yet") that the
        page already knows.
      */}
      {data.manifest ? <CountyRunValidationPrep countyRunId={countyRunId} /> : null}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Caveats</CardTitle>
          <CardDescription>These should remain visible whenever the county state is interpreted.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {card.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
