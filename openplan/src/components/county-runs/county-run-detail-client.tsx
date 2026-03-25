"use client";

import Link from "next/link";
import { RefreshCcw } from "lucide-react";
import { useCountyRunDetail } from "@/lib/hooks/use-county-onramp";
import { buildCountyRunUiCard, getCountyRunMetricHighlights } from "@/lib/ui/county-onramp";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";

export function CountyRunDetailClient({ countyRunId }: { countyRunId: string }) {
  const { data, loading, error, refresh } = useCountyRunDetail(countyRunId);

  if (error) {
    return (
      <section className="module-page pb-10">
        <StateBlock
          title="Unable to load county run"
          description={error}
          tone="danger"
          action={{ label: "Retry", onClick: () => void refresh() }}
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
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <Button asChild variant="outline">
            <Link href="/county-runs">Back to county runs</Link>
          </Button>
        </div>
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

      <Card className="mt-4">
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
