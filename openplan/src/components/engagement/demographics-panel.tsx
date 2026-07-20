import type { DemographicsSummary } from "@/lib/engagement/demographics";

function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

/** A relative band bar. Scaled to the largest band in its dimension and labeled
 * with the raw count — no percentage, since suppression + multi-select race make
 * a "share" misleading. Meaning survives desaturation (design-constitution test). */
function BandBar({ label, count, max, muted }: { label: string; count: number; max: number; muted?: boolean }) {
  const width = max > 0 ? Math.max(4, (count / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className={muted ? "text-muted-foreground" : "text-foreground"}>{label}</span>
        <span className="tabular-nums text-muted-foreground">{count}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${muted ? "bg-slate-400/50" : "bg-sky-500/60"}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

const DIMENSIONS: Array<{ key: keyof DemographicsSummary["dimensions"]; label: string }> = [
  { key: "age_band", label: "Age" },
  { key: "primary_language", label: "Primary language" },
  { key: "household_tenure", label: "Housing tenure" },
  { key: "race_ethnicity", label: "Race / ethnicity" },
];

export function DemographicsPanel({ summary }: { summary: DemographicsSummary }) {
  if (!summary.hasAny) {
    return (
      <p className="text-xs text-muted-foreground">
        No respondents have shared optional demographics yet. Bands appear once at least a few respondents answer
        (small groups are suppressed).
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {summary.respondentsWithDemographics} respondent{summary.respondentsWithDemographics === 1 ? "" : "s"} shared
        optional demographics.
        {summary.hasSuppressed ? " Small groups (fewer than 5) are collapsed into “Small groups (suppressed).”" : ""}
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        {DIMENSIONS.map((dimension) => {
          const bands = summary.dimensions[dimension.key];
          if (bands.length === 0) return null;
          const max = bands.reduce((acc, band) => Math.max(acc, band.count), 0);
          return (
            <div key={dimension.key} className="space-y-2">
              <SubLabel>{dimension.label}</SubLabel>
              {bands.map((band) => (
                <BandBar key={band.band} label={band.label} count={band.count} max={max} muted={band.band === "suppressed"} />
              ))}
            </div>
          );
        })}
      </div>

      <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{summary.caveat}</p>
    </div>
  );
}
