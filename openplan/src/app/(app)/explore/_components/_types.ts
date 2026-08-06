import type { MapViewState } from "@/lib/analysis/map-view-state";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

export type Position = [number, number] | [number, number, number];

export type Polygon = {
  type: "Polygon";
  coordinates: Position[][];
};

export type MultiPolygon = {
  type: "MultiPolygon";
  coordinates: Position[][][];
};

export type CorridorGeometry = Polygon | MultiPolygon;

export type AnalysisResult = {
  runId: string;
  title?: string;
  createdAt?: string | null;
  metrics: {
    accessibilityScore: number;
    /**
     * NULL when no crash source answered — see `computeSafety`. This was typed
     * `number`, which was simply untrue (the API response is cast, so TypeScript
     * never checked it), and the results board interpolated it into a template
     * literal: every run outside a registered crash adapter's coverage rendered a
     * Safety tile reading the literal string "null".
     */
    safetyScore: number | null;
    equityScore: number;
    overallScore?: number;
    confidence?: string;
    totalTransitStops?: number;
    transitAccessTier?: string;
    /**
     * The census block is nullable for the same reason: null means the ACS
     * universe behind the figure was empty, i.e. NOT MEASURED. It is not zero,
     * and it must not render as a finding. See `censusReportedFigures`.
     */
    totalPopulation?: number | null;
    medianIncome?: number | null;
    pctMinority?: number | null;
    pctBelowPoverty?: number | null;
    pctTransit?: number | null;
    pctWalk?: number | null;
    pctBike?: number | null;
    pctZeroVehicle?: number | null;
    /** Which ACS universes were measured; absent on runs made before this existed. */
    censusMeasuredUniverses?: {
      tracts?: boolean;
      population?: boolean;
      commuteMode?: boolean;
      vehicleAccess?: boolean;
      income?: boolean;
    };
    /** How far this run may be carried into a decision. See `decision-use.ts`. */
    decisionUseStatus?: string;
    totalFatalCrashes?: number | null;
    totalFatalities?: number | null;
    crashesPerSquareMile?: number | null;
    crashPointCount?: number;
    jobsPerResident?: number;
    stopsPerSquareMile?: number;
    walkBikeAccessTier?: string;
    dataQuality?: {
      censusAvailable?: boolean;
      crashDataAvailable?: boolean;
      lodesSource?: string;
      equitySource?: string;
      aiInterpretationSource?: string;
    };
    sourceSnapshots?: {
      census?: {
        source?: string;
        dataset?: string;
        vintage?: string;
        geography?: string;
        tractCount?: number;
        retrievalUrl?: string;
        fetchedAt?: string;
      };
      lodes?: { source?: string; note?: string; fetchedAt?: string };
      transit?: {
        source?: string;
        note?: string;
        fetchedAt?: string;
        /**
         * True when a transit source actually answered. THE HONEST TEST for
         * whether this run has transit figures at all — do not test the tone or
         * the availability of transit against a particular adapter id, which is
         * a test that is wrong for every adapter registered afterwards.
         */
        observed?: boolean;
        /** How the figures were measured. See `data-sources/transit/method.ts`. */
        method?: {
          id?: string;
          label?: string;
          detail?: string;
          frequencyTermApplied?: boolean;
        };
        frequentServiceShare?: number | null;
        frequentServiceHeadwayMinutes?: number | null;
        caveats?: string[];
      };
      crashes?: {
        /**
         * OMITTED when nothing was observed — see `buildCrashSourceSnapshot`.
         * Its presence is therefore the honest test for "a crash source
         * answered"; do not test for any particular adapter id.
         */
        source?: string;
        /** The honest identifier, present whether or not anything was observed. */
        state?: string;
        /** Human label for the adapter that answered, e.g. "CCRS (California)". */
        label?: string;
        yearsQueried?: number[];
        note?: string;
        fetchedAt?: string;
      };
      equity?: { source?: string; note?: string; fetchedAt?: string };
    };
    mapViewState?: Partial<MapViewState>;
    aiInterpretationSource?: string;
    [key: string]: unknown;
  };
  geojson: GeoJSON.FeatureCollection;
  summary: string;
  aiInterpretation?: string;
  aiInterpretationSource?: string;
};

export type CurrentWorkspaceResponse = {
  workspaceId: string;
  name: string | null;
  role: string;
};

export type WorkspaceBootstrapResponse = {
  workspaceId: string;
  slug: string;
  // No tier field. `/api/workspaces/bootstrap` has not returned one since the
  // paid-tier subsystem was deleted; this type still declared it, which is the
  // kind of stale shape a future reader would try to render.
  onboardingChecklist: string[];
};

export type AnalysisProjectSelection = "explicit" | "defaulted" | "none";

export type AnalysisContextResponse = {
  workspaceId: string;
  project: {
    id: string;
    name: string;
    summary: string | null;
    status: string;
    planType: string;
    deliveryPhase: string;
    updatedAt: string;
  } | null;
  projectSelection: AnalysisProjectSelection;
  linkedDatasets: Array<{
    datasetId: string;
    name: string;
    status: string;
    geographyScope: string;
    geometryAttachment: string;
    thematicMetricKey: string | null;
    thematicMetricLabel: string | null;
    relationshipType: string;
    vintageLabel: string | null;
    lastRefreshedAt: string | null;
    connectorLabel: string | null;
    overlayReady: boolean;
    thematicReady: boolean;
  }>;
  migrationPending: boolean;
  counts: {
    deliverables: number;
    risks: number;
    issues: number;
    decisions: number;
    meetings: number;
    linkedDatasets: number;
    overlayReadyDatasets: number;
    recentRuns: number;
  };
  recentRuns: Array<{
    id: string;
    title: string;
    created_at: string;
  }>;
  operationsSummary: WorkspaceOperationsSummary;
};

export type WorkspaceLoadState = "loading" | "loaded" | "signedOut" | "noMembership" | "error";
export type AnalysisContextLoadState = "idle" | "loading" | "loaded" | "error";

/**
 * Whether the workspace's home geography has been read yet.
 *
 * `"loaded"` means the question was answered — the workspace may still have no
 * home geography, which is a real answer and not a failure. `"unavailable"`
 * means it could not be asked, and must never be presented as "none set": one
 * of those states preselects nothing on purpose, the other preselects nothing
 * because it does not know.
 */
export type HomeGeographyLoadState = "idle" | "loading" | "loaded" | "unavailable";
export type ReportTemplate = "atp" | "ss4a";
export type TractMetric = "minority" | "poverty" | "income" | "disadvantaged";

export type HoveredTract = {
  name: string;
  geoid: string;
  population: number | null;
  medianIncome: number | null;
  pctMinority: number | null;
  pctBelowPoverty: number | null;
  zeroVehiclePct: number | null;
  transitCommutePct: number | null;
  isDisadvantaged: boolean;
};

export type HoveredCrash = {
  severityLabel: string;
  collisionYear: number | null;
  fatalCount: number;
  injuryCount: number;
  pedestrianInvolved: boolean;
  bicyclistInvolved: boolean;
};

export type TractLegendItem = {
  label: string;
  color: string;
};
