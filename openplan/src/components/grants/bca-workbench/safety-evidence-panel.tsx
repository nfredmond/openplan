import { useState } from "react";
import Link from "next/link";
import type { BcaDocument } from "@/lib/bca/workbench/schema";
import type { BcaCountedSegment, BcaSafetyEvidenceRead, BcaSafetyPlanOffer, BcaUnresolvedSegment } from "@/lib/safety/bca-evidence";
import {
  BCA_PERSONS_NOTE,
  BCA_RECORDED_COUNTS_NOTE,
  addBcaSafetyStream,
  bcaSeriousInjuryCell,
  bcaSeriousInjuryNote,
  type BcaSafetyOutcome,
} from "@/lib/bca/workbench/safety-evidence";
import { Field, NumberField, buttonClass, selectClass } from "./fields";

type ReadyPlan = Extract<BcaSafetyPlanOffer, { status: "ready" }>;

/** A treated segment with no count to offer. It says why and offers no stream. */
function UnresolvedSegment({ segment }: { segment: BcaUnresolvedSegment }) {
  return (
    <div className="min-w-0 space-y-2 border-t pt-3">
      <p className="font-medium">{segment.segmentLabel}</p>
      <p className="text-xs text-muted-foreground">Segment {segment.segmentId}</p>
      <p role="alert" className="text-sm">{segment.reason}</p>
    </div>
  );
}

function SegmentStream({ plan, segment, doc, onChange, onNotice }: {
  plan: ReadyPlan; segment: BcaCountedSegment; doc: BcaDocument;
  onChange: (doc: BcaDocument) => void; onNotice: (text: string) => void;
}) {
  const [outcome, setOutcome] = useState<BcaSafetyOutcome>("fatality");
  const [persons, setPersons] = useState<number | null>(null);
  const [cmf, setCmf] = useState<number | null>(null);
  const [cmfId, setCmfId] = useState<number | null>(null);
  const recordedFatalities = outcome === "fatality" ? segment.fatalities : null;
  return (
    <fieldset className="min-w-0 space-y-3 border-t pt-3">
      <legend className="font-medium">{segment.segmentLabel}</legend>
      <p className="text-xs text-muted-foreground">Segment {segment.segmentId}</p>
      {segment.countermeasures.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {segment.countermeasures.map((entry) => <li key={entry.id}>{entry.name}. {entry.listStatus ? `${entry.listStatus} ` : ""}{entry.cmfNote}</li>)}
        </ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-64 text-sm tabular-nums">
          <caption className="sr-only">Recorded crashes on {segment.segmentLabel} by year</caption>
          <thead><tr><th scope="col" className="text-left">Year</th><th scope="col" className="text-right">Fatal crashes</th><th scope="col" className="text-right">Serious-injury crashes</th></tr></thead>
          <tbody>
            {segment.years.map((row) => (
              <tr key={row.year}>
                <th scope="row" className="text-left font-normal">{row.year}</th>
                <td className="text-right">{row.fatalCrashes}</td>
                <td className="text-right">{row.seriousInjuryCrashes ?? bcaSeriousInjuryCell(plan.seriousInjury)}</td>
              </tr>
            ))}
            <tr className="border-t font-medium">
              <th scope="row" className="text-left">Total</th>
              <td className="text-right">{segment.fatalCrashes}</td>
              <td className="text-right">{segment.seriousInjuryCrashes ?? bcaSeriousInjuryCell(plan.seriousInjury)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm">
        People killed: {segment.fatalities ?? `not recorded for ${segment.fatalCrashesWithoutPersonCount} fatal crashes`}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Outcome to count">
          <select className={selectClass} value={outcome} onChange={(e) => setOutcome(e.target.value as BcaSafetyOutcome)}>
            <option value="fatality">Fatalities, persons</option>
            <option value="serious-injury" disabled={plan.seriousInjury !== "counted"}>Serious injuries, persons</option>
          </select>
        </Field>
        {recordedFatalities === null && (
          <NumberField label={outcome === "fatality" ? "Fatalities, persons, from crash reports" : "Serious injuries, persons, from crash reports"}
            value={persons} onChange={setPersons} />
        )}
        <NumberField label="Crash modification factor (not percent)" value={cmf} onChange={setCmf} />
        <NumberField label="CMF Clearinghouse ID" value={cmfId} onChange={setCmfId} />
      </div>
      <button
        className={buttonClass}
        onClick={() => {
          try {
            onChange(addBcaSafetyStream(doc, plan, segment, { outcome, persons, cmf, cmfId }));
            onNotice("Added a safety stream with its crash source and CMF. Pick a per-person value under Benefits and costs.");
          } catch (e) {
            onNotice(e instanceof Error ? e.message : "Could not add the stream.");
          }
        }}
      >
        Add safety stream for this segment
      </button>
    </fieldset>
  );
}

/** Saved safety plans on this project, offered as a source. Nothing enters the analysis until the planner adds a stream. */
export function BcaSafetyEvidencePanel({ safety, projectId, doc, onChange, onNotice }: {
  safety: BcaSafetyEvidenceRead; projectId: string; doc: BcaDocument;
  onChange: (doc: BcaDocument) => void; onNotice: (text: string) => void;
}) {
  return (
    <section className="space-y-3 rounded border p-4" aria-label="Crashes on treated segments">
      <h3 className="font-semibold">Crashes on treated segments</h3>
      <p className="text-sm">{BCA_RECORDED_COUNTS_NOTE} {BCA_PERSONS_NOTE}</p>
      {safety.status === "failed" ? (
        <p role="alert">Saved safety plans could not be read. This is not a finding that none exist.</p>
      ) : safety.plans.length === 0 ? (
        <p className="text-sm">
          No saved safety plan treats a segment on this project. Attach countermeasures to segments in{" "}
          <Link className="underline" href={`/safety?projectId=${encodeURIComponent(projectId)}`}>Safety</Link>.
        </p>
      ) : (
        <>
        {safety.plansNotShown > 0 && (
          <p className="text-sm">
            Showing the {safety.plans.length} most recently updated safety plans. {safety.plansNotShown} older {safety.plansNotShown === 1 ? "plan is" : "plans are"} not shown.
          </p>
        )}
        {safety.plans.map((plan) => (
          <div key={`${plan.reportId}-${plan.ingestId}`} className="space-y-2 border-t pt-3">
            <h4 className="font-medium">{plan.reportTitle}</h4>
            {plan.status === "unavailable" ? (
              <p role="alert" className="text-sm">{plan.reason}</p>
            ) : (
              <>
                <p className="text-sm">
                  {plan.sourceLabel} ({plan.sourceId ?? "source id not recorded"}). Years {plan.years.join(", ")}. {plan.coverage}
                </p>
                {bcaSeriousInjuryNote(plan.seriousInjury) && <p className="text-sm font-medium">{bcaSeriousInjuryNote(plan.seriousInjury)}</p>}
                {plan.caveats.map((caveat) => <p key={caveat} className="text-sm">{caveat}</p>)}
                {plan.segments.map((segment) => segment.status === "counted"
                  ? <SegmentStream key={segment.segmentId} plan={plan} segment={segment} doc={doc} onChange={onChange} onNotice={onNotice} />
                  : <UnresolvedSegment key={segment.segmentId} segment={segment} />)}
              </>
            )}
          </div>
        ))}
        </>
      )}
    </section>
  );
}
