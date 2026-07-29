import { AlertTriangle, Scale } from "lucide-react";
import { JOINT_READING_LABELS } from "@/lib/engagement/joint-representativeness";
import type { JointRepresentativeness } from "@/lib/engagement/joint-representativeness";

/**
 * The E5c joint reading. Server-rendered: it derives from two caches the page
 * already holds, so there is nothing to fetch and nothing to click.
 *
 * The layout deliberately shows BOTH signals as separate cards with their own
 * denominators before it shows any combined sentence. The pair is only useful
 * because the two halves count different people, and a design that merged them
 * into one bar would hide exactly the fact that makes the reading honest.
 */

const READING_TONE: Record<JointRepresentativeness["reading"], string> = {
  no_signal: "text-muted-foreground",
  self_reported_unreadable: "text-amber-700 dark:text-amber-300",
  ecological_only: "text-muted-foreground",
  self_reported_only: "text-muted-foreground",
  floor_at_or_above_area: "text-sky-700 dark:text-sky-300",
  floor_below_area: "text-muted-foreground",
};

function SignalCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{subtitle}</p>
      <div className="mt-2 space-y-1 text-xs">{children}</div>
    </div>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="text-xs text-muted-foreground">{reason}</p>;
}

export function JointRepresentativenessPanel({
  joint,
  /**
   * Whether the spatial screening panel is actually rendered on this page. It is
   * gated on the campaign having approved, map-located comments, so "run the
   * screening below" is a lie on a campaign that has none — and an instruction
   * the product gives a planner has to work.
   */
  spatialScreeningAvailable,
}: {
  joint: JointRepresentativeness;
  spatialScreeningAvailable: boolean;
}) {
  const { ecological, selfReported } = joint;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        {joint.reading === "self_reported_unreadable" ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="space-y-1">
          <p className={`text-sm font-semibold ${READING_TONE[joint.reading]}`}>
            {JOINT_READING_LABELS[joint.reading]}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{joint.headline}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SignalCard
          title="Area baseline (ACS)"
          subtitle="Residents of color in the study area — everyone not White alone, non-Hispanic."
        >
          {ecological && ecological.areaBaselinePct !== null ? (
            <>
              <p className="tabular-nums text-foreground">{ecological.areaBaselinePct}% of study-area residents</p>
              <p className="text-muted-foreground">
                {ecological.mappedRespondentCount} of {ecological.locatedRespondentCount} located respondent
                {ecological.locatedRespondentCount === 1 ? "" : "s"} across {ecological.tractCount} tract
                {ecological.tractCount === 1 ? "" : "s"}
                {ecological.respondentAreaPct !== null
                  ? ` · respondent tracts ${ecological.respondentAreaPct}%`
                  : ""}
              </p>
            </>
          ) : (
            <Unavailable
              reason={
                ecological
                  ? "The screening ran but produced no ACS share for this area, so there is nothing to compare against."
                  : spatialScreeningAvailable
                    ? "Not computed yet. Run the spatial screening below to produce an area baseline."
                    : "Not computed. The area-based screening needs approved comments carrying a map location, and this campaign has none yet."
              }
            />
          )}
        </SignalCard>

        <SignalCard
          title="Self-reported floor"
          subtitle="A lower bound over respondents who chose to share demographics — never a share."
        >
          {selfReported ? (
            <>
              <p className="tabular-nums text-foreground">
                ≥ {selfReported.floorPct}% ({selfReported.floorRespondentCount} of{" "}
                {selfReported.denominatorRespondents} respondent
                {selfReported.denominatorRespondents === 1 ? "" : "s"})
              </p>
              <p className="text-muted-foreground">
                From the largest qualifying category: {selfReported.floorBandLabel}
                {selfReported.countedBandLabels.length > 1
                  ? ` · also reported: ${selfReported.countedBandLabels.slice(1).join(", ")}`
                  : ""}
              </p>
            </>
          ) : (
            <Unavailable
              reason={
                joint.reading === "self_reported_unreadable"
                  ? `Could not be read${joint.readFailureMessage ? `: ${joint.readFailureMessage}` : ""}. This is unknown, not empty.`
                  : "No respondent has shared a race or ethnicity category that can be compared, so the respondents themselves are not described here."
              }
            />
          )}
        </SignalCard>
      </div>

      <div className="space-y-1">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
          What this cannot say
        </p>
        <ul className="space-y-1 text-[0.7rem] leading-relaxed text-muted-foreground">
          {joint.limits.map((limit) => (
            <li key={limit}>• {limit}</li>
          ))}
        </ul>
      </div>

      <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{joint.dimension.rationale}</p>
      <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{joint.caveat}</p>
    </div>
  );
}
