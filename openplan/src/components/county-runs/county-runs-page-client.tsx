"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useCountyRunMutations, useCountyRuns } from "@/lib/hooks/use-county-onramp";
import {
  getCountyRunEnqueueHelpText,
  getCountyRunEnqueueStatusLabel,
  getCountyRunEnqueueStatusTone,
} from "@/lib/models/county-onramp";
import { buildCountyRunUiCard } from "@/lib/ui/county-onramp";
import { buildCountyRunDetailHref } from "@/lib/ui/county-runs-navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";

export function CountyRunsPageClient({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { items, loading, error, refresh } = useCountyRuns({
    workspaceId,
    limit: 25,
    refreshMs: 15000,
  });
  const { create, loading: creating, error: createError } = useCountyRunMutations();
  const [countyFips, setCountyFips] = useState("");
  const [geographyLabel, setGeographyLabel] = useState("");
  const [countyPrefix, setCountyPrefix] = useState("");
  const [runName, setRunName] = useState("");

  const currentViewHref = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const suggestedRunName = useMemo(() => {
    const prefix = geographyLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!prefix || !countyFips.trim()) return "";
    return `${prefix || "county"}-runtime`;
  }, [geographyLabel, countyFips]);

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextRunName = runName.trim() || suggestedRunName;
    const nextPrefix = countyPrefix.trim().toUpperCase();
    const nextLabel = geographyLabel.trim();
    const nextFips = countyFips.trim();
    if (!nextRunName || !nextPrefix || !nextLabel || !nextFips) return;

    const created = await create({
      workspaceId,
      geographyType: "county_fips",
      geographyId: nextFips,
      geographyLabel: nextLabel,
      runName: nextRunName,
      countyPrefix: nextPrefix,
      runtimeOptions: { keepProject: true },
    });

    if (created?.countyRunId) {
      await refresh();
      router.push(buildCountyRunDetailHref(created.countyRunId, currentViewHref));
    }
  };

  return (
    <section className="module-page pb-10">
      <div className="module-intro-card">
        <div className="module-intro-kicker">County onboarding</div>
        <div className="module-intro-body">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">Pilot validation lane</StatusBadge>
            <StatusBadge tone="neutral">25 most recent runs</StatusBadge>
          </div>
          <h1 className="module-intro-title">County runs</h1>
          <p className="module-intro-description">
            Track geography-first county onboarding from bootstrap through validation scaffolding. This page is meant to
            stay operational: launch a run, check stage truth, then open detail for artifacts, worker handoff, and caveats.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <StateBlock
        className="mt-4"
        title="What this page can confirm"
        description="County stages, operator-safe status labels, and bootstrap state shown here reflect recorded application state. Validation quality still depends on the underlying scaffold and rerun evidence on each detail page."
        tone="info"
        compact
      />

      <Card className="mb-4 mt-4">
        <CardHeader>
          <CardTitle>Launch county onboarding</CardTitle>
          <CardDescription>
            Create a county run record to begin the geography-first onboarding workflow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={submitCreate}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">County FIPS</label>
              <Input value={countyFips} onChange={(e) => setCountyFips(e.target.value)} placeholder="06061" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Geography label</label>
              <Input
                value={geographyLabel}
                onChange={(e) => setGeographyLabel(e.target.value)}
                placeholder="Placer County, CA"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">County prefix</label>
              <Input value={countyPrefix} onChange={(e) => setCountyPrefix(e.target.value)} placeholder="PLACER" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Run name</label>
              <Input
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder={suggestedRunName || "placer-county-runtime"}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1 md:col-span-2 xl:col-span-4">
              <Button type="submit" disabled={creating}>
                Launch county run
              </Button>
              {createError ? <span className="text-sm text-destructive">{createError}</span> : null}
              {!createError ? (
                <span className="text-sm text-muted-foreground">
                  This creates the county run record and initial stage state. Bootstrap and validation evidence continue on the detail surface.
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <StateBlock
          title="Unable to load county runs"
          description={error}
          tone="danger"
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <StateBlock
          title="No county runs yet"
          description="Once county onboarding jobs are created, they will appear here with stage truth, bootstrap posture, and detail links for artifacts and validation guidance."
          tone="neutral"
        />
      ) : null}

      {!error && items.length > 0 ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recent runs</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">Current county onboarding records</h2>
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {items.length} visible
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {items.map((item) => {
          const stageReasonLabel = (item as { stageReasonLabel?: string }).stageReasonLabel ?? null;
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
                {stageReasonLabel ? (
                  <div>
                    <div className="font-medium text-foreground">Why this stage</div>
                    <p className="mt-1 text-muted-foreground">{stageReasonLabel}</p>
                  </div>
                ) : null}
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
                    <Link href={buildCountyRunDetailHref(item.id, currentViewHref)}>Open detail</Link>
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
