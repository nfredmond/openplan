"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { MAP_PACKAGE_ACTIVE_STATES } from "@/lib/map-packages/catalog";
import { formatBytes, mapPackageFailureSentence, mapPackageStateLabel, mapPackageStateTone } from "@/lib/map-packages/presentation";

type MapPackageViewFigure = { id: string; figure: string | null; title: string; alt: string | null; preview: string | null };
export type MapPackageViewRecord = {
  id: string;
  title: string;
  state: string;
  source: "agent" | "upload";
  model_id: string | null;
  failure_code: string | null;
  created_at: string;
  finished_at: string | null;
  progress: { message?: string; steps?: number; recent?: string[] } | null;
  receipt: {
    qa?: { checks: number; passed: number; failed: number; notes: number } | null;
    gates?: Record<string, string> | null;
    figures?: MapPackageViewFigure[];
    kitChanged?: boolean;
    durationMs?: number;
  } | null;
};
export type MapPackageViewFile = { name: string; role: string; bytes: number; verified_at: string | null };

const POLL_MS = 10_000;

/**
 * One package: live progress while the agent works, then the figures, the QA
 * result, the review gates and the download. The page reads the record again
 * every ten seconds until the package stops changing.
 */
export function MapPackageView({ initial, initialFiles }: { initial: MapPackageViewRecord; initialFiles: MapPackageViewFile[] }) {
  const [record, setRecord] = useState(initial);
  const [files, setFiles] = useState(initialFiles);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const active = (MAP_PACKAGE_ACTIVE_STATES as readonly string[]).includes(record.state);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/map-packages/${record.id}`, { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const payload = (await response.json()) as { package: MapPackageViewRecord; files: MapPackageViewFile[] };
      setRecord(current => ({ ...current, ...payload.package }));
      setFiles(payload.files);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, record.id]);

  async function stop() {
    const yes = await confirm({ headline: "Stop this package?", consequence: "The agent stops at its next check-in. Its folder stays on that computer.", confirmLabel: "Stop the package" });
    if (!yes) return;
    setStopping(true);
    setError(null);
    const response = await fetch(`/api/map-packages/${record.id}`, { method: "DELETE" }).catch(() => null);
    if (response?.ok) setRecord(current => ({ ...current, state: "cancelled", failure_code: "cancelled_by_user" }));
    else setError("The package could not be stopped. Try again.");
    setStopping(false);
  }

  const zip = files.find(file => file.role === "package_zip" && file.verified_at);
  const report = files.find(file => file.role === "run_report" && file.verified_at);
  const figures = record.receipt?.figures ?? [];
  const qa = record.receipt?.qa;
  const gates = record.receipt?.gates ? Object.entries(record.receipt.gates) : [];

  return (
    <div className="space-y-6">
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={mapPackageStateTone(record.state)}>{mapPackageStateLabel(record.state)}</StatusBadge>
        {active ? <Button type="button" variant="outline" size="sm" disabled={stopping} onClick={() => void stop()}>Stop</Button> : null}
        {zip ? (
          <a className="module-inline-action" href={`/api/map-packages/${record.id}/files/${encodeURIComponent(zip.name)}`}>
            Download package ({formatBytes(zip.bytes)})
          </a>
        ) : null}
        {report ? <a className="text-sm underline underline-offset-2" href={`/api/map-packages/${record.id}/files/${encodeURIComponent(report.name)}`}>Agent&apos;s report</a> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      {active && record.source === "agent" ? (
        <section aria-label="Progress" className="space-y-2 text-sm">
          <p>{record.state === "queued" ? "Waiting for the connector on your computer to pick this up." : record.progress?.message ?? "Working"}</p>
          {record.progress?.recent?.length ? (
            <ol className="space-y-0.5 text-xs text-muted-foreground">
              {record.progress.recent.slice(-8).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
            </ol>
          ) : null}
        </section>
      ) : null}

      {["failed", "cancelled", "interrupted"].includes(record.state) ? (
        <p className="text-sm">{mapPackageFailureSentence(record.failure_code)}</p>
      ) : null}

      {record.state === "ready" && qa ? (
        <p className="text-sm">
          {qa.passed} of {qa.checks} automated checks passed{qa.failed ? `, ${qa.failed} failed` : ""}{qa.notes ? `, ${qa.notes} ${qa.notes === 1 ? "needs" : "need"} a decision` : ""}.
          {record.receipt?.kitChanged ? " The agent extended the kit for this project." : ""}
        </p>
      ) : null}

      {gates.length ? (
        <section aria-labelledby="map-package-gates" className="space-y-1">
          <h2 id="map-package-gates" className="text-base font-semibold">Review</h2>
          <ul className="flex flex-wrap gap-2 text-xs">
            {gates.map(([gate, status]) => (
              <li key={gate}><StatusBadge tone={status === "passed" ? "success" : "neutral"}>{gate.replaceAll("_", " ")}: {status}</StatusBadge></li>
            ))}
          </ul>
        </section>
      ) : null}

      {figures.length ? (
        <section aria-labelledby="map-package-figures" className="space-y-3">
          <h2 id="map-package-figures" className="text-base font-semibold">Figures</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {figures.map(figure => (
              <li key={figure.id} className="space-y-1">
                {figure.preview && files.some(file => file.name === figure.preview && file.verified_at) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- streamed through an access-checked route, not a static asset
                  <img src={`/api/map-packages/${record.id}/files/${encodeURIComponent(figure.preview)}`} alt={figure.alt ?? figure.title} loading="lazy" className="w-full rounded border border-border" />
                ) : null}
                <p className="text-sm font-medium">{[figure.figure, figure.title].filter(Boolean).join(". ")}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {record.state === "ready" ? (
        <section aria-labelledby="map-package-next" className="space-y-2 text-sm">
          <h2 id="map-package-next" className="text-base font-semibold">Build it in ArcGIS Pro or QGIS</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Download the package and unzip it to a short local folder, such as <code>C:\GIS\</code>.</li>
            <li>For ArcGIS Pro, give <code>arcgis/AGENT_PROMPT.md</code> to an agent with computer use on that computer, or follow <code>arcgis/README.md</code>.</li>
            <li>For QGIS, open the project in <code>qgis/</code>, or give <code>qgis/AGENT_PROMPT.md</code> to an agent.</li>
          </ol>
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {record.source === "agent" ? "Built by Claude Fable 5.1 with the transportation GIS skill." : "Added by hand."}{" "}
        <Link href="/maps" className="underline underline-offset-2">All map packages</Link>
      </p>
    </div>
  );
}
