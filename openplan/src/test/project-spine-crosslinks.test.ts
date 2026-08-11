import { describe, expect, it } from "vitest";
import { buildProjectSpineCrosslinkSummary } from "@/lib/projects/project-spine-crosslinks";

const baseInput = {
  projectId: "project-1",
  geography: {
    label: "Franklin County",
    isDrawn: false,
    hasResolvableIdentity: true,
    workspaceFallbackLabel: null,
  },
  linkedRtpCycleCount: 1,
  reportRecordCount: 2,
  reportAttentionCount: 0,
  evidenceBackedReportCount: 2,
  comparisonBackedReportCount: 1,
  rtpLinks: {
    constrainedCount: 1,
    illustrativeCount: 0,
    candidateCount: 0,
  },
  scenarios: {
    scenarioSetCount: 1,
    activeScenarioSetCount: 1,
    baselineCount: 1,
    readyAlternativeCount: 1,
    attachedRunCount: 2,
  },
  funding: {
    hasTargetNeed: true,
    label: "Gap remains",
    reason: "Committed awards plus pursued opportunities cover part of the current funding need, but a gap still remains.",
    awardCount: 1,
    opportunityCount: 2,
    reimbursementPacketCount: 1,
    unfundedAfterLikelyAmount: 250000,
    awardRiskCount: 0,
  },
  engagement: {
    label: "Active",
    itemCount: 9,
    handoffReadyCount: 4,
  },
  analysis: {
    recentRunCount: 2,
    comparisonBackedReportCount: 1,
  },
  safety: {
    ingestCount: 1,
    crashCount: 1180,
    geocodedCount: 1089,
    coverageLabel: "Statewide reported collisions from the source agency.",
    sourceLabel: "Statewide crash reporting system",
  },
  aerial: {
    missionCount: 1,
    activeMissionCount: 0,
    readyPackageCount: 1,
    verificationReadiness: "ready" as const,
  },
};

const emptySafety = {
  ingestCount: 0,
  crashCount: 0,
  geocodedCount: 0,
  coverageLabel: null,
  sourceLabel: null,
};

describe("buildProjectSpineCrosslinkSummary", () => {
  it("orders attention rows ahead of ready crosslinks", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      reportAttentionCount: 1,
    });

    // Eight lanes: the seven downstream ones plus the study area they all
    // start from. baseInput carries a resolved place, so geography is ready.
    expect(summary.rows).toHaveLength(8);
    expect(summary.rows[0].id).toBe("geography");
    expect(summary.attentionCount).toBe(3);
    expect(summary.readyCount).toBe(5);
    expect(summary.missingCount).toBe(0);
    expect(summary.leadAction.id).toBe("rtp_packets");
    expect(summary.rows.find((row) => row.id === "engagement_evidence")?.statusLabel).toBe(
      "Moderation/handoff pending"
    );
    expect(summary.rows.find((row) => row.id === "funding_profile")?.evidence).toContain("$250,000 remains");
    expect(summary.rows.find((row) => row.id === "rtp_packets")?.detail).toContain(
      "roles 1 constrained / 0 illustrative / 0 candidate"
    );
    expect(summary.rows.find((row) => row.id === "scenario_sets")?.nextAction).toMatch(
      /confirm downstream report packets/i
    );
    expect(summary.leadAction.caveat).toMatch(/not adopted policy/i);
  });

  it("marks unlinked lanes as missing without overstating readiness", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      linkedRtpCycleCount: 0,
      reportRecordCount: 0,
      reportAttentionCount: 0,
      evidenceBackedReportCount: 0,
      comparisonBackedReportCount: 0,
      rtpLinks: {
        constrainedCount: 0,
        illustrativeCount: 0,
        candidateCount: 0,
      },
      scenarios: {
        scenarioSetCount: 0,
        activeScenarioSetCount: 0,
        baselineCount: 0,
        readyAlternativeCount: 0,
        attachedRunCount: 0,
      },
      funding: {
        ...baseInput.funding,
        hasTargetNeed: false,
        awardCount: 0,
        opportunityCount: 0,
        reimbursementPacketCount: 0,
        unfundedAfterLikelyAmount: 0,
      },
      engagement: {
        label: "Not linked",
        itemCount: 0,
        handoffReadyCount: 0,
      },
      analysis: {
        recentRunCount: 0,
        comparisonBackedReportCount: 0,
      },
      safety: emptySafety,
      aerial: {
        missionCount: 0,
        activeMissionCount: 0,
        readyPackageCount: 0,
        verificationReadiness: "none",
      },
      // Unset too, so this case is what it says it is: a project with nothing
      // linked anywhere, including the area the other lanes start from.
      geography: {
        label: null,
        isDrawn: false,
        hasResolvableIdentity: false,
        workspaceFallbackLabel: null,
      },
    });

    expect(summary.readyCount).toBe(0);
    expect(summary.attentionCount).toBe(0);
    expect(summary.missingCount).toBe(8);
    expect(summary.boardState).toBe("empty");
    expect(summary.stateHeadline).toMatch(/No downstream outputs/i);
    // With nothing set anywhere, the first move is the study area rather than
    // the RTP cycle: geography is upstream of every other lane, and attaching a
    // project to a cycle before anyone has said where it is only defers the
    // question. This is the ordering the geography lane exists to produce.
    expect(summary.stateNextAction).toMatch(/study area/i);
    expect(summary.emptyCount).toBe(8);
    expect(summary.leadAction.id).toBe("geography");
    expect(summary.rows.map((row) => row.statusLabel)).toContain("Funding target missing");
    expect(summary.rows.find((row) => row.id === "funding_profile")?.sourceLabel).toBe("No evidence yet");
    expect(summary.rows.find((row) => row.id === "analysis_modeling")?.evidence).toMatch(/no validated behavioral forecast/i);
    expect(summary.rows.find((row) => row.id === "scenario_sets")?.caveat).toMatch(/planning-support context/i);
  });

  it("puts the study area first, because every other lane starts from it", () => {
    const summary = buildProjectSpineCrosslinkSummary(baseInput);
    const geography = summary.rows.find((row) => row.id === "geography");

    expect(summary.rows[0].id).toBe("geography");
    expect(geography?.readiness).toBe("ready");
    expect(geography?.headline).toContain("Franklin County");
    // With an area of record set, this row opens model validation carrying the
    // project — the identity editor it used to anchor to sits on this same page.
    expect(geography?.href).toBe("/county-runs?projectId=project-1");
    expect(geography?.actionLabel).toBe("Open model validation");
  });

  it("calls a drawn area attention, not ready — it has extent but no identity", () => {
    // A hand-drawn shape cannot be re-resolved, so no county filter, no
    // jurisdiction rule and no eligibility check downstream can be derived from
    // it. Reporting that as "ready" would hide a real limit on the other lanes.
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      geography: {
        label: "Drawn corridor",
        isDrawn: true,
        hasResolvableIdentity: false,
        workspaceFallbackLabel: "Franklin County",
      },
    });
    const geography = summary.rows.find((row) => row.id === "geography");

    expect(geography?.readiness).toBe("attention");
    expect(geography?.statusLabel).toBe("Drawn area only");
    expect(geography?.detail).toMatch(/no boundary to re-resolve/i);
    expect(geography?.nextAction).toMatch(/keep the drawn shape if the extent is the point/i);
  });

  it("names the real fallback when no study area is set", () => {
    // "Missing" must say what actually happens next, and what happens is that
    // downstream lanes fall back to the workspace's home geography — by name,
    // so nobody has to guess which place their run will use.
    const withFallback = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      geography: {
        label: null,
        isDrawn: false,
        hasResolvableIdentity: false,
        workspaceFallbackLabel: "Delaware County",
      },
    });
    expect(withFallback.rows.find((row) => row.id === "geography")?.headline).toContain(
      "Delaware County"
    );

    const withoutFallback = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      geography: {
        label: null,
        isDrawn: false,
        hasResolvableIdentity: false,
        workspaceFallbackLabel: null,
      },
    });
    expect(withoutFallback.rows.find((row) => row.id === "geography")?.headline).toMatch(
      /every module will ask for a place each time/i
    );
  });

  it("turns pending schema lanes into setup actions instead of false missing evidence", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      linkedRtpCycleCount: 0,
      reportRecordCount: 0,
      reportAttentionCount: 0,
      evidenceBackedReportCount: 0,
      comparisonBackedReportCount: 0,
      rtpLinks: {
        constrainedCount: 0,
        illustrativeCount: 0,
        candidateCount: 0,
      },
      scenarios: {
        scenarioSetCount: 0,
        activeScenarioSetCount: 0,
        baselineCount: 0,
        readyAlternativeCount: 0,
        attachedRunCount: 0,
      },
      funding: {
        ...baseInput.funding,
        hasTargetNeed: false,
        awardCount: 0,
        opportunityCount: 0,
        reimbursementPacketCount: 0,
        unfundedAfterLikelyAmount: 0,
        awardRiskCount: 0,
      },
      engagement: {
        label: "Not linked",
        itemCount: 0,
        handoffReadyCount: 0,
      },
      analysis: {
        recentRunCount: 0,
        comparisonBackedReportCount: 0,
      },
      aerial: {
        missionCount: 0,
        activeMissionCount: 0,
        readyPackageCount: 0,
        verificationReadiness: "none",
      },
      pendingSchema: {
        scenario_sets: true,
        funding_profile: true,
      },
    });

    const scenarioRow = summary.rows.find((row) => row.id === "scenario_sets");
    const fundingRow = summary.rows.find((row) => row.id === "funding_profile");

    expect(summary.boardState).toBe("schema_pending");
    expect(summary.schemaPendingCount).toBe(2);
    expect(summary.attentionCount).toBe(2);
    expect(summary.missingCount).toBe(4);
    expect(summary.schemaPendingLanes).toEqual(["Scenario sets", "Grants / funding profile"]);
    expect(summary.stateDetail).toMatch(/showing setup actions instead of pretending those lanes are empty/i);
    expect(summary.stateNextAction).toMatch(/decide which evidence is genuinely absent/i);
    expect(summary.leadAction.id).toBe("scenario_sets");
    expect(scenarioRow?.statusLabel).toBe("Schema setup pending");
    expect(scenarioRow?.sourceLabel).toBe("Schema setup");
    expect(scenarioRow?.evidence).toMatch(/did not treat this as missing evidence/i);
    expect(scenarioRow?.nextAction).toMatch(/Apply the scenario spine tables/i);
    expect(fundingRow?.nextAction).toMatch(/funding profile, award, opportunity, and invoice tables/i);
  });

  /**
   * AN UNREADABLE LANE IS NOT AN EMPTY ONE.
   *
   * The board already modelled `schema_pending`, so a lane whose read FAILED
   * fell through to the ordinary readiness verdict and rendered "No crash
   * acquisition" / "Not linked" — on the same screen as a banner promising the
   * reader that failed reads are shown as unavailable rather than as zero. The
   * board contradicted the page it sits on.
   */
  it("renders an unreadable lane as a disclosed non-answer, not as missing evidence", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      safety: emptySafety,
      unreadable: { safety_evidence: true },
    });
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    expect(safetyRow?.sourceState).toBe("unreadable");
    expect(safetyRow?.sourceLabel).toBe("Read failed");
    expect(safetyRow?.statusLabel).toBe("Could not be read");
    // The lie that was on screen: an unreadable lane counted as evidence the
    // project does not have, and read as a clean setup gap.
    expect(safetyRow?.readiness).not.toBe("missing");
    expect(safetyRow?.statusLabel).not.toBe("No crash acquisition");
    expect(summary.missingCount).toBe(0);
    expect(summary.unreadableCount).toBe(1);
    expect(summary.unreadableLanes).toEqual(["Safety evidence"]);
    expect(summary.boardState).toBe("unreadable");
    expect(summary.stateDetail).toMatch(/an empty lane here would not mean the records are absent/i);
    expect(safetyRow?.caveat).toMatch(/an unreadable lane is not an empty one/i);
    expect(safetyRow?.nextAction).toMatch(/read failure disclosed at the top of this page/i);
  });

  /**
   * THE CARD PRINTED THE ZEROS IT HAD JUST SAID WERE NOT COUNTS.
   *
   * Both refusal branches rewrote the headline, the status, the evidence line
   * and the caveat — and left `detail` alone. `detail` is the lane's TALLY, so
   * the safety card read "0 acquisitions · latest: 0 ingested / 0 geocoded"
   * directly above "nothing shown here is a count of what exists". Those zeros
   * are the input's default, not a measurement.
   */
  it("stops printing a zero tally on a lane it has just called unreadable", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      safety: emptySafety,
      unreadable: { safety_evidence: true },
    });
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    // The exact string that was on screen.
    expect(safetyRow?.detail).not.toContain("0 acquisitions");
    expect(safetyRow?.detail).not.toMatch(/ingested|geocoded/i);
    expect(safetyRow?.detail).toBe("Counts unavailable — this lane's read failed");
  });

  it("stops printing a zero tally on a schema-pending lane too", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      scenarios: {
        scenarioSetCount: 0,
        activeScenarioSetCount: 0,
        baselineCount: 0,
        readyAlternativeCount: 0,
        attachedRunCount: 0,
      },
      pendingSchema: { scenario_sets: true },
    });
    const scenarioRow = summary.rows.find((row) => row.id === "scenario_sets");

    expect(scenarioRow?.detail).not.toContain("0 scenario sets");
    expect(scenarioRow?.detail).toBe("Counts unavailable — schema setup pending");
  });

  it("still prints the real tally on a lane that answered", () => {
    // Without this the two assertions above would pass on a board that had
    // stopped counting anything at all.
    const summary = buildProjectSpineCrosslinkSummary(baseInput);

    expect(summary.rows.find((row) => row.id === "safety_evidence")?.detail).toContain("1 acquisition");
    expect(summary.rows.find((row) => row.id === "safety_evidence")?.detail).toContain("1,180 ingested");
    expect(summary.rows.find((row) => row.id === "scenario_sets")?.detail).toContain("1 scenario set");
  });

  it("puts an unreadable lane ahead of a schema-pending one in the operator queue", () => {
    // Schema setup names a migration to apply. A failed read names nothing, and
    // until it is resolved no other row's number is worth acting on — so it is
    // the first move even though the pending lane has a tidier instruction.
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      safety: emptySafety,
      pendingSchema: { scenario_sets: true },
      unreadable: { safety_evidence: true },
    });

    expect(summary.leadAction.id).toBe("safety_evidence");
    expect(summary.schemaPendingCount).toBe(1);
    expect(summary.unreadableCount).toBe(1);
    expect(summary.boardState).toBe("unreadable");
    // Both states are live, and the operator hears both.
    expect(summary.stateDetail).toMatch(/Scenario sets is separately waiting on schema setup/i);
  });

  it("lets the unreadable state win when a lane is both unreadable and schema-pending", () => {
    // The two arrive together whenever a deployment is behind a migration AND
    // something else broke. Letting the known state mask the unknown one would
    // send an operator to run a migration that is not the problem.
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      safety: emptySafety,
      pendingSchema: { safety_evidence: true },
      unreadable: { safety_evidence: true },
    });
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    expect(safetyRow?.sourceState).toBe("unreadable");
    expect(safetyRow?.statusLabel).toBe("Could not be read");
    expect(safetyRow?.nextAction).not.toMatch(/Apply the safety crash tables/i);
    expect(summary.schemaPendingCount).toBe(0);
    expect(summary.unreadableCount).toBe(1);
  });

  it("renders safety evidence with the reported-vs-geocoded gap disclosed, never hidden", () => {
    const summary = buildProjectSpineCrosslinkSummary(baseInput);
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    expect(safetyRow?.readiness).toBe("ready");
    expect(safetyRow?.statusLabel).toBe("Crash evidence linked");
    // Both counts, always — 1,089 mapped points must never pass as the 1,180
    // reported crashes.
    expect(safetyRow?.headline).toContain("1,180 crashes ingested, 1,089 geocoded");
    expect(safetyRow?.detail).toContain("1 acquisition");
    expect(safetyRow?.detail).toContain("Statewide crash reporting system");
    expect(safetyRow?.evidence).toContain("Statewide reported collisions");
    expect(safetyRow?.caveat).toMatch(/none of this is an adopted safety plan/i);
    // Carries the project, because /safety seeds its study area from it. A bare
    // "/safety" retrieved crashes for the workspace's home geography instead.
    expect(safetyRow?.href).toBe("/safety?projectId=project-1");
  });

  it("treats a zero-crash acquisition as review work, not proof of zero crashes", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      safety: { ...emptySafety, ingestCount: 1 },
    });
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    expect(safetyRow?.readiness).toBe("attention");
    expect(safetyRow?.statusLabel).toBe("Acquisition needs review");
    expect(safetyRow?.headline).toMatch(/check its coverage state/i);
    expect(safetyRow?.headline).not.toMatch(/no crashes occurred/i);
  });

  it("marks an unlinked safety lane missing with an honest empty-evidence line", () => {
    const summary = buildProjectSpineCrosslinkSummary({ ...baseInput, safety: emptySafety });
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    expect(safetyRow?.readiness).toBe("missing");
    expect(safetyRow?.statusLabel).toBe("No crash acquisition");
    expect(safetyRow?.evidence).toMatch(/not evidence that no crashes occurred/i);
    expect(safetyRow?.nextAction).toMatch(/Run a crash acquisition/i);
  });

  it("turns a pending safety schema into a setup action for the safety lane", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      safety: emptySafety,
      pendingSchema: { safety_evidence: true },
    });
    const safetyRow = summary.rows.find((row) => row.id === "safety_evidence");

    expect(safetyRow?.sourceState).toBe("schema_pending");
    expect(safetyRow?.statusLabel).toBe("Schema setup pending");
    expect(safetyRow?.nextAction).toMatch(/Apply the safety crash tables/i);
  });

  it("keeps scenario sets in review posture until baseline and ready alternative evidence exist", () => {
    const summary = buildProjectSpineCrosslinkSummary({
      ...baseInput,
      scenarios: {
        scenarioSetCount: 2,
        activeScenarioSetCount: 1,
        baselineCount: 1,
        readyAlternativeCount: 0,
        attachedRunCount: 1,
      },
    });

    const scenarioRow = summary.rows.find((row) => row.id === "scenario_sets");

    expect(scenarioRow?.readiness).toBe("attention");
    expect(scenarioRow?.statusLabel).toBe("Scenario basis incomplete");
    expect(scenarioRow?.nextAction).toMatch(/baseline and at least one alternative/i);
    expect(scenarioRow?.evidence).toContain("1 attached run");
  });

  /**
   * THE DEFECT THESE PIN. Six of the eight lanes linked to a bare module path,
   * so clicking "Open models" from a project landed on every model in the
   * workspace and clicking "Open safety" retrieved crashes for the workspace's
   * home geography rather than this project's study area. The destinations were
   * never the problem — each one already reads the id the board was discarding.
   *
   * The lane-by-lane parameter names are asserted individually rather than
   * through a loop, because they are not interchangeable: `/grants` focuses a
   * queue on `focusProjectId` while the rest narrow a list on `projectId`, and a
   * lane sent the wrong name would silently fall back to the unfiltered page.
   */
  describe("every lane whose destination reads a project id carries one", () => {
    const summary = buildProjectSpineCrosslinkSummary(baseInput);
    const hrefFor = (id: string) => summary.rows.find((row) => row.id === id)?.href;

    it("narrows the scenario, model and aerial catalogs to this project", () => {
      expect(hrefFor("scenario_sets")).toBe("/scenarios?projectId=project-1");
      expect(hrefFor("analysis_modeling")).toBe("/models?projectId=project-1");
      expect(hrefFor("aerial_evidence")).toBe("/aerial?projectId=project-1");
    });

    it("keeps the grants lane on focusProjectId, which is the name that page reads", () => {
      expect(hrefFor("funding_profile")).toBe("/grants?focusProjectId=project-1");
      expect(hrefFor("engagement_evidence")).toBe("/engagement?projectId=project-1");
    });

    it("keeps the reporting lane as an in-page anchor, since it never left the project", () => {
      expect(hrefFor("rtp_packets")).toBe("#project-reporting");
    });

    it("opens model validation for this project once an area of record exists", () => {
      // /county-runs reads `?projectId=` and inherits the project's study
      // area; before this the board's own prose admitted model validation
      // "has to be opened for this project by hand".
      expect(hrefFor("geography")).toBe("/county-runs?projectId=project-1");

      // Varied binding: a second project must produce a second href, or this
      // test cannot tell "threads the id" from "hardcodes project-1".
      const other = buildProjectSpineCrosslinkSummary({ ...baseInput, projectId: "project-2" });
      expect(other.rows.find((row) => row.id === "geography")?.href).toBe(
        "/county-runs?projectId=project-2"
      );
    });

    it("keeps the study-area row on the project record until an area of record exists", () => {
      // A project-scoped model validation link is only honest when there is a
      // study area to inherit; until one is set (or only a drawn shape exists),
      // the row's job is still to get one set.
      const unset = buildProjectSpineCrosslinkSummary({
        ...baseInput,
        geography: {
          label: null,
          isDrawn: false,
          hasResolvableIdentity: false,
          workspaceFallbackLabel: null,
        },
      });
      expect(unset.rows.find((row) => row.id === "geography")?.href).toBe("#project-identity");
      expect(unset.rows.find((row) => row.id === "geography")?.actionLabel).toBe("Open project record");

      const drawn = buildProjectSpineCrosslinkSummary({
        ...baseInput,
        geography: {
          label: "Drawn corridor",
          isDrawn: true,
          hasResolvableIdentity: false,
          workspaceFallbackLabel: null,
        },
      });
      expect(drawn.rows.find((row) => row.id === "geography")?.href).toBe("#project-identity");
    });

    it("sends an analysis lane with no runs to Corridor Analysis, still carrying the project", () => {
      // "/models?projectId=" on a project with zero runs lands on an empty
      // catalog; /explore is where a project-linked run is created, and it
      // reads the same `?projectId=` and inherits the study area.
      const noRuns = buildProjectSpineCrosslinkSummary({
        ...baseInput,
        analysis: { recentRunCount: 0, comparisonBackedReportCount: 0 },
      });
      const analysisRow = noRuns.rows.find((row) => row.id === "analysis_modeling");
      expect(analysisRow?.readiness).toBe("missing");
      expect(analysisRow?.href).toBe("/explore?projectId=project-1");
      expect(analysisRow?.actionLabel).toBe("Open Corridor Analysis");

      // Varied binding again — two projects, two hrefs.
      const otherProject = buildProjectSpineCrosslinkSummary({
        ...baseInput,
        projectId: "project-2",
        analysis: { recentRunCount: 0, comparisonBackedReportCount: 0 },
      });
      expect(otherProject.rows.find((row) => row.id === "analysis_modeling")?.href).toBe(
        "/explore?projectId=project-2"
      );
    });

    it("percent-encodes an id rather than pasting it into the query string", () => {
      // Project ids are database-issued uuids today, so nothing needs escaping
      // yet. This pins the behaviour anyway: the board must not be the thing
      // that emits a malformed URL if that ever stops being true.
      const awkward = buildProjectSpineCrosslinkSummary({ ...baseInput, projectId: "a b&c=d" });

      expect(awkward.rows.find((row) => row.id === "safety_evidence")?.href).toBe(
        "/safety?projectId=a+b%26c%3Dd"
      );
    });

    it("stops claiming nothing on the board opens safety for this project", () => {
      // The geography lane used to end "nothing on this board opens them that
      // way yet", which the safety lane's href has now made false — and then
      // said model validation "has to be opened for this project by hand",
      // which its own href has now made false too.
      const geography = summary.rows.find((row) => row.id === "geography");

      expect(geography?.headline).toMatch(/crash retrieval for this project/i);
      expect(geography?.headline).not.toMatch(/nothing on this board/i);
      expect(geography?.headline).not.toMatch(/by hand/i);
    });

    it("only claims to open model validation because its href actually does", () => {
      // The headline is a claim about this row's own link, and both are built
      // right here — so the claim and the href are asserted together. A future
      // change that reroutes the href without rewording the headline (or the
      // reverse) fails this test instead of shipping a row that lies about
      // where it goes.
      const geography = summary.rows.find((row) => row.id === "geography");

      expect(geography?.headline).toMatch(/this row opens model validation for this project/i);
      expect(geography?.href).toBe("/county-runs?projectId=project-1");
    });
  });
});
