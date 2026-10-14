"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { AtpGrantResult, AtpProjectApplication } from "@/lib/planner-pack/types";

/**
 * The ATP scoring packet, read-only, on an application seeded from the ATP
 * template. The workspace decides whether to mount it (`isAtpApplication`);
 * the route refuses any other application. Every number comes from the
 * packet the server computed; this component formats and never fills a gap.
 */

type PacketPayload = {
  packet: AtpGrantResult | null;
  missing: "project" | null;
  scoreRun: { id: string; title: string | null; createdAt: string | null } | null;
};

const NOT_RECORDED = "Not recorded";

function formatScore(value: number | null): string {
  return value === null ? NOT_RECORDED : value.toFixed(1);
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function parsePayload(value: unknown): PacketPayload | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const packet = record.packet as AtpGrantResult | null | undefined;
  if (packet !== null && (!packet || !Array.isArray(packet.applications))) return null;
  const run = record.scoreRun as PacketPayload["scoreRun"] | undefined;
  return {
    packet,
    missing: record.missing === "project" ? "project" : null,
    scoreRun: run && typeof run.id === "string" ? run : null,
  };
}

function ScoreRow({
  label,
  value,
  supplyNote,
}: {
  label: string;
  value: number | null;
  supplyNote: string;
}) {
  return (
    <tr className="border-t border-border/60">
      <th scope="row" className="py-1 pr-3 text-left font-normal text-muted-foreground">
        {label}
      </th>
      <td className="py-1 pr-3 text-right tabular-nums text-foreground">{formatScore(value)}</td>
      <td className="py-1 text-muted-foreground">{value === null ? supplyNote : ""}</td>
    </tr>
  );
}

function ApplicationScores({
  app,
  hasRun,
}: {
  app: AtpProjectApplication;
  hasRun: boolean;
}) {
  const runNote = hasRun ? "The latest run withheld this score." : "Run a corridor analysis for this project.";
  const notComputed = "OpenPlan does not compute this score.";
  return (
    <div className="space-y-1" data-testid={`atp-packet-project-${app.project_id}`}>
      <p className="font-semibold text-foreground">{app.name}</p>
      <table className="w-full text-sm">
        <tbody>
          <ScoreRow label="Safety" value={app.safety_score} supplyNote={runNote} />
          <ScoreRow label="Equity" value={app.equity_score} supplyNote={runNote} />
          <ScoreRow label="Climate" value={app.climate_score} supplyNote={notComputed} />
          <ScoreRow label="Feasibility" value={app.feasibility_score} supplyNote={notComputed} />
          <ScoreRow
            label="Total (weighted 30/25/25/20)"
            value={app.total_score}
            supplyNote="Needs all four scores."
          />
          <tr className="border-t border-border/60">
            <th scope="row" className="py-1 pr-3 text-left font-normal text-muted-foreground">
              Sensitivity
            </th>
            <td className="py-1 pr-3 text-right text-foreground">
              {app.sensitivity_flag === "UNKNOWN" ? NOT_RECORDED : app.sensitivity_flag}
            </td>
            <td className="py-1 text-muted-foreground" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PortfolioSummary({ packet }: { packet: AtpGrantResult }) {
  const summary = packet.summary;
  if (!summary) return <p className="text-muted-foreground">No summary.</p>;

  const mean =
    summary.mean_total_score === null
      ? NOT_RECORDED
      : summary.scored_application_count < summary.application_count
        ? `${summary.mean_total_score.toFixed(1)} (partial: ${summary.scored_application_count} of ${summary.application_count} scored)`
        : summary.mean_total_score.toFixed(1);
  const equityRecorded = summary.equity_recorded_count > 0;
  const count = (value: number) => (equityRecorded ? String(value) : NOT_RECORDED);

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="atp-packet-summary">
      <dt className="text-muted-foreground">Mean total score</dt>
      <dd className="text-foreground">{mean}</dd>
      <dt className="text-muted-foreground">Disadvantaged community (SB 535)</dt>
      <dd className="text-foreground">{count(summary.dac_application_count)}</dd>
      <dt className="text-muted-foreground">Low-income (AB 1550)</dt>
      <dd className="text-foreground">{count(summary.low_income_application_count)}</dd>
      <dt className="text-muted-foreground">Tribal area</dt>
      <dd className="text-foreground">{count(summary.tribal_application_count)}</dd>
      {equityRecorded ? null : (
        <dd className="col-span-2 text-muted-foreground">
          OpenPlan has no SB 535, AB 1550 or tribal-area lookup yet. Check the CTC&apos;s current definitions.
        </dd>
      )}
    </dl>
  );
}

export function AtpScoringPacketPanel({ opportunityId }: { opportunityId: string }) {
  const [payload, setPayload] = useState<PacketPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/funding-opportunities/${opportunityId}/application/atp-packet`);
        const body = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          throw new Error(typeof body.error === "string" ? body.error : "Could not load the ATP scores");
        }
        const parsed = parsePayload(body);
        if (!parsed) throw new Error("Could not load the ATP scores");
        if (!cancelled) setPayload(parsed);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the ATP scores");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opportunityId]);

  const packet = payload?.packet ?? null;
  const run = payload?.scoreRun ?? null;

  return (
    <section className="space-y-2" data-testid="atp-scoring-packet" aria-label="ATP scores">
      <p className="text-label font-semibold text-foreground/70">ATP scores</p>
      {error ? <p className="text-destructive">{error}</p> : null}
      {!payload && !error ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading scores…
        </p>
      ) : null}
      {payload?.missing === "project" ? (
        <p className="text-muted-foreground">Link a project to this opportunity to see its ATP scores.</p>
      ) : null}
      {packet ? (
        <div className="space-y-3 rounded-xl border border-border/70 bg-background/70 px-3 py-3">
          <p className="text-muted-foreground">
            {run
              ? `Screening scores from ${run.title ?? "a corridor analysis"}${run.createdAt ? `, ${formatDate(run.createdAt)}` : ""}. They are not CTC scores.`
              : "No corridor analysis is linked to this project."}
          </p>
          {packet.applications.map((app) => (
            <ApplicationScores key={app.project_id} app={app} hasRun={run !== null} />
          ))}
          <PortfolioSummary packet={packet} />
          <a
            className="inline-flex items-center gap-1.5 font-semibold text-[color:var(--pine)] underline-offset-2 hover:underline"
            href={`/api/funding-opportunities/${opportunityId}/application/atp-packet?format=markdown`}
            download
          >
            <Download className="h-4 w-4" /> Download ATP report
          </a>
        </div>
      ) : null}
    </section>
  );
}
