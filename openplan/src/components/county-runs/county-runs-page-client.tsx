"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useCountyGeographySearch, useCountyRunMutations, useCountyRuns } from "@/lib/hooks/use-county-onramp";
import type { CountyGeographySearchItem } from "@/lib/api/county-geographies";
import {
  getCountyRunEnqueueHelpText,
  getCountyRunEnqueueStatusLabel,
  getCountyRunEnqueueStatusTone,
} from "@/lib/models/county-onramp";
import { buildCountyRunUiCard } from "@/lib/ui/county-onramp";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";

export function CountyRunsPageClient({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { items, loading, error, refresh } = useCountyRuns({
    workspaceId,
    limit: 25,
    refreshMs: 15000,
  });
  const { create, loading: creating, error: createError } = useCountyRunMutations();
  const [countyQuery, setCountyQuery] = useState("");
  const [selectedCounty, setSelectedCounty] = useState<CountyGeographySearchItem | null>(null);
  const [runName, setRunName] = useState("");
  const { items: countyMatches, loading: searchLoading, error: searchError } = useCountyGeographySearch(countyQuery, {
    limit: 6,
  });

  const activeCounty = useMemo(() => {
    if (!selectedCounty) return null;
    const normalizedQuery = countyQuery.trim().toLowerCase();
    const matchesSelected =
      normalizedQuery === selectedCounty.geographyLabel.toLowerCase() || normalizedQuery === selectedCounty.geographyId;
    return matchesSelected ? selectedCounty : null;
  }, [countyQuery, selectedCounty]);

  const suggestedRunName = useMemo(() => activeCounty?.suggestedRunName ?? "", [activeCounty]);

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextRunName = runName.trim() || suggestedRunName;
    if (!activeCounty || !nextRunName) return;

    const created = await create({
      workspaceId,
      geographyType: "county_fips",
      geographyId: activeCounty.geographyId,
      geographyLabel: activeCounty.geographyLabel,
      runName: nextRunName,
      countyPrefix: activeCounty.countyPrefix,
      runtimeOptions: { keepProject: true },
    });

    if (created?.countyRunId) {
      await refresh();
      router.push(`/county-runs/${created.countyRunId}`);
    }
  };

  return (
    <section className="module-page pb-10">
      <div className="module-intro-card">
        <div className="module-intro-kicker">County onboarding</div>
        <div className="module-intro-body">
          <h1 className="module-intro-title">County runs</h1>
          <p className="module-intro-description">
            Track geography-first county onboarding from runtime build through validation scaffolding and bounded
            screening status.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Launch county onboarding</CardTitle>
          <CardDescription>
            Create a county run record to begin the geography-first onboarding workflow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={submitCreate}>
            <div className="space-y-2 md:col-span-2 xl:col-span-2">
              <label className="text-sm font-medium text-foreground">County search</label>
              <Input
                value={countyQuery}
                onChange={(e) => setCountyQuery(e.target.value)}
                placeholder="Nevada County, CA or 06057"
              />
              <p className="text-xs text-muted-foreground">Search any U.S. county by name or 5-digit FIPS. Select one result to launch the runtime bootstrap.</p>
            </div>

            <div className="space-y-2 md:col-span-2 xl:col-span-2">
              <label className="text-sm font-medium text-foreground">Run name</label>
              <Input
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder={suggestedRunName || "county-runtime"}
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the suggested run name derived from the selected county.</p>
            </div>

            <div className="md:col-span-2 xl:col-span-4 space-y-3">
              {searchError ? <p className="text-sm text-destructive">{searchError}</p> : null}
              {!searchError && searchLoading ? <p className="text-sm text-muted-foreground">Searching counties…</p> : null}

              {!searchError && !searchLoading && countyQuery.trim().length >= 2 && !activeCounty && countyMatches.length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {countyMatches.map((item) => (
                    <button
                      key={item.geographyId}
                      type="button"
                      onClick={() => {
                        setSelectedCounty(item);
                        setCountyQuery(item.geographyLabel);
                      }}
                      className="rounded-xl border border-border/70 bg-background px-3 py-3 text-left transition hover:border-primary/40 hover:bg-muted/40"
                    >
                      <div className="font-medium text-foreground">{item.geographyLabel}</div>
                      <div className="mt-1 text-xs text-muted-foreground">FIPS {item.geographyId} · Prefix {item.countyPrefix}</div>
                    </button>
                  ))}
                </div>
              ) : null}

              {activeCounty ? (
                <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">Selected county</div>
                  <div className="mt-1">{activeCounty.geographyLabel}</div>
                  <div className="mt-1 text-xs">FIPS {activeCounty.geographyId} · Prefix {activeCounty.countyPrefix}</div>
                </div>
              ) : null}
            </div>

            <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-3 pt-1">
              <Button type="submit" disabled={creating || !activeCounty}>
                Launch county run
              </Button>
              {createError ? <span className="text-sm text-destructive">{createError}</span> : null}
              {!createError ? (
                <span className="text-sm text-muted-foreground">
                  This creates the county run record and initial stage state. If a worker endpoint is configured, enqueue can dispatch the background bootstrap directly.
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <ErrorState
          title="Unable to load county runs"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <EmptyState
          title="No county runs yet"
          description="Once county onboarding jobs are created, they will appear here with stage, caveats, and artifact access."
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {items.map((item) => {
          const card = buildCountyRunUiCard({
            geographyLabel: item.geographyLabel,
            manifest: null,
            stage: item.stage,
          });
          const enqueueLabel = getCountyRunEnqueueStatusLabel(item.enqueueStatus ?? "not-enqueued");
          const enqueueTone = getCountyRunEnqueueStatusTone(item.enqueueStatus ?? "not-enqueued");
          const enqueueHelp = getCountyRunEnqueueHelpText(item.enqueueStatus ?? "not-enqueued");

          return (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>{item.geographyLabel}</CardTitle>
                    <CardDescription>{item.runName}</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={card.tone}>{card.stageLabel}</StatusBadge>
                    {item.statusLabel ? <StatusBadge tone={card.tone}>{item.statusLabel}</StatusBadge> : null}
                    <StatusBadge tone={enqueueTone}>{enqueueLabel}</StatusBadge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <div className="font-medium text-foreground">Allowed claim</div>
                  <p className="mt-1 text-muted-foreground">{card.allowedClaim}</p>
                </div>
                <div>
                  <div className="font-medium text-foreground">Next action</div>
                  <p className="mt-1 text-muted-foreground">{card.nextAction}</p>
                </div>
                <div>
                  <div className="font-medium text-foreground">Execution status</div>
                  <p className="mt-1 text-muted-foreground">{enqueueHelp}</p>
                  {item.lastEnqueuedAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last enqueued {new Date(item.lastEnqueuedAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3 pt-2">
                  <span className="text-xs text-muted-foreground">Updated {new Date(item.updatedAt).toLocaleString()}</span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/county-runs/${item.id}`}>Open detail</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
