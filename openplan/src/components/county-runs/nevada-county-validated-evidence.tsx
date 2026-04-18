import { AlertTriangle, ShieldCheck } from "lucide-react";
import {
  NEVADA_COUNTY_CAVEATS_VERBATIM,
  NEVADA_COUNTY_PROOF_DOC_PATH,
  NEVADA_COUNTY_RUN_CONTEXT,
  NEVADA_COUNTY_SCREENING_GATE,
  nevadaCountyMaxApeRow,
} from "@/lib/examples/nevada-county-2026-03-24";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * Surfaces the Nevada County 2026-03-24 validated-screening evidence block
 * inside the authed workspace. Intentionally matches the verbatim strings
 * rendered on the public /examples page so operators see the same language
 * an external reviewer would see.
 */
export function NevadaCountyValidatedEvidence() {
  const maxApe = nevadaCountyMaxApeRow();

  return (
    <section
      aria-label="Validated screening evidence — Nevada County 2026-03-24"
      className="mt-4 rounded-[0.5rem] border border-amber-400/45 bg-amber-400/10 p-5 text-amber-950 dark:text-amber-100"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center border border-amber-400/35 bg-amber-400/10">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">
              Validated screening evidence
            </p>
            <h2 className="text-base font-semibold tracking-tight">
              Run {NEVADA_COUNTY_RUN_CONTEXT.runId}
            </h2>
            <p className="mt-1 text-sm opacity-85">
              {NEVADA_COUNTY_RUN_CONTEXT.engine}. Counts source:{" "}
              {NEVADA_COUNTY_RUN_CONTEXT.countsSource}. Artifact generated{" "}
              {NEVADA_COUNTY_RUN_CONTEXT.createdAt}.
            </p>
          </div>
        </div>
        <StatusBadge tone="warning">{NEVADA_COUNTY_SCREENING_GATE.statusLabel}</StatusBadge>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr]">
        <div className="rounded-[0.375rem] border border-amber-400/35 bg-background/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-75">
            Screening gate (verbatim)
          </p>
          <p className="mt-1 text-sm font-semibold">
            {NEVADA_COUNTY_SCREENING_GATE.statusLabel}
          </p>
          <p className="mt-1 text-xs opacity-85">
            {NEVADA_COUNTY_SCREENING_GATE.reason}
          </p>
        </div>

        <div className="rounded-[0.375rem] border border-amber-400/35 bg-background/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-75">
            {maxApe.label}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{maxApe.value}</p>
          {maxApe.note ? (
            <p className="mt-1 text-xs opacity-85">{maxApe.note}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-[0.375rem] border border-amber-400/35 bg-background/40 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-75">
          Caveats (verbatim — five)
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {NEVADA_COUNTY_CAVEATS_VERBATIM.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </div>

      <p className="mt-4 flex items-start gap-2 border-t border-amber-400/30 pt-3 text-xs opacity-85">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Full operator-facing proof record (workflow, runtime commands, artifact paths):{" "}
          <code className="rounded bg-background/50 px-1 py-0.5 text-[11px]">
            {NEVADA_COUNTY_PROOF_DOC_PATH}
          </code>
        </span>
      </p>
    </section>
  );
}
