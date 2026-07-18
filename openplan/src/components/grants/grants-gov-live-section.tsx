"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, Plus, RadioTower, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { isGrantProgramTracked } from "@/lib/grants/program-catalog";
import {
  GRANTS_GOV_SYNC_CAVEAT,
  describeGrantsGovWindow,
  toFundingOpportunityDraft,
  type GrantsGovOpportunity,
} from "@/lib/grants/grants-gov";

/**
 * Live federal opportunity discovery from grants.gov, lazy-loaded on demand
 * so /grants never blocks on (or breaks with) the external API. Tracking a
 * row creates a workspace funding_opportunities record through the same
 * route the curated catalog uses — with real open/close dates attached.
 */
type LoadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "offline" }
  | { phase: "error" }
  | {
      phase: "loaded";
      opportunities: GrantsGovOpportunity[];
      hitCount: number;
      fetchedAt: string;
      cached: boolean;
    };

export function GrantsGovLiveSection({ trackedTitles }: { trackedTitles: string[] }) {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ phase: "idle" });
  const [keywordInput, setKeywordInput] = useState("");
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [locallyTrackedIds, setLocallyTrackedIds] = useState<readonly string[]>([]);
  const [trackError, setTrackError] = useState<string | null>(null);

  async function loadOpportunities() {
    setLoadState({ phase: "loading" });
    setTrackError(null);
    try {
      const params = new URLSearchParams();
      const keyword = keywordInput.trim().slice(0, 120);
      if (keyword) params.set("keyword", keyword);
      const query = params.toString();
      const response = await fetch(`/api/grants-gov/opportunities${query ? `?${query}` : ""}`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        // Only an upstream failure is grants.gov's fault; anything else
        // (session, validation) gets neutral local copy.
        setLoadState(response.status === 502 ? { phase: "offline" } : { phase: "error" });
        return;
      }
      const payload = (await response.json()) as {
        opportunities: GrantsGovOpportunity[];
        hitCount: number;
        fetchedAt: string;
        cached: boolean;
      };
      setLoadState({
        phase: "loaded",
        opportunities: payload.opportunities ?? [],
        hitCount: payload.hitCount ?? 0,
        fetchedAt: payload.fetchedAt,
        cached: Boolean(payload.cached),
      });
    } catch {
      setLoadState({ phase: "offline" });
    }
  }

  async function handleTrack(opportunity: GrantsGovOpportunity) {
    setPendingIds((previous) => new Set(previous).add(opportunity.id));
    setTrackError(null);
    try {
      const response = await fetch("/api/funding-opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toFundingOpportunityDraft(opportunity)),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to track this opportunity");
      }
      setLocallyTrackedIds((previous) => [...previous, opportunity.id]);
      router.refresh();
    } catch (error) {
      setTrackError(error instanceof Error ? error.message : "Failed to track this opportunity");
    } finally {
      setPendingIds((previous) => {
        const next = new Set(previous);
        next.delete(opportunity.id);
        return next;
      });
    }
  }

  const renderedNow = new Date();

  return (
    <article className="module-section-surface" id="grants-gov-live" data-testid="grants-gov-live">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <RadioTower className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Discovery — live</p>
            <h2 className="module-section-title">Live federal opportunities (grants.gov)</h2>
            <p className="module-section-description">
              Posted and forecasted transportation-category notices straight from the grants.gov
              Search API, loaded on demand and cached for 30 minutes. Track one to create a shared
              opportunity record with its real open and close dates attached.
            </p>
          </div>
        </div>
        <span className="module-inline-item">Synopsis-level — the NOFO is the record</span>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="block max-w-xs flex-1 text-xs font-medium text-muted-foreground">
          Keyword (optional)
          <Input
            className="mt-1"
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
            placeholder="e.g. safety, transit, bridge"
            maxLength={120}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={loadOpportunities}
          disabled={loadState.phase === "loading"}
          data-testid="grants-gov-load"
        >
          {loadState.phase === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {loadState.phase === "idle" ? "Load live opportunities" : "Reload"}
        </Button>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{GRANTS_GOV_SYNC_CAVEAT}</p>

      {trackError ? <p className="mt-3 text-sm text-destructive">{trackError}</p> : null}

      {loadState.phase === "offline" ? (
        <div
          className="mt-4 rounded-[0.75rem] border border-dashed border-border/60 bg-background/60 px-5 py-4 text-sm text-muted-foreground"
          data-testid="grants-gov-offline"
        >
          grants.gov is unreachable from this environment right now. The grants lane keeps working
          from the curated program catalog and your tracked opportunities — try loading again later.
        </div>
      ) : null}

      {loadState.phase === "error" ? (
        <div
          className="mt-4 rounded-[0.75rem] border border-dashed border-border/60 bg-background/60 px-5 py-4 text-sm text-muted-foreground"
          data-testid="grants-gov-error"
        >
          Couldn&apos;t load live opportunities — check your session and search terms, then try
          again.
        </div>
      ) : null}

      {loadState.phase === "loaded" ? (
        loadState.opportunities.length === 0 ? (
          <div
            className="mt-4 rounded-[0.75rem] border border-dashed border-border/60 bg-background/60 px-5 py-4 text-sm text-muted-foreground"
            data-testid="grants-gov-empty"
          >
            grants.gov returned no posted or forecasted transportation-category notices for this
            search. Broaden the keyword or check back after the next federal posting cycle.
          </div>
        ) : (
          <>
            <p className="mt-4 text-xs text-muted-foreground">
              Showing {loadState.opportunities.length} of {loadState.hitCount} matches · fetched{" "}
              {new Date(loadState.fetchedAt).toLocaleTimeString("en-US")}{" "}
              {loadState.cached ? "(cached)" : "(live)"}
            </p>
            <div className="mt-2 divide-y divide-border/60 rounded-2xl border border-border/60 bg-background/70">
              {loadState.opportunities.map((opportunity) => {
                const window = describeGrantsGovWindow(opportunity, renderedNow);
                // Compare the same truncated title that actually gets stored,
                // so >160-char titles still read as tracked after a reload.
                const isTracked =
                  isGrantProgramTracked(
                    { name: toFundingOpportunityDraft(opportunity).title },
                    trackedTitles
                  ) || locallyTrackedIds.includes(opportunity.id);
                const isPending = pendingIds.has(opportunity.id);

                return (
                  <div
                    key={opportunity.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{opportunity.title}</p>
                        <StatusBadge tone={window.tone}>{window.label}</StatusBadge>
                      </div>
                      <p className="text-[0.8rem] text-muted-foreground">
                        {opportunity.agencyName ?? "Agency not listed"} ·{" "}
                        {opportunity.number || `grants.gov #${opportunity.id}`}
                        {opportunity.cfdaList.length > 0
                          ? ` · Assistance listing ${opportunity.cfdaList.join(", ")}`
                          : ""}
                      </p>
                      <a
                        href={opportunity.detailUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[0.8rem] font-semibold text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
                      >
                        Synopsis on grants.gov
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>

                    <div className="shrink-0 pt-0.5">
                      {isTracked ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--pine)]">
                          <Check className="h-4 w-4" />
                          Tracked
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleTrack(opportunity)}
                        >
                          {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                          Track as opportunity
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )
      ) : null}
    </article>
  );
}
