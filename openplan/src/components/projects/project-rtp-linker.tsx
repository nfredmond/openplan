"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Route as RouteIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatRtpCycleStatusLabel,
  formatRtpPortfolioRoleLabel,
  RTP_PORTFOLIO_ROLE_OPTIONS,
  rtpCycleStatusTone,
  rtpPortfolioRoleTone,
} from "@/lib/rtp/catalog";

type AvailableCycle = {
  id: string;
  title: string;
  status: string;
  geographyLabel: string | null;
  horizonStartYear: number | null;
  horizonEndYear: number | null;
};

type ExistingLink = {
  id: string;
  rtpCycleId: string;
  title: string;
  status: string;
  geographyLabel: string | null;
  horizonStartYear: number | null;
  horizonEndYear: number | null;
  portfolioRole: string;
  priorityRationale: string | null;
};

export function ProjectRtpLinker({
  projectId,
  availableCycles,
  existingLinks,
}: {
  projectId: string;
  availableCycles: AvailableCycle[];
  existingLinks: ExistingLink[];
}) {
  const router = useRouter();
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [portfolioRole, setPortfolioRole] = useState<(typeof RTP_PORTFOLIO_ROLE_OPTIONS)[number]["value"]>("candidate");
  const [priorityRationale, setPriorityRationale] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkedCycleIds = useMemo(() => new Set(existingLinks.map((link) => link.rtpCycleId)), [existingLinks]);
  const attachableCycles = availableCycles.filter((cycle) => !linkedCycleIds.has(cycle.id));

  async function handleAttach(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCycleId) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/rtp-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rtpCycleId: selectedCycleId,
          portfolioRole,
          priorityRationale: priorityRationale || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to link RTP cycle");
      }

      setSelectedCycleId("");
      setPortfolioRole("candidate");
      setPriorityRationale("");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to link RTP cycle");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemove(linkId: string) {
    setError(null);
    setRemovingId(linkId);

    try {
      const response = await fetch(`/api/projects/${projectId}/rtp-links`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkId }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to remove RTP link");
      }

      router.refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove RTP link");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
            <RouteIcon className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">RTP portfolio linkage</p>
            <h2 className="module-section-title">Attach this project to one or more RTP cycles</h2>
            <p className="module-section-description">
              This is the first real bridge between project records and the regional plan update ledger.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {existingLinks.length === 0 ? (
          <div className="module-empty-state text-sm">
            No RTP cycles linked yet. Attach one to start building constrained, illustrative, or candidate portfolio posture.
          </div>
        ) : (
          <div className="module-record-list">
            {existingLinks.map((link) => (
              <div key={link.id} className="module-record-row">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={rtpPortfolioRoleTone(link.portfolioRole)}>{formatRtpPortfolioRoleLabel(link.portfolioRole)}</StatusBadge>
                      <StatusBadge tone={rtpCycleStatusTone(link.status)}>{formatRtpCycleStatusLabel(link.status)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title text-[1.02rem]">{link.title}</h3>
                        <button
                          type="button"
                          onClick={() => handleRemove(link.id)}
                          disabled={removingId === link.id}
                          className="openplan-text-action openplan-text-action-muted"
                        >
                          {removingId === link.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          Remove
                        </button>
                      </div>
                      <p className="module-record-summary line-clamp-3">
                        {link.priorityRationale?.trim() || "No prioritization rationale recorded yet for this RTP linkage."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="module-record-meta">
                  {link.geographyLabel ? (
                    <span className="module-record-chip"><span>Geography</span><strong>{link.geographyLabel}</strong></span>
                  ) : null}
                  {typeof link.horizonStartYear === "number" && typeof link.horizonEndYear === "number" ? (
                    <span className="module-record-chip"><span>Horizon</span><strong>{link.horizonStartYear}–{link.horizonEndYear}</strong></span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        <form className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-4" onSubmit={handleAttach}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(12rem,0.75fr)]">
            <div className="space-y-1.5">
              <label htmlFor="project-rtp-cycle" className="text-[0.82rem] font-semibold">
                RTP cycle
              </label>
              <select
                id="project-rtp-cycle"
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
                value={selectedCycleId}
                onChange={(event) => setSelectedCycleId(event.target.value)}
                disabled={attachableCycles.length === 0 || isSubmitting}
                required
              >
                <option value="">Select an RTP cycle</option>
                {attachableCycles.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="project-rtp-role" className="text-[0.82rem] font-semibold">
                Portfolio role
              </label>
              <select
                id="project-rtp-role"
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
                value={portfolioRole}
                onChange={(event) => setPortfolioRole(event.target.value as (typeof RTP_PORTFOLIO_ROLE_OPTIONS)[number]["value"])}
                disabled={isSubmitting}
              >
                {RTP_PORTFOLIO_ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="project-rtp-rationale" className="text-[0.82rem] font-semibold">
              Prioritization rationale
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Textarea
              id="project-rtp-rationale"
              rows={3}
              placeholder="Why is this project constrained, illustrative, or still a candidate in this cycle?"
              value={priorityRationale}
              onChange={(event) => setPriorityRationale(event.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {error ? (
            <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={isSubmitting || attachableCycles.length === 0 || !selectedCycleId}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Attach RTP cycle
          </Button>

          {attachableCycles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Every available RTP cycle in this workspace is already linked to this project.
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
