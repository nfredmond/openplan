"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCcw } from "lucide-react";
import { useCountyRunDetail, useCountyRunMutations } from "@/lib/hooks/use-county-onramp";
import {
  getCountyRunEnqueueHelpText,
  getCountyRunEnqueueStatusLabel,
  getCountyRunEnqueueStatusTone,
} from "@/lib/models/county-onramp";
import {
  buildCountyBehavioralPrototypeUiCard,
  buildCountyRunUiCard,
  getCountyRunMetricHighlights,
} from "@/lib/ui/county-onramp";
import { getSafeCountyRunsBackHref } from "@/lib/ui/county-runs-navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";

export function CountyRunDetailClient({ countyRunId }: { countyRunId: string }) {
  const searchParams = useSearchParams();
  const { data, loading, error, refresh } = useCountyRunDetail(countyRunId, 15000);
  const { enqueue, loading: actionLoading, error: actionError } = useCountyRunMutations();
  const [enqueueState, setEnqueueState] = useState<{
    status: "queued_stub";
    deliveryMode: "prepared" | "submitted";
    manifestIngestUrl: string;
    manifestPath: string;
  } | null>(null);

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
  const behavioral = buildCountyBehavioralPrototypeUiCard(data.manifest);
  const enqueueStatus = data.enqueueStatus ?? "not-enqueued";
  const enqueueLabel = getCountyRunEnqueueStatusLabel(enqueueStatus);
  const enqueueTone = getCountyRunEnqueueStatusTone(enqueueStatus);
  const enqueueHelp = getCountyRunEnqueueHelpText(enqueueStatus);
  const canEnqueue = enqueueStatus !== "queued_stub";
  const countyRunsBackHref = getSafeCountyRunsBackHref(searchParams.get("backTo"));

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
          <Button asChild variant="outline">
            <Link href={countyRunsBackHref}>Back to county runs</Link>
          </Button>
        </div>
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
            <CardTitle>Guidance</CardTitle>
            <CardDescription>Truth constraints preserved at the UI layer.</CardDescription>
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
