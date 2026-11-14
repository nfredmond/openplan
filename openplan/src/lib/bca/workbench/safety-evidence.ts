import type { BcaSafetyPlanOffer, BcaTreatedSegment } from "@/lib/safety/bca-evidence";
import type { BcaDocument } from "./schema";
import { newBcaFlow } from "./document";
import { safetyQuantity } from "./quantities";

type ReadyPlan = Extract<BcaSafetyPlanOffer, { status: "ready" }>;
export type BcaSafetyOutcome = "fatality" | "serious-injury";

export const BCA_FATAL_ONLY_SOURCE_NOTE =
  "This source records fatal crashes only. Injury crashes are not in it, so they are unavailable here, not zero.";
export const BCA_RECORDED_COUNTS_NOTE =
  "Recorded crashes in the requested years. They are not crashes avoided, and a year with no recorded crash does not show a safe road.";
/** Why the stream counts persons. Keep in step with the USDOT values in profiles.ts. */
export const BCA_PERSONS_NOTE =
  "The USDOT values in this workbench are per person, so the stream counts people, not crashes. Stored records give people killed but not people seriously injured; enter serious injuries from the crash reports. [VERIFY] A USDOT per-crash value for fatal or injury crashes was not confirmed against the current guidance.";

function cmfClearinghouseUrl(cmfId: number): string {
  return `https://cmfclearinghouse.fhwa.dot.gov/detail.php?facid=${cmfId}`;
}

/**
 * Add one annual safety stream from a treated segment's recorded crashes.
 * The planner supplies the crash modification factor and its CMF Clearinghouse
 * ID, and serious-injury persons. Recorded fatalities come from the stored
 * crashes. Throws in plain words when an input is missing; blank is not zero.
 */
export function addBcaSafetyStream(
  doc: BcaDocument,
  plan: ReadyPlan,
  segment: BcaTreatedSegment,
  input: { outcome: BcaSafetyOutcome; persons: number | null; cmf: number | null; cmfId: number | null },
): BcaDocument {
  if (input.outcome === "serious-injury" && !plan.seriousInjuryInSource) throw new Error(BCA_FATAL_ONLY_SOURCE_NOTE);
  if (input.cmf === null) throw new Error("Enter the crash modification factor; blank is not zero.");
  if (input.cmfId === null || !Number.isInteger(input.cmfId) || input.cmfId <= 0)
    throw new Error("Enter the CMF Clearinghouse ID for this factor.");
  const recordedPersons = input.outcome === "fatality" ? segment.fatalities : null;
  const persons = recordedPersons ?? input.persons;
  if (persons === null)
    throw new Error(input.outcome === "fatality"
      ? "Some fatal crashes here have no count of people killed. Enter fatalities from the crash reports; blank is not zero."
      : "Enter serious injuries, in persons, from the crash reports; blank is not zero.");
  const id = `safety-${plan.reportId.slice(0, 8)}-${segment.segmentId}-${input.outcome}`;
  if (doc.evidence.some((source) => source.id === id))
    throw new Error("This segment and outcome are already in the analysis. Review the existing stream.");
  const result = safetyQuantity({ events: persons, years: plan.years.length, cmf: input.cmf });
  const outcomeWord = input.outcome === "fatality" ? "fatalities" : "serious injuries";
  const crashes = input.outcome === "fatality" ? segment.fatalCrashes : segment.seriousInjuryCrashes;
  const yearRows = segment.years
    .map((row) => `${row.year}: ${row.fatalCrashes} fatal${row.seriousInjuryCrashes === null ? "" : `, ${row.seriousInjuryCrashes} serious-injury`}`)
    .join("; ");
  const personsBasis = recordedPersons !== null
    ? `${persons} fatalities recorded in ${crashes} fatal crashes.`
    : `${persons} ${outcomeWord} entered by the planner; the source records ${crashes ?? "no"} ${input.outcome === "fatality" ? "fatal" : "serious-injury"} crashes here.`;
  const crashSource = {
    id,
    title: `${segment.segmentLabel}: recorded ${outcomeWord}`,
    reference: `/reports/${plan.reportId}`,
    locator: `Safety plan "${plan.reportTitle}", segment ${segment.segmentId}, acquisition ${plan.ingestId}, source ${plan.sourceId ?? "not recorded"}`,
    observedYear: plan.years.at(-1) ?? null,
    status: "documented" as const,
    method: `${plan.sourceLabel}, years ${plan.years.join(", ")}. Crashes by year: ${yearRows}. ${personsBasis}`,
    limitation: [plan.coverage, BCA_RECORDED_COUNTS_NOTE, ...(plan.seriousInjuryInSource ? [] : [BCA_FATAL_ONLY_SOURCE_NOTE]), ...plan.caveats].join(" "),
    owner: "",
    dueDate: "",
  };
  const cmfSource = {
    id: `${id}-cmf`,
    title: `CMF Clearinghouse ID ${input.cmfId}`,
    reference: cmfClearinghouseUrl(input.cmfId),
    locator: `Applied to ${segment.segmentLabel}`,
    observedYear: null,
    status: "documented" as const,
    method: `Planner-entered crash modification factor ${input.cmf}.`,
    limitation: "The planner chose this factor. Confirm it fits the treatment, road type, crash types and severities on this segment.",
    owner: "",
    dueDate: "",
  };
  const flow = {
    ...newBcaFlow(doc, "benefit", `${id}-stream`),
    label: `${segment.segmentLabel.slice(0, 150)}: ${outcomeWord}`,
    category: "safety" as const,
    unit: input.outcome,
    noBuild: result.noBuild,
    build: result.build,
    sourceIds: [crashSource.id, cmfSource.id],
    overlapGroup: `safety-segment-${segment.segmentId}-${input.outcome}`,
    rationale: `${result.method} ${BCA_PERSONS_NOTE}`,
  };
  return { ...doc, evidence: [...doc.evidence, crashSource, cmfSource], flows: [...doc.flows, flow] };
}
