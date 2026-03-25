"use client";

import Link from "next/link";
import { RefreshCcw } from "lucide-react";
import { useCountyRuns } from "@/lib/hooks/use-county-onramp";
import { buildCountyRunUiCard } from "@/lib/ui/county-onramp";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";

export function CountyRunsPageClient({ workspaceId }: { workspaceId: string }) {
  const { items, loading, error, refresh } = useCountyRuns({ workspaceId, limit: 25 });

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

      {error ? (
        <StateBlock
          title="Unable to load county runs"
          description={error}
          tone="danger"
          action={{ label: "Retry", onClick: () => void refresh() }}
        />
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <StateBlock
          title="No county runs yet"
          description="Once county onboarding jobs are created, they will appear here with stage, caveats, and artifact access."
          tone="neutral"
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {items.map((item) => {
          const card = buildCountyRunUiCard({
            geographyLabel: item.geographyLabel,
            manifest: null,
            stage: item.stage,
          });

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
