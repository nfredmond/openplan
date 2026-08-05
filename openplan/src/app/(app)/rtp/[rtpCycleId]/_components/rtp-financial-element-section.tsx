/**
 * The financial element of an RTP cycle, and its performance measures.
 *
 * Extracted from the cycle page rather than inlined, because the page hit its
 * 1,200-line cap — which is the right forcing function: this is the section a
 * board reads to decide whether the plan can be paid for, and it deserves its
 * own file.
 *
 * A SERVER component. It renders a computed answer and mounts the three client
 * editors; it does no I/O of its own, so the page stays the single place that
 * decides what was read and what failed.
 */
import { Coins, Target } from "lucide-react";
import { RtpFinancialLedgerEditor } from "@/components/rtp/rtp-financial-ledger-editor";
import { RtpHorizonBandEditor } from "@/components/rtp/rtp-horizon-band-editor";
import { RtpPerformanceMeasureEditor } from "@/components/rtp/rtp-performance-measure-editor";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildRtpFiscalConstraint,
  describeRtpFiscalConstraint,
  rtpFiscalVerdictLabel,
  rtpFiscalVerdictTone,
  type RtpFiscalConstraintInput,
} from "@/lib/rtp/fiscal-constraint";

type BandProp = React.ComponentProps<typeof RtpHorizonBandEditor>["bands"];
type LineProp = React.ComponentProps<typeof RtpFinancialLedgerEditor>["lines"];
type MeasureProp = React.ComponentProps<typeof RtpPerformanceMeasureEditor>["measures"];

/** Whole dollars: a financial element is read in millions, and cents are noise. */
const PLAN_MONEY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatPlanMoney(value: number): string {
  return PLAN_MONEY_FORMATTER.format(value);
}

export function RtpFinancialElementSection({
  rtpCycleId,
  cycleFinancialBasisYear,
  annualInflationRate,
  projects,
  readFailed,
  bands,
  lines,
  measures,
  measuresReadFailed,
  canWrite,
}: {
  rtpCycleId: string;
  cycleFinancialBasisYear: number | null;
  annualInflationRate: number | string | null;
  projects: RtpFiscalConstraintInput["projects"];
  readFailed: boolean;
  bands: BandProp;
  lines: LineProp;
  measures: MeasureProp;
  measuresReadFailed: boolean;
  canWrite: boolean;
}) {
  // Computed here rather than on the page: it is a pure function of data the
  // page already passes down, and keeping it beside the markup that renders it
  // means the verdict and the table can never describe different inputs.
  const constraint = buildRtpFiscalConstraint({
    cycleFinancialBasisYear,
    annualInflationRate,
    bands,
    lines,
    projects,
  });

  return (
    <>

  {/*
    THE FINANCIAL ELEMENT. It lives in the WIDE column deliberately. The
    narrow aside beside it already carries a six-across metric grid, and
    a revenue ledger appended there would be unreadable — which is how a
    financial element ends up rewritten as prose inside a markdown
    chapter, leaving the constraint check with no rendered surface at
    all. A verdict no planner can see is the defect this module has
    shipped a dozen times.
  */}
  <article className="module-section-surface">
    <div className="module-section-header">
      <div className="module-section-heading">
        <p className="module-section-label">Financial element</p>
        <h2 className="module-section-title">Can this plan be paid for?</h2>
        <p className="module-section-description">
          The constrained programme, the revenue behind it, and the cost of operating and
          maintaining the system — compared period by period.
        </p>
      </div>
      <span className="flex h-11 w-11 items-center justify-center rounded-[0.6rem] border border-border/70 bg-muted/40 text-muted-foreground">
        <Coins className="h-5 w-5" />
      </span>
    </div>

    {readFailed ? (
      <StateBlock
        tone="danger"
        title="The financial element could not be fully read"
        description="Part of this plan's finances could not be loaded, so no fiscal-constraint finding is shown. This is not a finding that the plan has no revenue or no costs — do not re-enter figures on the strength of this page."
      />
    ) : (
      <div className="space-y-4">
        <div className="rounded-[0.5rem] border border-border/60 bg-muted/20 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={rtpFiscalVerdictTone(constraint.verdict)}>
              {rtpFiscalVerdictLabel(constraint.verdict)}
            </StatusBadge>
            <span className="text-xs text-muted-foreground">
              {constraint.dollarBasis === "year_of_expenditure"
                ? "Year-of-expenditure dollars"
                : "Constant dollars — no inflation rate recorded"}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {describeRtpFiscalConstraint(constraint)}
          </p>
          {constraint.unresolvedProjects.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {constraint.unresolvedProjects.map((item) => (
                <li key={item.linkId}>
                  {item.projectName ?? "An unnamed project"} —{" "}
                  {item.reason === "unpriced" ? "no cost recorded" : "not assigned to a period"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {constraint.bands.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">Period</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Revenue</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Projects</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">O&amp;M</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {constraint.bands.map((band) => (
                  <tr key={band.bandId} className="border-b border-border/40">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="text-foreground">{band.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {band.startYear}–{band.endYear}
                        {band.expenditureYearAssumed ? " · midpoint assumed for escalation" : null}
                      </span>
                    </th>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPlanMoney(band.revenue)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatPlanMoney(band.capitalCost)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatPlanMoney(band.operationsMaintenanceCost)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {band.verdict === "not_determined" ? "—" : formatPlanMoney(band.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <RtpHorizonBandEditor
          rtpCycleId={rtpCycleId}
          bands={bands}
          canWrite={canWrite}
        />
        <RtpFinancialLedgerEditor
          rtpCycleId={rtpCycleId}
          bands={bands}
          lines={lines}
          canWrite={canWrite}
        />
      </div>
    )}
  </article>

  <article className="module-section-surface">
    <div className="module-section-header">
      <div className="module-section-heading">
        <p className="module-section-label">Performance measures</p>
        <h2 className="module-section-title">What this plan is trying to move</h2>
        <p className="module-section-description">
          Baselines and targets, with the source each baseline came from.
        </p>
      </div>
      <span className="flex h-11 w-11 items-center justify-center rounded-[0.6rem] border border-border/70 bg-muted/40 text-muted-foreground">
        <Target className="h-5 w-5" />
      </span>
    </div>

    {measuresReadFailed ? (
      <StateBlock
        tone="danger"
        title="Performance measures could not be read"
        description="This plan's performance measures could not be loaded, so none are listed. This is not a finding that the plan has none."
      />
    ) : (
      <RtpPerformanceMeasureEditor
        rtpCycleId={rtpCycleId}
        measures={measures}
        canWrite={canWrite}
      />
    )}
  </article>

    </>
  );
}
