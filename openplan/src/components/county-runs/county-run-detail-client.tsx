"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { RefreshCcw } from "lucide-react";
import { useCountyRunDetail, useCountyRunMutations, useCountyRunScaffold } from "@/lib/hooks/use-county-onramp";
import {
  getCountyRunEnqueueHelpText,
  getCountyRunEnqueueStatusLabel,
  getCountyRunEnqueueStatusTone,
} from "@/lib/models/county-onramp";
import {
  buildCountyActivitySimBundleUiCard,
  buildCountyBehavioralPrototypeUiCard,
  buildCountyRunUiCard,
  buildCountyValidationScaffoldUiCard,
  getCountyRunMetricHighlights,
} from "@/lib/ui/county-onramp";
import { getCountyRunsBackContextLabel, getSafeCountyRunsBackHref } from "@/lib/ui/county-runs-navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";

export function CountyRunDetailClient({ countyRunId }: { countyRunId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, loading, error, refresh } = useCountyRunDetail(countyRunId, 15000);
  const { enqueue, updateScaffold, loading: actionLoading, error: actionError } = useCountyRunMutations();
  const scaffoldTargetPath = data?.manifest?.artifacts?.scaffold_csv ?? null;
  const {
    data: scaffoldData,
    loading: scaffoldLoading,
    error: scaffoldError,
    refresh: refreshScaffold,
  } = useCountyRunScaffold(countyRunId, Boolean(scaffoldTargetPath));
  const [enqueueState, setEnqueueState] = useState<{
    status: "queued_stub";
    deliveryMode: "prepared" | "submitted";
    manifestIngestUrl: string;
    manifestPath: string;
  } | null>(null);
  const [scaffoldDraftState, setScaffoldDraftState] = useState<{ path: string | null; value: string | null }>({
    path: null,
    value: null,
  });
  const [scaffoldSaveState, setScaffoldSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [copiedDetailRelativeUrl, setCopiedDetailRelativeUrl] = useState<string | null>(null);
  const [shareLinkError, setShareLinkError] = useState(false);

  if (error) {
    return (
      <section className="module-page pb-10">
        <ErrorState
          title="Unable to load county run"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
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
        <LoadingState label="Loading county run" description="Fetching county run detail and artifact state…" />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="module-page pb-10">
        <EmptyState title="County run unavailable" description="No county run data is currently available." />
      </section>
    );
  }

  const card = buildCountyRunUiCard({
    geographyLabel: data.geographyLabel,
    manifest: data.manifest,
    stage: data.stage,
  });
  const metrics = getCountyRunMetricHighlights(data.manifest);
  const validationScaffold = buildCountyValidationScaffoldUiCard(data.manifest);
  const activitysimBundle = buildCountyActivitySimBundleUiCard(data.manifest);
  const behavioral = buildCountyBehavioralPrototypeUiCard(data.manifest);
  const enqueueStatus = data.enqueueStatus ?? "not-enqueued";
  const enqueueLabel = getCountyRunEnqueueStatusLabel(enqueueStatus);
  const enqueueTone = getCountyRunEnqueueStatusTone(enqueueStatus);
  const enqueueHelp = getCountyRunEnqueueHelpText(enqueueStatus);
  const canEnqueue = enqueueStatus !== "queued_stub";
  const scaffoldSourceValue = scaffoldData?.csvContent ?? "";
  const scaffoldEditorValue =
    scaffoldDraftState.path === scaffoldTargetPath
      ? scaffoldDraftState.value ?? scaffoldSourceValue
      : scaffoldSourceValue;
  const scaffoldDirty = Boolean(scaffoldTargetPath) && scaffoldEditorValue !== scaffoldSourceValue;
  const canSaveScaffold = Boolean(scaffoldTargetPath && scaffoldEditorValue.trim() && scaffoldDirty);
  const requestedBackTo = searchParams.get("backTo");
  const countyRunsBackHref = getSafeCountyRunsBackHref(requestedBackTo);
  const countyRunsBackContextLabel = getCountyRunsBackContextLabel(requestedBackTo);
  const currentCountyRunRelativeUrl = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;
  const shareLinkState: "idle" | "copied" | "error" = shareLinkError
    ? "error"
    : copiedDetailRelativeUrl === currentCountyRunRelativeUrl
    ? "copied"
    : "idle";

  const runEnqueue = async () => {
    const result = await enqueue(countyRunId);
    if (result?.status === "queued_stub") {
      setEnqueueState({
        status: result.status,
        deliveryMode: result.deliveryMode,
        manifestIngestUrl: result.workerPayload.callback.manifestIngestUrl,
        manifestPath: result.workerPayload.artifactTargets.manifestPath,
      });
    }
  };

  const copyCurrentDetailLink = async () => {
    if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setShareLinkError(true);
      return;
    }

    try {
      await navigator.clipboard.writeText(`${window.location.origin}${currentCountyRunRelativeUrl}`);
      setCopiedDetailRelativeUrl(currentCountyRunRelativeUrl);
      setShareLinkError(false);
    } catch {
      setShareLinkError(true);
    }
  };

  const saveScaffoldDraft = async () => {
    if (!scaffoldTargetPath || !scaffoldEditorValue.trim() || !scaffoldDirty) {
      return;
    }

    const result = await updateScaffold(countyRunId, { csvContent: scaffoldEditorValue });
    if (!result) {
      setScaffoldSaveState("error");
      return;
    }

    setScaffoldSaveState("saved");
    await Promise.all([refresh(), refreshScaffold()]);
  };

  const reloadScaffoldDraft = async () => {
    if (!scaffoldTargetPath) {
      return;
    }

    setScaffoldDraftState({ path: null, value: null });
    setScaffoldSaveState("idle");
    await refreshScaffold();
  };

  return (
    <section className="module-page pb-10">
      <div className="module-intro-card">
        <div className="module-intro-kicker">County onboarding</div>
        <div className="module-intro-body">
          <h1 className="module-intro-title">{data.geographyLabel}</h1>
          <p className="module-intro-description">{data.runName}</p>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <StatusBadge tone={card.tone}>{card.stageLabel}</StatusBadge>
          {card.statusLabel ? <StatusBadge tone={card.tone}>{card.statusLabel}</StatusBadge> : null}
          <StatusBadge tone={enqueueTone}>{enqueueLabel}</StatusBadge>
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => void runEnqueue()} disabled={actionLoading || !canEnqueue}>
            {data.enqueueStatus === "queued_stub" ? "Bootstrap prepared" : "Enqueue bootstrap"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void copyCurrentDetailLink()}>
            {shareLinkState === "copied" ? "Copied" : "Copy detail link"}
          </Button>
          <Button asChild variant="outline">
            <Link href={countyRunsBackHref}>Back to county runs</Link>
          </Button>
        </div>
        {countyRunsBackContextLabel || shareLinkState !== "idle" ? (
          <div className="mt-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            {countyRunsBackContextLabel ? (
              <div>
                <span className="font-medium text-foreground">Saved dashboard view</span>
                <span className="ml-2">{countyRunsBackContextLabel}</span>
              </div>
            ) : null}
            {shareLinkState === "copied" ? <div className="text-emerald-600">Copied detail link</div> : null}
            {shareLinkState === "error" ? <div className="text-destructive">Unable to copy detail link</div> : null}
          </div>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">{enqueueHelp}</p>
        {actionError ? <p className="mt-2 text-sm text-destructive">{actionError}</p> : null}
        {enqueueState ? (
          <div className="mt-2 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">
              {enqueueState.deliveryMode === "submitted" ? "Background worker accepted the job" : "Enqueue payload prepared"}
            </div>
            <div className="mt-1">
              {enqueueState.deliveryMode === "submitted"
                ? "The county bootstrap was handed to the configured worker endpoint for background execution."
                : "No worker endpoint is configured yet, so the payload is ready for operator/manual dispatch."}
            </div>
            <div className="mt-1 break-all">Callback: {enqueueState.manifestIngestUrl}</div>
            <div className="mt-1 break-all">Manifest: {enqueueState.manifestPath}</div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Validation scaffold</CardTitle>
            <CardDescription>Observed-count sourcing progress from the county onramp manifest.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <StatusBadge tone={validationScaffold.tone}>{validationScaffold.statusLabel}</StatusBadge>
            <div>Starter stations: {validationScaffold.stationCount ?? "—"}</div>
            <div>
              Observed counts entered: {validationScaffold.observedVolumeFilledCount ?? "—"}
              {validationScaffold.stationCount != null ? ` / ${validationScaffold.stationCount}` : ""}
            </div>
            <div>Source descriptions entered: {validationScaffold.sourceDescriptionFilledCount ?? "—"}</div>
            <div>Agencies still TBD: {validationScaffold.sourceAgencyTbdCount ?? "—"}</div>
            <div>
              Validator-ready stations: {validationScaffold.readyStationCount ?? "—"}
              {validationScaffold.stationCount != null ? ` / ${validationScaffold.stationCount}` : ""}
            </div>
            <p>{validationScaffold.claim}</p>
            <p>Next scaffold action: {validationScaffold.nextActionLabel}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scaffold update</CardTitle>
            <CardDescription>Edit the current scaffold in place or paste a full replacement CSV without leaving OpenPlan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div>
              <div className="font-medium text-foreground">Registered scaffold path</div>
              <p className="mt-1 break-all">{scaffoldTargetPath ?? "No scaffold file is currently registered for this county run."}</p>
            </div>
            <p>
              Saving a revised scaffold will refresh readiness metrics immediately. If this county already had a validated
              slice, OpenPlan will mark that validation stale until the validator is rerun.
            </p>
            {scaffoldLoading ? <p>Loading current scaffold CSV…</p> : null}
            {scaffoldError ? <p className="text-destructive">{scaffoldError}</p> : null}
            <Textarea
              value={scaffoldEditorValue}
              onChange={(event) => {
                setScaffoldDraftState({ path: scaffoldTargetPath, value: event.target.value });
                setScaffoldSaveState("idle");
              }}
              placeholder="Paste the full scaffold CSV here after editing observed counts and source metadata."
              rows={10}
              disabled={!scaffoldTargetPath}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={() => void saveScaffoldDraft()} disabled={actionLoading || !canSaveScaffold}>
                Save scaffold CSV
              </Button>
              <Button type="button" variant="ghost" onClick={() => void reloadScaffoldDraft()} disabled={scaffoldLoading || !scaffoldTargetPath}>
                Reload scaffold CSV
              </Button>
              {!scaffoldDirty && scaffoldTargetPath ? <span>Editor matches the currently stored scaffold.</span> : null}
              {scaffoldSaveState === "saved" ? <span className="text-emerald-600">Scaffold saved and readiness refreshed.</span> : null}
              {scaffoldSaveState === "error" ? <span className="text-destructive">Unable to save scaffold.</span> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Guidance</CardTitle>
            <CardDescription>Truth constraints preserved at the UI layer.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div>
              <div className="font-medium text-foreground">Allowed claim</div>
              <p className="mt-1">{card.allowedClaim}</p>
            </div>
            {data.stageReasonLabel ? (
              <div>
                <div className="font-medium text-foreground">Why this stage</div>
                <p className="mt-1">{data.stageReasonLabel}</p>
              </div>
            ) : null}
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
            <CardTitle>ActivitySim handoff</CardTitle>
            <CardDescription>Intermediate bundle state between screening outputs and the prototype behavioral lane.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <StatusBadge tone={activitysimBundle.tone}>{activitysimBundle.statusLabel}</StatusBadge>
            <div>Bundle ready: {activitysimBundle.ready ? "Yes" : "No"}</div>
            <p>{activitysimBundle.claim}</p>
            <div>Land-use rows: {activitysimBundle.landUseRows ?? "—"}</div>
            <div>Households: {activitysimBundle.households ?? "—"}</div>
            <div>Persons: {activitysimBundle.persons ?? "—"}</div>
            <div>Skim posture: {activitysimBundle.skimModeLabel ?? "—"}</div>
            {activitysimBundle.outputDir ? <div>Output root: {activitysimBundle.outputDir}</div> : null}
            {activitysimBundle.manifestPath ? <div>Bundle manifest: {activitysimBundle.manifestPath}</div> : null}
            {activitysimBundle.errorMessage ? <div>Error: {activitysimBundle.errorMessage}</div> : null}
            {activitysimBundle.errorKind ? <div>Error kind: {activitysimBundle.errorKind}</div> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Behavioral prototype</CardTitle>
            <CardDescription>End-to-end prototype lane status from the county onramp manifest.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div>Pipeline status: {behavioral.pipelineStatus ?? "Not recorded"}</div>
            <div>Runtime status: {behavioral.runtimeStatus ?? "Not recorded"}</div>
            <div>Runtime mode: {behavioral.runtimeMode ?? "Not recorded"}</div>
            <div>Runtime posture: {behavioral.runtimePosture ?? "Not recorded"}</div>
            <div>Evidence status: {behavioral.evidenceStatusLabel}</div>
            <div>Evidence packet ready: {behavioral.evidencePacketReady ? "Yes" : "No"}</div>
            <div>Comparison ready: {behavioral.comparisonReady ? "Yes" : "No"}</div>
            <p>{behavioral.claim}</p>
            <p>{behavioral.evidenceSupportLabel}</p>
            <p>{behavioral.comparisonSupportLabel}</p>
            {behavioral.evidencePacketPath ? <div>Evidence source: {behavioral.evidencePacketPath}</div> : null}
            {behavioral.runtimeSummaryPath ? <div>Runtime summary: {behavioral.runtimeSummaryPath}</div> : null}
            {behavioral.ingestionSummaryPath ? <div>Ingestion summary: {behavioral.ingestionSummaryPath}</div> : null}
            {behavioral.comparisonSummaryPath ? <div>Comparison summary: {behavioral.comparisonSummaryPath}</div> : null}
            {behavioral.comparisonPacketPath ? <div>Comparison packet: {behavioral.comparisonPacketPath}</div> : null}
            {behavioral.caveats.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {behavioral.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
            <CardDescription>Current county-run files exposed through the backend artifact list.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data.artifacts.length === 0 ? (
              <p className="text-muted-foreground">No artifacts are currently registered for this county run.</p>
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
            <CardDescription>Stored launch state and next-step execution contract for background bootstrap.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {data.workerPayload ? (
              <>
                <div>
                  <div className="font-medium text-foreground">County prefix</div>
                  <div className="mt-1">{data.workerPayload.countyPrefix}</div>
                </div>
                <div>
                  <div className="font-medium text-foreground">Runtime preset</div>
                  <div className="mt-1">{data.runtimePresetLabel ?? "Standard county onboarding runtime"}</div>
                </div>
                <div>
                  <div className="font-medium text-foreground">Callback URL</div>
                  <div className="mt-1 break-all">{data.workerPayload.callback.manifestIngestUrl}</div>
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
                    <li>
                      activitysimContainerImage: {data.workerPayload.runtimeOptions.activitysimContainerImage ?? "—"}
                    </li>
                    <li>containerEngineCli: {data.workerPayload.runtimeOptions.containerEngineCli ?? "—"}</li>
                    <li>
                      activitysimContainerCliTemplate:{" "}
                      {data.workerPayload.runtimeOptions.activitysimContainerCliTemplate ?? "—"}
                    </li>
                    <li>containerNetworkMode: {data.workerPayload.runtimeOptions.containerNetworkMode ?? "—"}</li>
                  </ul>
                </div>
              </>
            ) : (
              <p>No stored worker handoff is currently available for this county run.</p>
            )}
          </CardContent>
        </Card>
      </div>

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
