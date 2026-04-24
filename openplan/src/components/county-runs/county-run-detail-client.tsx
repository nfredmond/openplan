"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useCountyRunDetail, useCountyRunMutations } from "@/lib/hooks/use-county-onramp";
import {
  getCountyRunEnqueueHelpText,
  getCountyRunEnqueueStatusLabel,
  getCountyRunEnqueueStatusTone,
} from "@/lib/models/county-onramp";
import { buildCountyRunUiCard, getCountyRunMetricHighlights } from "@/lib/ui/county-onramp";
import { getCountyRunsBackContextLabel, getSafeCountyRunsBackHref } from "@/lib/ui/county-runs-navigation";
import { isValidatedNevadaCountyRun } from "@/lib/examples/nevada-county-2026-03-24";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { NevadaCountyValidatedEvidence } from "@/components/county-runs/nevada-county-validated-evidence";
import { CountyRunModelingEvidence } from "@/components/county-runs/county-run-modeling-evidence";

export function CountyRunDetailClient({ countyRunId }: { countyRunId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, loading, error, refresh } = useCountyRunDetail(countyRunId, 15000);
  const { enqueue, loading: actionLoading, error: actionError } = useCountyRunMutations();
  const [enqueueState, setEnqueueState] = useState<{
    status: "queued_stub";
    manifestIngestUrl: string;
    manifestPath: string;
  } | null>(null);
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
        <StateBlock title="Loading county run" description="Fetching county run detail and artifact state…" tone="info" />
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
  const metrics = getCountyRunMetricHighlights(data.manifest);
  const enqueueStatus = data.enqueueStatus ?? "not-enqueued";
  const enqueueLabel = getCountyRunEnqueueStatusLabel(enqueueStatus);
  const enqueueTone = getCountyRunEnqueueStatusTone(enqueueStatus);
  const enqueueHelp = getCountyRunEnqueueHelpText(enqueueStatus);
  const canEnqueue = enqueueStatus !== "queued_stub";

  const runEnqueue = async () => {
    const result = await enqueue(countyRunId);
    if (result?.status === "queued_stub") {
      setEnqueueState({
        status: result.status,
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
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={card.tone}>{card.stageLabel}</StatusBadge>
            {card.statusLabel ? <StatusBadge tone={card.tone}>{card.statusLabel}</StatusBadge> : null}
            <StatusBadge tone={enqueueTone}>{enqueueLabel}</StatusBadge>
          </div>
          <h1 className="module-intro-title">{data.geographyLabel}</h1>
          <p className="module-intro-description">
            {data.runName}. This page is the operational truth surface for the selected county run: recorded artifacts,
            bootstrap posture, stage rationale, and the next safe operator move.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => void runEnqueue()} disabled={actionLoading || !canEnqueue}>
            {enqueueStatus === "queued_stub" ? "Bootstrap prepared" : "Prepare run handoff"}
          </Button>
          <Button asChild variant="outline">
            <Link href={safeBackHref}>Back to county runs</Link>
          </Button>
          <Button variant="outline" onClick={() => void copyDetailLink()}>
            {linkCopyState === "copied" ? "Copied detail link" : "Copy page link"}
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{enqueueHelp}</p>
        {stageReasonLabel ? (
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Why this stage:</span> {stageReasonLabel}
          </p>
        ) : null}
        {actionError ? <p className="mt-2 text-sm text-destructive">{actionError}</p> : null}
        {linkCopyState === "error" ? <p className="mt-2 text-sm text-destructive">Unable to copy the current detail link.</p> : null}
        {enqueueState ? (
          <div className="mt-2 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">Bootstrap handoff prepared</div>
            <div className="mt-1 break-all">Callback: {enqueueState.manifestIngestUrl}</div>
            <div className="mt-1 break-all">Manifest: {enqueueState.manifestPath}</div>
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
        description="Use the stage/status badges for the current recorded posture, use the guidance card for safe claims and next actions, and treat artifacts below as evidence inventory rather than implied completion."
        tone="info"
        compact
      />

      {isValidatedNevadaCountyRun(data.runName) ? <NevadaCountyValidatedEvidence /> : null}
      <CountyRunModelingEvidence evidence={data.modelingEvidence} />

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
