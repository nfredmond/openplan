import {
  accuracyByClassRows,
  accuracyByClassSvg,
  type RoadClassAccuracy,
} from "@/lib/models/charts/accuracy-by-class";
import type { CountyOnrampManifest } from "@/lib/models/county-onramp";

/**
 * Only what the document actually cites.
 *
 * Structural rather than the full `CountyRunModelingEvidence`, because two
 * modules export a type of that name — the API's and the evidence backbone's —
 * and they are nominally distinct despite being the same shape. A document that
 * insisted on one of them could be handed the other and refuse it, over a
 * difference no reader could ever see.
 */
export type ProvenanceSource = {
  sourceLabel: string;
  sourceVintage?: string | null;
  citationText: string;
};

export type ProvenanceEvidence = {
  sourceManifests: ProvenanceSource[];
};

/**
 * THE PAPER TRAIL FOR A TRAFFIC NUMBER THAT GOES INTO A FUNDED APPLICATION.
 *
 * ================================================================ WHY IT EXISTS
 *
 * A figure in a grant application can be audited years later, by someone who
 * was not in the room and cannot re-run anything. Nathaniel's requirement
 * (2026-08-15) was an EXPORTABLE record: which network, downloaded when, which
 * defaults and their published source, what was hand-edited, the zone
 * resolution actually used, whether it was checked against real counts, and the
 * claim ceiling.
 *
 * Everything that record needs is already produced by a run and already stored.
 * None of it reaches a planner. This turns it into one document they can put in
 * an appendix.
 *
 * ============================================== THE RULE THIS DOCUMENT FOLLOWS
 *
 * **What was NOT done is as visible as what was.** A run that was never
 * validated says so where a validated run would report its accuracy. A run that
 * did not converge says so beside the volumes. A missing figure is written as
 * "not recorded", never omitted and never zero.
 *
 * That is the whole difference between a paper trail and a brochure. An
 * auditor's first question is what was skipped, and a document that can only
 * describe what happened cannot answer it.
 *
 * **Nothing here is computed.** Every number is copied from the run's own
 * output. If a figure is not in the run, it is not in the document — this must
 * never derive, infer, or fill a gap, because a plausible value in an appendix
 * is indistinguishable from a measured one.
 */

/** Everything the document is built from. Absences are expected, not errors. */
export type CountyRunProvenanceInput = {
  runName: string;
  geographyLabel: string | null;
  geographyId: string | null;
  stage: string | null;
  statusLabel: string | null;
  manifest: CountyOnrampManifest | null;
  validationSummary: Record<string, unknown> | null;
  modelingEvidence: ProvenanceEvidence | null;
  generatedAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * A value, or an explicit statement that the run did not record it.
 *
 * The phrase matters more than it looks. "Not recorded" is a fact about the
 * run; a blank cell is a fact about the document, and a reader cannot tell a
 * blank from an oversight.
 */
function stated(value: string | number | null | undefined, unit = ""): string {
  if (value === null || value === undefined || value === "") return "_not recorded_";
  const rendered = typeof value === "number" ? value.toLocaleString() : value;
  return unit ? `${rendered} ${unit}` : rendered;
}

function yesNoUnknown(value: boolean | null | undefined, yes: string, no: string): string {
  if (value === true) return yes;
  if (value === false) return no;
  return "_not recorded_";
}

/**
 * Whether a counts comparison actually happened, read from its own record.
 *
 * An unvalidated run does not store null here — the create route, the worker
 * callback and a scaffold edit all store `{}` — and `{}` is truthy. Gating on
 * truthiness made this document assert "was compared against observed counts
 * and DID NOT meet" about runs where nothing was ever measured, which is a
 * fabricated comparison on the page built for auditors. Evidence of a real
 * comparison is a recorded gate verdict, a numeric metric, or a matched-station
 * count; anything less reads as "never compared" — the weaker claim, and the
 * only one an empty record can support.
 */
function hasCountsComparison(summary: Record<string, unknown> | null): boolean {
  const validation = asRecord(summary);
  if (!validation) return false;
  if (asText(asRecord(validation.screening_gate)?.status_label)) return true;
  if (asNumber(validation.stations_matched) !== null) return true;
  const metrics = asRecord(validation.metrics);
  if (metrics && Object.values(metrics).some((value) => typeof value === "number")) return true;
  return false;
}

/**
 * The sentence that limits what this number may be used for.
 *
 * Derived from what the run actually established, never from a default: a run
 * that passed its gate says something different from one that failed it, and
 * one that was never checked says a third thing. All three are ceilings, and
 * the strongest is still not a forecast.
 */
/**
 * The per-road-class accuracy the run recorded, or nothing.
 *
 * Reads defensively because this document's whole purpose is to be checkable
 * by someone who cannot re-run the model: a class whose figures are missing is
 * dropped rather than drawn as zero, which would read as a perfect match.
 */
function readRoadClassAccuracy(value: unknown): RoadClassAccuracy[] {
  if (!Array.isArray(value)) return [];
  const rows: RoadClassAccuracy[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const roadClass = asText(record?.road_class);
    const stations = asNumber(record?.stations);
    const error = asNumber(record?.median_absolute_percent_error);
    if (!roadClass || stations === null || error === null) continue;
    rows.push({
      roadClass,
      stations,
      medianAbsolutePercentError: error,
      medianModelOverObserved: asNumber(record?.median_model_over_observed),
    });
  }
  return rows;
}

/**
 * An SVG chart as a self-contained Markdown image.
 *
 * Base64 rather than a file reference: this document is generated, downloaded
 * and emailed, and a chart that lives at a URL is a chart that is missing by
 * the time a reviewer opens it a year later. The alt text carries the same
 * statement as the chart, so a reader whose viewer strips images still gets it.
 */
function inlineSvg(svg: string, altText: string): string {
  const encoded = Buffer.from(svg, "utf8").toString("base64");
  return `![${altText}](data:image/svg+xml;base64,${encoded})`;
}

export function claimCeiling(input: CountyRunProvenanceInput): string {
  const gate = asRecord(asRecord(input.validationSummary)?.screening_gate);
  const gateLabel = asText(gate?.status_label);

  if (!hasCountsComparison(input.validationSummary)) {
    return (
      "This run has NOT been compared against observed traffic counts. Its road-by-road volumes " +
      "are unvalidated model output and must not be presented as measured or forecast traffic. " +
      "Study-area totals may be used for screening and prioritisation with this document attached."
    );
  }
  if (gateLabel && gateLabel.toLowerCase().includes("bounded screening-ready")) {
    return (
      `This run was compared against observed counts and met OpenPlan's screening thresholds ` +
      `("${gateLabel}"). That supports screening and prioritisation, and supporting figures in a ` +
      "funding application when accompanied by this record. It is NOT a calibrated forecast and " +
      "must not be used for environmental review."
    );
  }
  return (
    `This run was compared against observed counts and DID NOT meet OpenPlan's screening ` +
    `thresholds (recorded as "${stated(gateLabel)}"). Its road-by-road volumes must not be ` +
    "presented as measured traffic. The comparison itself, and the gap it found, are reportable — " +
    "the figures are not. It must not be used for environmental review."
  );
}

function sourcesSection(evidence: ProvenanceEvidence | null): string[] {
  if (!evidence || evidence.sourceManifests.length === 0) {
    return [
      "_No data sources were recorded for this run._ Every figure above therefore lacks an",
      "attributable origin, which is itself the finding: treat the run as undocumented.",
    ];
  }
  return [
    "| Source | Published by / vintage | Citation |",
    "| --- | --- | --- |",
    ...evidence.sourceManifests.map((source) => {
      const vintage = stated(source.sourceVintage);
      return `| ${source.sourceLabel} | ${vintage} | ${source.citationText} |`;
    }),
  ];
}

/**
 * The rules that produced these accuracy figures, when they are not the current ones.
 *
 * Three defects in the count comparison were fixed on 2026-08-18 — divided
 * highways compared against one carriageway of two, ramp counts grading the
 * mainlines they leave, and one link graded once per station matched to it.
 * Every summary stored before then reports a different quantity under the same
 * name. Without this the two are indistinguishable on the page, and a planner
 * would compare them to each other.
 *
 * The version is what the worker stamped; this file does not restate the rules
 * themselves, so a future revision needs no change here.
 */
const CURRENT_VALIDATION_RULES_VERSION = 3;

function supersededValidationRules(validation: Record<string, unknown>): string[] {
  const version = asNumber(validation.validation_rules_version);
  if (version !== null && version >= CURRENT_VALIDATION_RULES_VERSION) return [];
  return [
    `- **These accuracy figures were produced by superseded rules** (${
      version === null ? "unstamped" : `revision ${version}`
    }, current is ${CURRENT_VALIDATION_RULES_VERSION}). They are not comparable with a run graded ` +
      `by the current rules, and re-running the validation is what makes them so.`,
  ];
}

/**
 * Why the matched count is lower than the station count, when the run says so.
 *
 * Both exclusions make the model look WORSE by removing easy agreements and
 * better by removing impossible ones, and a planner reading "38 of 71" with no
 * explanation cannot tell a thin count set from a well-filtered one. Runs made
 * before the worker recorded these fields say nothing rather than printing
 * zeros, because "0 excluded" and "never measured" are different facts.
 */
function setAsideStations(validation: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const ramps = asNumber(validation.stations_excluded_not_mainline);
  if (ramps !== null && ramps > 0) {
    lines.push(
      `- **Set aside — ramps and connectors:** ${ramps}. The count measures a facility the ` +
        `screening network does not contain, so it would be paired with the mainline it leaves.`
    );
  }
  const shared = validation.shared_model_links as Record<string, unknown> | undefined;
  if (shared) {
    const merged = asNumber(shared.stations_merged_away);
    const ambiguous = asNumber(shared.stations_excluded_as_ambiguous);
    if (merged !== null && merged > 0) {
      lines.push(
        `- **Set aside — several stations on one link:** ${merged}. Their counts agree, so the ` +
          `link is compared once at their median rather than several times.`
      );
    }
    if (ambiguous !== null && ambiguous > 0) {
      lines.push(
        `- **Set aside — one link, disagreeing counts:** ${ambiguous}. The model holds a single ` +
          `volume for the link and nothing in the data says which station belongs to it.`
      );
    }
  }
  return lines;
}

/**
 * Stations kept in the comparison whose link the assignment never loaded.
 *
 * NOT an exclusion, which is why it does not live in `setAsideStations` above.
 * The station stays in every figure, and it scores an absolute percent error of
 * exactly 100% because the model says zero.
 *
 * A planner has to be told, because that error measures how much of the road
 * network this zone system reaches rather than how good the demand estimate is.
 * Measured 2026-08-20 across eleven counties in four states: 77-85% of the links
 * inside a study boundary carry no assigned traffic, 34-69% of collectors and
 * 96-100% of local streets among them
 * (`docs/modeling/UNLOADED_LINK_COVERAGE_2026-08-20.md`).
 *
 * And the direction of the distortion cannot be assumed. Because the error is
 * exactly 100%, these stations pull a median TOWARD 100 from whichever side it
 * sits — flattering a run whose typical error is worse than that, and
 * penalising one whose error is better. In Tulare County seven of them were
 * holding the headline 21 points below where the loaded network puts it.
 *
 * Runs made before the worker recorded the field say nothing rather than
 * printing a zero: "none" and "never measured" are different facts.
 */
function stationsOnUnloadedLinks(validation: Record<string, unknown>): string[] {
  const onUnloaded = asNumber(validation.stations_on_unloaded_links);
  if (onUnloaded === null || onUnloaded <= 0) return [];
  const matched = asNumber(validation.stations_matched);
  const ofMatched = matched !== null ? ` of ${matched}` : "";
  return [
    `- **Counted roads this run put no traffic on:** ${onUnloaded}${ofMatched}. The comparison ` +
      `keeps them, and each scores a 100% error because the model assigned that road nothing. ` +
      `That measures how much of the road network these zones reach, not how good the traffic ` +
      `estimate is — and because the error is exactly 100%, they pull the median toward 100 from ` +
      `whichever side it sits on. Removing them would raise the reported accuracy without ` +
      `changing the model.`,
  ];
}

function validationSection(input: CountyRunProvenanceInput): string[] {
  const validation = asRecord(input.validationSummary);
  if (!validation || !hasCountsComparison(input.validationSummary)) {
    return [
      "**This run was never compared against observed traffic counts.**",
      "",
      "No accuracy figure exists for it. That is not the same as an accuracy figure that has not",
      "been reported — nothing was measured, so nothing can be claimed about how close these",
      "volumes are to real traffic.",
    ];
  }

  const gate = asRecord(validation.screening_gate);
  const metrics = asRecord(validation.metrics);
  const agencies = Array.isArray(validation.count_source_agencies)
    ? (validation.count_source_agencies as unknown[]).filter((a): a is string => typeof a === "string")
    : [];
  const reasons = Array.isArray(gate?.reasons)
    ? (gate.reasons as unknown[]).filter((r): r is string => typeof r === "string")
    : [];

  const lines = [
    `- **Verdict:** ${stated(asText(gate?.status_label))}`,
    `- **Counts published by:** ${agencies.length ? agencies.join(", ") : "_not recorded_"}`,
    `- **Stations matched:** ${stated(asNumber(validation.stations_matched))} of ${stated(
      asNumber(validation.stations_total)
    )}`,
    ...setAsideStations(validation),
    ...stationsOnUnloadedLinks(validation),
    ...supersededValidationRules(validation),
    `- **Median absolute percent error:** ${stated(
      asNumber(metrics?.median_absolute_percent_error)
    )}% (threshold ${stated(asNumber(gate?.ready_median_ape_threshold))}%)`,
    `- **Worst single station:** ${stated(asNumber(metrics?.max_absolute_percent_error))}% (threshold ${stated(
      asNumber(gate?.ready_critical_ape_threshold)
    )}%)`,
    `- **Rank agreement with observed volumes:** ${stated(
      asNumber(metrics?.spearman_rho_facility_ranking)
    )}`,
  ];
  if (reasons.length) {
    lines.push("", "Why the verdict reads as it does:", ...reasons.map((reason) => `- ${reason}`));
  }

  // A SINGLE MEDIAN ERROR IS TRUE OF NO ROAD IN PARTICULAR. Measured across 24
  // counties, a screening run's error on freeways and on collectors differ by
  // a factor of three, so a corridor number quoted from the overall figure
  // inherits an accuracy nobody stated. The chart is embedded rather than
  // linked because this document is what leaves the building.
  const byClass = readRoadClassAccuracy(metrics?.by_road_class);
  if (byClass.length) {
    lines.push(
      "",
      "### How accurate this run is, road by road",
      "",
      inlineSvg(
        accuracyByClassSvg(byClass, {
          title: "Median error by road type",
          subtitle: `${stated(asNumber(validation.stations_matched))} matched count stations`,
          gatePercent: asNumber(gate?.ready_median_ape_threshold) ?? 30,
        }),
        "Median error by road type, against the screening threshold"
      ),
      "",
      "| Road type | Stations | Median error | Model ÷ observed |",
      "|---|---:|---:|---:|",
      ...accuracyByClassRows(byClass).map(
        (row) =>
          `| ${row.roadClass} | ${row.stations} | ${row.medianAbsolutePercentError.toFixed(1)}% | ${
            row.medianModelOverObserved === null || row.medianModelOverObserved === undefined
              ? "_not recorded_"
              : row.medianModelOverObserved.toFixed(2)
          } |`
      ),
      "",
      "A road type with only a handful of stations is shown faded and labelled. Its figure is not",
      "evidence about that road type, however good it looks: a 1% error over one station is one",
      "station, and quoting it would be the mistake this table exists to prevent."
    );
  }
  return lines;
}

function calibrationSection(manifest: CountyOnrampManifest | null): string[] {
  const calibration = asRecord((manifest as unknown as Record<string, unknown>)?.calibration);
  if (!calibration) {
    return [
      "**Not calibrated.** This run uses OpenPlan's generic screening parameters — trip rates and",
      "road speeds and capacities that were not fitted to anything in this study area.",
    ];
  }
  if (calibration.performed !== true) {
    return [
      "**Calibration was requested and did not change the model.**",
      "",
      `Reason recorded: ${stated(asText(calibration.reason) ?? "no calibration step improved the held-out counts")}.`,
      "The figures above are the uncalibrated screening model's.",
    ];
  }

  const calibrated = asRecord(calibration.calibrated);
  const baseline = asRecord(calibration.baseline);
  return [
    `- **Claim tier:** ${stated(asText(calibration.claim_tier))}`,
    `- **Fitted on:** ${stated(asNumber(calibration.fit_station_count))} count stations`,
    `- **Validated on:** ${stated(
      asNumber(calibration.holdout_station_count)
    )} stations held back and never fitted`,
    `- **Accuracy before calibration (held out):** ${stated(
      asNumber(asRecord(baseline?.holdout)?.median_ape)
    )}% median absolute percent error`,
    `- **Best score found while choosing between calibration candidates:** ${stated(
      asNumber(asRecord(calibrated?.holdout)?.median_ape)
    )}% median absolute percent error, across ${stated(
      asNumber(calibration.selection_trials_scored_on_holdout)
    )} candidates`,
    "",
    "**That last figure is not this run's accuracy, and must not be quoted as one.** The stations",
    "it is measured on were kept back from the fitting, but every calibration candidate was scored",
    "against them and the best-scoring one was kept — so it is a best-of-several and reads better",
    "than the model performs. On one measured county it read 16% where an independent set of counts",
    "put the same run at 60%.",
    "",
    "The accuracy for this run is the validation section above, which compares the finished model",
    "against counts the calibration never saw.",
  ];
}

/**
 * Limits the run recorded about itself, verbatim.
 *
 * Read defensively rather than through the manifest's type: the caveat list is
 * written by a Python producer and reaches here as parsed JSON, so a version
 * skew shows up as a missing array rather than a type error. An absent list is
 * reported as absent — a run that recorded no caveats and a run whose caveats
 * did not survive the trip are different facts, and neither is "no limits".
 */
function runCaveats(manifest: CountyOnrampManifest | null): string[] {
  const prototype = asRecord(asRecord((manifest as unknown as Record<string, unknown>)?.summary)?.behavioral_prototype);
  const caveats = Array.isArray(prototype?.caveats)
    ? (prototype.caveats as unknown[]).filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];
  return caveats.length
    ? caveats.map((caveat) => `- ${caveat}`)
    : ["_No caveats were recorded with this run._"];
}


/**
 * How many observed counts a person typed in rather than a feed supplying.
 *
 * They are indistinguishable once they share a column, and they carry
 * completely different authority: "Caltrans measured 27,000 here in 2023" and
 * "someone at the agency believed it was about 27,000" are not the same
 * evidence. A reviewer is entitled to know which a figure rests on.
 */
function handEnteredSection(manifest: CountyOnrampManifest | null): string[] {
  const scaffold = asRecord(asRecord((manifest as unknown as Record<string, unknown>)?.summary)?.scaffold);
  if (!scaffold) {
    return ["_No count-station worksheet was recorded for this run._"];
  }

  const edited = Array.isArray(scaffold.hand_edited_station_ids)
    ? (scaffold.hand_edited_station_ids as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  const total = asNumber(scaffold.station_count);

  if (edited.length === 0) {
    return [
      `No count values were changed by hand. All ${stated(total)} stations hold the values they`,
      "were created with.",
    ];
  }
  return [
    `**${edited.length} of ${stated(total)} count stations were edited by hand**, most recently`,
    `${stated(asText(scaffold.hand_edited_at))}.`,
    "",
    "A hand-entered count carries the authority of whoever entered it, not of a published",
    "measurement. Stations edited:",
    "",
    ...edited.map((stationId) => `- ${stationId}`),
  ];
}


/**
 * The model's own defaults, and where they came from.
 *
 * A reviewer is entitled to ask where "2.2 trips per person per day" came from.
 * Until a run carried this, the answer was nowhere: the constants sat in a
 * Python file with no source and no way for a planner to see them. The paper
 * trail could say where the DATA came from and not where the ASSUMPTIONS came
 * from — and the assumptions are doing most of the work.
 */
/**
 * Whether this run counted cars or people, which is a factor of about 1.6.
 *
 * Until 2026-08-18 the trip-based model generated PERSON trips and assigned
 * every one of them to the road network as though it were a car, and assigned
 * walking and cycling trips too. Both were corrected, and the same county
 * re-run afterwards reports roughly 27% less traffic.
 *
 * A planner holding a run from before and a run from after sees that drop with
 * nothing on the page to explain it, and the older run is the wrong one. So an
 * older run says so, rather than the newer one having to justify itself.
 */
function demandUnitBasis(manifest: CountyOnrampManifest | null): string[] {
  const demand = asRecord((manifest as unknown as Record<string, unknown>)?.demand);
  const rates = asRecord(demand?.trip_rates);
  if (!rates) return [];
  const occupancy = asRecord(rates.vehicle_occupancy_applied);
  const modeSplit = asRecord(rates.mode_split_applied);
  const supplied = asText(demand?.demand_source) === "supplied_package";
  if (supplied) return [];

  if (!occupancy) {
    return [
      "",
      "> **This run assigned person-trips to the road network as though each were a vehicle.**",
      "> Three people sharing a car are three trips and one car, so its traffic figures are",
      "> roughly 1.6 times too high. Re-run the model to get figures in vehicles. A run made",
      "> after 2026-08-18 states the vehicle occupancies it applied.",
    ];
  }

  const parts = Object.entries(occupancy)
    .map(([purpose, value]) => `${purpose} ${asNumber(value) ?? "?"}`)
    .join(", ");
  const auto = asNumber(modeSplit?.auto_share_of_person_trips);
  return [
    "",
    `- **Person-trips converted to vehicles** using average occupancy by purpose (${parts}).`,
    auto === null
      ? "- **No mode split was applied**, so walking and cycling trips are on the road network."
      : `- **${(auto * 100).toFixed(1)}% of person-trips were driven**; the rest were walked or cycled and are not on the road network.`,
  ];
}

function assumptionsSection(manifest: CountyOnrampManifest | null): string[] {
  const assumptions = asRecord((manifest as unknown as Record<string, unknown>)?.assumptions);
  if (!assumptions) {
    return [
      "_This run did not record the assumptions it used._ The figures above cannot be traced to",
      "the trip rates and road capacities that produced them.",
    ];
  }

  const generation = asRecord(assumptions.trip_generation);
  const deterrence = asRecord(assumptions.trip_distribution_deterrence);
  const lines = [asText(assumptions.provenance) ?? "_No statement of origin was recorded._", ""];

  if (generation) {
    lines.push("Trip generation:");
    for (const [key, value] of Object.entries(generation)) {
      lines.push(`- ${key.replace(/_/g, " ")}: ${stated(asNumber(value))}`);
    }
    lines.push("");
  }
  if (deterrence) {
    lines.push("Trip distribution (higher means shorter trips):");
    for (const [key, value] of Object.entries(deterrence)) {
      lines.push(`- ${key.replace(/_/g, " ")}: ${stated(asNumber(value))}`);
    }
  }
  return lines;
}


/**
 * Build the appendix document. Pure: same run in, same bytes out.
 *
 * Markdown rather than PDF on purpose — it pastes into a Word document, a
 * proposal template or an email without a rendering engine, and an appendix
 * that needs software to open is an appendix that gets left out.
 */
export function buildCountyRunProvenanceDocument(input: CountyRunProvenanceInput): string {
  const run = input.manifest?.summary?.run ?? null;
  const zoneCount = asNumber(run?.zone_count);
  const intrazonal = asNumber(run?.intrazonal_trip_share);

  return [
    `# Traffic modelling record — ${input.runName}`,
    "",
    `**Study area:** ${stated(input.geographyLabel)}${
      input.geographyId ? ` (${input.geographyId})` : ""
    }  `,
    `**Record generated:** ${input.generatedAt}  `,
    `**Model run stage:** ${stated(input.stage)}`,
    "",
    "This document records what a traffic estimate produced by OpenPlan rests on, so that the",
    "figures can be checked by someone who was not present and cannot re-run the model. Anything",
    "the run did not record is written as _not recorded_ rather than left blank.",
    "",
    "## What this number may be used for",
    "",
    claimCeiling(input),
    "",
    "## The model",
    "",
    `- **Zones the study area was divided into:** ${stated(zoneCount)}`,
    `- **Share of travel that never reaches a road:** ${
      intrazonal === null ? "_not recorded_" : `${(intrazonal * 100).toFixed(1)}%`
    }`,
    `- **Roads carrying traffic:** ${stated(asNumber(run?.loaded_links))}`,
    `- **Daily trips modelled:** ${stated(asNumber(run?.total_trips))}`,
    ...(asText((run as Record<string, unknown> | null)?.per_capita_understatement_caveat)
      ? ["", `> ${asText((run as Record<string, unknown> | null)?.per_capita_understatement_caveat)}`]
      : []),
    `- **Assignment reached equilibrium:** ${yesNoUnknown(
      (run as Record<string, unknown> | null)?.assignment_converged as boolean | null | undefined,
      "yes",
      "**NO — the volumes below are from part-way through a calculation**"
    )}`,
    `- **Final convergence gap:** ${stated(asNumber(run?.final_gap))}`,
    ...(asText((run as Record<string, unknown> | null)?.assignment_convergence_caveat)
      ? ["", `> ${asText((run as Record<string, unknown> | null)?.assignment_convergence_caveat)}`]
      : []),
    "",
    "## Where the data came from",
    "",
    `- **Road network:** ${stated(asText((run as Record<string, unknown> | null)?.network_source))}, downloaded ${stated(
      asText((run as Record<string, unknown> | null)?.network_downloaded_at)
    )}`,
    "",
    ...sourcesSection(input.modelingEvidence),
    "",
    "## What the model assumed",
    "",
    ...assumptionsSection(input.manifest),
    ...demandUnitBasis(input.manifest),
    "",
    "## Checked against real traffic counts?",
    "",
    ...validationSection(input),
    "",
    "## Were any counts entered by hand?",
    "",
    ...handEnteredSection(input.manifest),
    "",
    "## Fitted to local counts?",
    "",
    ...calibrationSection(input.manifest),
    "",
    "## Limits recorded by the run itself",
    "",
    ...runCaveats(input.manifest),
    "",
    "---",
    "",
    "Produced by OpenPlan. Every figure above is copied from the run's own output; none is",
    "derived or estimated for this document.",
    "",
  ].join("\n");
}
