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
    safetyScore: number;
    equityScore: number;
    overallScore?: number;
    confidence?: string;
    totalTransitStops?: number;
    transitAccessTier?: string;
    totalPopulation?: number;
    medianIncome?: number | null;
    pctMinority?: number;
    pctBelowPoverty?: number;
    pctTransit?: number;
    pctWalk?: number;
    pctBike?: number;
    pctZeroVehicle?: number;
    totalFatalCrashes?: number;
    totalFatalities?: number;
    crashesPerSquareMile?: number;
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
      transit?: { source?: string; note?: string; fetchedAt?: string };
      crashes?: { source?: string; yearsQueried?: number[]; note?: string; fetchedAt?: string };
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
  plan: string;
  onboardingChecklist: string[];
};

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
export type ReportTemplate = "atp" | "ss4a";

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
