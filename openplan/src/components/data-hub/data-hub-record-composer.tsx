"use client";

/**
 * Registering the sources, datasets and refresh runs the Data Hub governs.
 *
 * WHY THREE BUTTONS INSTEAD OF THREE TABS. `/data-hub` is a catalogue you go to
 * in order to LOOK at what you have. Above it sat 844 lines of composer: three
 * tabbed forms carrying forty-two controls between them, all mounted, all the
 * time, whether or not anybody came to register anything. Tabs made it look
 * smaller than it was — the page still had to make room for the tallest one.
 *
 * Each record type is now its own guided flow behind its own button, because
 * they are three different jobs. A person registering a Census connector is not
 * halfway through logging last night's refresh, and a tab strip claimed they
 * might be.
 *
 * WHAT SURVIVED THE MOVE. Every one of the forty-two fields, every option in
 * every list, every enable/disable rule, and — the part worth checking — the
 * REQUEST BODY, unchanged field for field:
 *   - `rowCount` and `recordsWritten` still go as numbers or not at all,
 *     never as an empty string;
 *   - `startedAt` / `completedAt` are still converted to ISO, and omitted when
 *     blank rather than sent as `""`;
 *   - `relationshipType` is still sent only when a project was chosen;
 *   - `thematicMetricKey` / `thematicMetricLabel` are still sent only when the
 *     dataset is actually bound to a geometry — sending a metric for a dataset
 *     bound to nothing would name a column no map layer reads;
 *   - the error surfaced is still the server's own three-part sentence
 *     (`error — details — hint`), not a generic one.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Link2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GuidedFlow, GuidedFlowRow, useGuidedFlow } from "@/components/ui/guided-flow";

const selectClassName = "module-select";

type SelectOption = {
  id: string;
  label: string;
};

type DatasetOption = {
  id: string;
  label: string;
  connectorId: string | null;
};

type DataHubRecordComposerProps = {
  workspaceId: string;
  connectors: SelectOption[];
  projects: SelectOption[];
  datasets: DatasetOption[];
};

/** The metric lists depend on what the dataset is bound to. */
const THEMATIC_METRICS: Record<string, ReadonlyArray<{ value: string; label: string }>> = {
  analysis_corridor: [
    { value: "overallScore", label: "Overall score" },
    { value: "accessibilityScore", label: "Accessibility score" },
    { value: "safetyScore", label: "Safety score" },
    { value: "equityScore", label: "Equity score" },
  ],
  analysis_crash_points: [
    { value: "severityBucket", label: "Crash severity bucket" },
    { value: "pedestrianInvolved", label: "Pedestrian involvement" },
    { value: "bicyclistInvolved", label: "Bicyclist involvement" },
    { value: "fatalCount", label: "Fatality count" },
    { value: "injuryCount", label: "Injury count" },
  ],
  analysis_tracts: [
    { value: "pctMinority", label: "Minority share" },
    { value: "pctBelowPoverty", label: "Poverty share" },
    { value: "medianIncome", label: "Median income" },
    { value: "isDisadvantaged", label: "Proxy disadvantaged flag" },
    { value: "zeroVehiclePct", label: "Zero-vehicle households" },
    { value: "transitCommutePct", label: "Transit commute share" },
  ],
};

/** The three attachments that actually bind a dataset to drawn geometry. */
function isGeometryBound(attachment: string): boolean {
  return (
    attachment === "analysis_tracts" ||
    attachment === "analysis_corridor" ||
    attachment === "analysis_crash_points"
  );
}

type ConnectorValues = {
  connectorName: string;
  connectorKey: string;
  connectorType: string;
  connectorCategory: string;
  connectorStatus: string;
  connectorCadence: string;
  connectorAuthMode: string;
  connectorEndpointUrl: string;
  connectorOwner: string;
  connectorDescription: string;
  connectorPolicyMonitorEnabled: boolean;
};

type DatasetValues = {
  datasetName: string;
  datasetConnectorId: string;
  datasetProjectId: string;
  datasetRelationshipType: string;
  datasetStatus: string;
  datasetGeographyScope: string;
  datasetGeometryAttachment: string;
  datasetThematicMetricKey: string;
  datasetThematicMetricLabel: string;
  datasetCoverageSummary: string;
  datasetVintageLabel: string;
  datasetSourceUrl: string;
  datasetLicenseLabel: string;
  datasetSchemaVersion: string;
  datasetChecksum: string;
  datasetRowCount: string;
  datasetRefreshCadence: string;
  datasetCitationText: string;
  datasetNotes: string;
};

type JobValues = {
  jobName: string;
  jobConnectorId: string;
  jobDatasetId: string;
  jobType: string;
  jobStatus: string;
  jobRefreshMode: string;
  jobStartedAt: string;
  jobCompletedAt: string;
  jobRecordsWritten: string;
  jobTriggeredBy: string;
  jobErrorSummary: string;
};

const CONNECTOR_INITIAL: ConnectorValues = {
  connectorName: "",
  connectorKey: "",
  connectorType: "custom",
  connectorCategory: "internal",
  connectorStatus: "active",
  connectorCadence: "manual",
  connectorAuthMode: "none",
  connectorEndpointUrl: "",
  connectorOwner: "",
  connectorDescription: "",
  connectorPolicyMonitorEnabled: false,
};

const DATASET_INITIAL: DatasetValues = {
  datasetName: "",
  datasetConnectorId: "",
  datasetProjectId: "",
  datasetRelationshipType: "reference",
  datasetStatus: "draft",
  datasetGeographyScope: "corridor",
  datasetGeometryAttachment: "none",
  datasetThematicMetricKey: "",
  datasetThematicMetricLabel: "",
  datasetCoverageSummary: "",
  datasetVintageLabel: "",
  datasetSourceUrl: "",
  datasetLicenseLabel: "",
  datasetSchemaVersion: "",
  datasetChecksum: "",
  datasetRowCount: "",
  datasetRefreshCadence: "manual",
  datasetCitationText: "",
  datasetNotes: "",
};

const JOB_INITIAL: JobValues = {
  jobName: "",
  jobConnectorId: "",
  jobDatasetId: "",
  jobType: "refresh",
  jobStatus: "queued",
  jobRefreshMode: "manual",
  jobStartedAt: "",
  jobCompletedAt: "",
  jobRecordsWritten: "",
  jobTriggeredBy: "",
  jobErrorSummary: "",
};

const CADENCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
  { value: "ad_hoc", label: "Ad hoc" },
];

function Options({ options }: { options: ReadonlyArray<{ value: string; label: string }> }) {
  return (
    <>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </>
  );
}

export function DataHubRecordComposer({
  workspaceId,
  connectors,
  projects,
  datasets,
}: DataHubRecordComposerProps) {
  const router = useRouter();
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  async function submitRecord(payload: Record<string, unknown>) {
    const response = await fetch("/api/data-hub/records", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, ...payload }),
    });

    const data = (await response.json()) as { error?: string; details?: string; hint?: string };

    if (!response.ok) {
      // The server's own three parts, joined and unedited: `error` says what
      // happened, `details` and `hint` say what to do about it.
      throw new Error(
        [data.error, data.details, data.hint].filter(Boolean).join(" — ") || "Failed to save record"
      );
    }

    router.refresh();
  }

  const connectorFlow = useGuidedFlow<ConnectorValues>({
    id: "data-hub-connector",
    title: "New connector",
    submitLabel: "Add connector",
    initialValues: CONNECTOR_INITIAL,
    steps: [
      {
        id: "identity",
        title: "What is this source called?",
        hint: "A connector is one place data comes from — an agency API, a file drop, a vendor feed.",
        fields: [
          {
            name: "connectorName",
            label: "Connector name",
            required: true,
            requiredMessage: "Give the source a name you will recognise in a list.",
          },
          { name: "connectorKey", label: "Connector key" },
          { name: "connectorDescription", label: "Description" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="connectorName" label="Connector name">
              <Input {...flow.text("connectorName")} placeholder="Census ACS 5-Year" />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="connectorKey"
              label="Short key (optional)"
              hint="A short machine-friendly name, if you use one. Lowercase with dashes."
            >
              <Input {...flow.text("connectorKey")} placeholder="census-acs5" />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="connectorDescription"
              label="Description (optional)"
              hint="What this source gives you, why it matters, and anything that trips people up."
            >
              <Textarea
                {...flow.text("connectorDescription")}
                rows={4}
                placeholder="What this source provides, why it matters, and any operating caveats."
              />
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "kind",
        title: "What kind of source is it?",
        hint: "This is how the Data Hub groups and reports on it later.",
        fields: [
          { name: "connectorType", label: "Source type", required: true },
          { name: "connectorCategory", label: "Category", required: true },
          { name: "connectorStatus", label: "Status", required: true },
          { name: "connectorCadence", label: "Cadence", required: true },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="connectorType" label="Source type">
              <select {...flow.text("connectorType")} className={selectClassName}>
                <Options
                  options={[
                    { value: "census", label: "Census" },
                    { value: "lodes", label: "LODES" },
                    { value: "gtfs", label: "GTFS" },
                    { value: "crashes", label: "Crashes" },
                    { value: "parcel", label: "Parcel" },
                    { value: "manual", label: "Manual" },
                    { value: "custom", label: "Custom" },
                    { value: "policy", label: "Policy" },
                  ]}
                />
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="connectorCategory" label="Who publishes it">
              <select {...flow.text("connectorCategory")} className={selectClassName}>
                <Options
                  options={[
                    { value: "federal", label: "Federal" },
                    { value: "state", label: "State" },
                    { value: "regional", label: "Regional" },
                    { value: "local", label: "Local" },
                    { value: "vendor", label: "Vendor" },
                    { value: "internal", label: "Internal" },
                  ]}
                />
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="connectorStatus"
              label="Is it working right now?"
              hint="Degraded means it answers but not reliably. Offline means it does not answer."
            >
              <select {...flow.text("connectorStatus")} className={selectClassName}>
                <Options
                  options={[
                    { value: "draft", label: "Draft" },
                    { value: "active", label: "Active" },
                    { value: "degraded", label: "Degraded" },
                    { value: "offline", label: "Offline" },
                  ]}
                />
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="connectorCadence"
              label="How often does it update?"
              hint="How often the publisher releases new data — not how often you fetch it."
            >
              <select {...flow.text("connectorCadence")} className={selectClassName}>
                <Options options={CADENCE_OPTIONS} />
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "access",
        title: "How do you reach it, and who looks after it?",
        hint: "All optional. Fill in what you know now; the record can be edited later.",
        fields: [
          { name: "connectorEndpointUrl", label: "Endpoint or source URL" },
          { name: "connectorAuthMode", label: "Auth mode" },
          { name: "connectorOwner", label: "Owner label" },
          { name: "connectorPolicyMonitorEnabled", label: "Policy monitoring" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="connectorEndpointUrl" label="Endpoint or source URL">
              <Input
                {...flow.text("connectorEndpointUrl")}
                placeholder="https://api.census.gov/data/2023/acs/acs5"
              />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="connectorAuthMode"
              label="How you sign in to it"
              hint="Recorded so somebody else can pick this up. No key or password is stored here."
            >
              <select {...flow.text("connectorAuthMode")} className={selectClassName}>
                <Options
                  options={[
                    { value: "none", label: "None" },
                    { value: "api_key", label: "API key" },
                    { value: "oauth", label: "OAuth" },
                    { value: "service_account", label: "Service account" },
                    { value: "manual_upload", label: "Manual upload" },
                  ]}
                />
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="connectorOwner"
              label="Who looks after it (optional)"
              hint="A person or a team, so the next person knows who to ask."
            >
              <Input {...flow.text("connectorOwner")} placeholder="Priya / Data Ops" />
            </GuidedFlowRow>
            <div className="space-y-1.5">
              <label className="module-note flex items-center gap-3 text-sm text-foreground">
                <input
                  {...flow.fieldProps("connectorPolicyMonitorEnabled")}
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={flow.values.connectorPolicyMonitorEnabled}
                  onChange={(event) =>
                    flow.setValue("connectorPolicyMonitorEnabled", event.target.checked)
                  }
                />
                Watch this source for policy and bulletin changes
              </label>
            </div>
          </>
        ),
      },
    ],
    onSubmit: async (values) => {
      await submitRecord({
        recordType: "connector",
        displayName: values.connectorName,
        key: values.connectorKey,
        sourceType: values.connectorType,
        category: values.connectorCategory,
        status: values.connectorStatus,
        cadence: values.connectorCadence,
        authMode: values.connectorAuthMode,
        endpointUrl: values.connectorEndpointUrl,
        ownerLabel: values.connectorOwner,
        description: values.connectorDescription,
        policyMonitorEnabled: values.connectorPolicyMonitorEnabled,
      });
      setSavedNotice(`Connector “${values.connectorName}” saved.`);
    },
  });

  const datasetFlow = useGuidedFlow<DatasetValues>({
    id: "data-hub-dataset",
    title: "New dataset",
    submitLabel: "Add dataset",
    initialValues: DATASET_INITIAL,
    steps: [
      {
        id: "identity",
        title: "What is this dataset, and what does it belong to?",
        hint: "A dataset is one body of data you actually use — not the place it came from.",
        fields: [
          {
            name: "datasetName",
            label: "Dataset name",
            required: true,
            requiredMessage: "Give the dataset a name you will recognise in a list.",
          },
          { name: "datasetConnectorId", label: "Connector" },
          { name: "datasetProjectId", label: "Linked project" },
          { name: "datasetRelationshipType", label: "Project relationship" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="datasetName" label="Dataset name">
              <Input
                {...flow.text("datasetName")}
                placeholder="Equity indicators for study corridors"
              />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="datasetConnectorId"
              label="Where it came from (optional)"
              hint="Pick the connector it arrives through, or leave it as a manual import."
            >
              <select {...flow.text("datasetConnectorId")} className={selectClassName}>
                {/* An empty list says so in the placeholder rather than adding a
                    second option with the same empty value. */}
                <option value="">
                  {connectors.length === 0
                    ? "No connectors registered yet — manual import"
                    : "No connector / manual import"}
                </option>
                {connectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="datasetProjectId"
              label="Linked project (optional)"
              hint="Linking it means it shows up on that project's data lane."
            >
              <select {...flow.text("datasetProjectId")} className={selectClassName}>
                <option value="">Not linked yet</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="datasetRelationshipType"
              label="How the project uses it"
              hint="Only recorded when a project is linked."
            >
              <select
                {...flow.text("datasetRelationshipType")}
                className={selectClassName}
                disabled={!flow.values.datasetProjectId}
              >
                <Options
                  options={[
                    { value: "primary_input", label: "Primary input" },
                    { value: "reference", label: "Reference" },
                    { value: "evidence", label: "Evidence" },
                    { value: "baseline", label: "Baseline" },
                  ]}
                />
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "coverage",
        title: "What does it cover, and how fresh is it?",
        fields: [
          { name: "datasetStatus", label: "Status", required: true },
          { name: "datasetGeographyScope", label: "Geography", required: true },
          { name: "datasetCoverageSummary", label: "Coverage summary" },
          { name: "datasetVintageLabel", label: "Vintage" },
          { name: "datasetRefreshCadence", label: "Refresh cadence", required: true },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="datasetStatus" label="Status">
              <select {...flow.text("datasetStatus")} className={selectClassName}>
                <Options
                  options={[
                    { value: "draft", label: "Draft" },
                    { value: "ready", label: "Ready" },
                    { value: "refreshing", label: "Refreshing" },
                    { value: "stale", label: "Stale" },
                    { value: "error", label: "Error" },
                    { value: "archived", label: "Archived" },
                  ]}
                />
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="datasetGeographyScope"
              label="What area it describes"
              hint="Pick the smallest unit the data is reported at."
            >
              <select {...flow.text("datasetGeographyScope")} className={selectClassName}>
                <Options
                  options={[
                    { value: "corridor", label: "Corridor" },
                    { value: "tract", label: "Tract" },
                    { value: "county", label: "County" },
                    { value: "region", label: "Region" },
                    { value: "statewide", label: "Statewide" },
                    { value: "national", label: "National" },
                    { value: "route", label: "Route" },
                    { value: "point", label: "Point" },
                    { value: "none", label: "Not spatial" },
                  ]}
                />
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="datasetCoverageSummary" label="Coverage summary (optional)">
              <Input
                {...flow.text("datasetCoverageSummary")}
                placeholder="Study area focus zones + comparator geographies"
              />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="datasetVintageLabel"
              label="Vintage (optional)"
              hint="Which edition or year this is. It is what stops a five-year-old table passing as current."
            >
              <Input {...flow.text("datasetVintageLabel")} placeholder="ACS 2023 / Fall 2025" />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="datasetRefreshCadence" label="How often you refresh it">
              <select {...flow.text("datasetRefreshCadence")} className={selectClassName}>
                <Options options={CADENCE_OPTIONS} />
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "map",
        title: "Should this draw on a map?",
        hint: "Optional. Binding it to geometry is what lets a map colour something by one of its numbers.",
        fields: [
          { name: "datasetGeometryAttachment", label: "Geometry attachment", required: true },
          { name: "datasetThematicMetricKey", label: "Thematic metric" },
          { name: "datasetThematicMetricLabel", label: "Thematic label" },
        ],
        render: (flow) => {
          const attachment = flow.values.datasetGeometryAttachment;
          const bound = isGeometryBound(attachment);
          const metrics = THEMATIC_METRICS[attachment] ?? THEMATIC_METRICS.analysis_tracts;
          return (
            <>
              <GuidedFlowRow flow={flow} name="datasetGeometryAttachment" label="What it draws on">
                <select
                  {...flow.fieldProps("datasetGeometryAttachment")}
                  className={selectClassName}
                  value={attachment}
                  onChange={(event) =>
                    // Changing what it draws on changes which metrics exist, so
                    // a metric picked for the previous binding is cleared rather
                    // than sent as a name the new layer does not have.
                    flow.setValues({
                      datasetGeometryAttachment: event.target.value,
                      datasetThematicMetricKey: "",
                    })
                  }
                >
                  <Options
                    options={[
                      { value: "none", label: "Nothing — it is just a record" },
                      { value: "analysis_tracts", label: "Census tracts in the analysis" },
                      { value: "analysis_corridor", label: "The analysis corridor" },
                      { value: "analysis_crash_points", label: "Crash points in the analysis" },
                    ]}
                  />
                </select>
              </GuidedFlowRow>
              <GuidedFlowRow
                flow={flow}
                name="datasetThematicMetricKey"
                label="Which number colours the map"
                hint={bound ? undefined : "Pick something for it to draw on first."}
              >
                <select
                  {...flow.text("datasetThematicMetricKey")}
                  className={selectClassName}
                  disabled={!bound}
                >
                  <option value="">Select metric</option>
                  <Options options={metrics} />
                </select>
              </GuidedFlowRow>
              <GuidedFlowRow
                flow={flow}
                name="datasetThematicMetricLabel"
                label="What to call it on the legend (optional)"
              >
                <Input
                  {...flow.text("datasetThematicMetricLabel")}
                  disabled={!bound}
                  placeholder={
                    attachment === "analysis_corridor"
                      ? "Safety score / Corridor equity score"
                      : attachment === "analysis_crash_points"
                        ? "Crash severity / VRU involvement"
                        : "Equity disadvantage screening / Transit dependence"
                  }
                />
              </GuidedFlowRow>
            </>
          );
        },
      },
      {
        id: "provenance",
        title: "Where did it come from, and how should it be cited?",
        hint: "All optional, and all of it is what lets somebody else defend this number in a hearing.",
        fields: [
          { name: "datasetSourceUrl", label: "Source URL" },
          { name: "datasetLicenseLabel", label: "License and permitted use" },
          { name: "datasetSchemaVersion", label: "Schema version" },
          { name: "datasetChecksum", label: "Checksum" },
          { name: "datasetRowCount", label: "Row count" },
          { name: "datasetCitationText", label: "Citation" },
          { name: "datasetNotes", label: "Notes" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="datasetSourceUrl" label="Source URL">
              <Input {...flow.text("datasetSourceUrl")} placeholder="https://api.census.gov/data/..." />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="datasetLicenseLabel"
              label="What you are allowed to do with it"
            >
              <Input
                {...flow.text("datasetLicenseLabel")}
                placeholder="Public domain / CC BY / vendor-restricted"
              />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="datasetSchemaVersion" label="Schema version">
              <Input {...flow.text("datasetSchemaVersion")} placeholder="v2026.03" />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="datasetChecksum"
              label="Checksum / digest"
              hint="Lets you prove later that the file has not changed."
            >
              <Input {...flow.text("datasetChecksum")} placeholder="sha256:..." />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="datasetRowCount" label="How many rows">
              <Input {...flow.text("datasetRowCount")} type="number" min="0" placeholder="1842" />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="datasetCitationText"
              label="How to cite it"
              hint="The exact wording for reports, hearings and exported evidence packs."
            >
              <Textarea
                {...flow.text("datasetCitationText")}
                rows={3}
                placeholder="How this dataset should be cited in reports, hearings, or exported evidence packs."
              />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="datasetNotes"
              label="Notes"
              hint="Caveats, QA findings, assumptions made at import, anything still to clean up."
            >
              <Textarea
                {...flow.text("datasetNotes")}
                rows={4}
                placeholder="Known caveats, QA notes, import assumptions, or pending cleanup steps."
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    onSubmit: async (values) => {
      const bound = isGeometryBound(values.datasetGeometryAttachment);
      await submitRecord({
        recordType: "dataset",
        name: values.datasetName,
        connectorId: values.datasetConnectorId || undefined,
        projectId: values.datasetProjectId || undefined,
        relationshipType: values.datasetProjectId ? values.datasetRelationshipType : undefined,
        status: values.datasetStatus,
        geographyScope: values.datasetGeographyScope,
        geometryAttachment: values.datasetGeometryAttachment,
        thematicMetricKey: bound ? values.datasetThematicMetricKey || undefined : undefined,
        thematicMetricLabel: bound ? values.datasetThematicMetricLabel || undefined : undefined,
        coverageSummary: values.datasetCoverageSummary,
        vintageLabel: values.datasetVintageLabel,
        sourceUrl: values.datasetSourceUrl,
        licenseLabel: values.datasetLicenseLabel,
        schemaVersion: values.datasetSchemaVersion,
        checksum: values.datasetChecksum,
        rowCount: values.datasetRowCount ? Number(values.datasetRowCount) : undefined,
        refreshCadence: values.datasetRefreshCadence,
        citationText: values.datasetCitationText,
        notes: values.datasetNotes,
      });
      setSavedNotice(`Dataset “${values.datasetName}” saved.`);
    },
  });

  const jobFlow = useGuidedFlow<JobValues>({
    id: "data-hub-refresh-job",
    title: "Log a refresh run",
    submitLabel: "Add refresh job",
    initialValues: JOB_INITIAL,
    steps: [
      {
        id: "what",
        title: "What ran, and against what?",
        hint: "A refresh job is the record of one attempt to bring data up to date.",
        fields: [
          {
            name: "jobName",
            label: "Job name",
            required: true,
            requiredMessage: "Give the run a name you will recognise in the history.",
          },
          { name: "jobConnectorId", label: "Connector" },
          { name: "jobDatasetId", label: "Dataset" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="jobName" label="Job name">
              <Input {...flow.text("jobName")} placeholder="Weekly ACS refresh check" />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="jobConnectorId" label="Connector (optional)">
              <select {...flow.text("jobConnectorId")} className={selectClassName}>
                <option value="">
                  {connectors.length === 0 ? "No connectors registered yet" : "No connector selected"}
                </option>
                {connectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="jobDatasetId" label="Dataset (optional)">
              <select {...flow.text("jobDatasetId")} className={selectClassName}>
                <option value="">
                  {datasets.length === 0 ? "No datasets registered yet" : "No dataset selected"}
                </option>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "outcome",
        title: "What kind of run was it, and how did it go?",
        fields: [
          { name: "jobType", label: "Job type", required: true },
          { name: "jobStatus", label: "Status", required: true },
          { name: "jobRefreshMode", label: "Execution mode", required: true },
          { name: "jobRecordsWritten", label: "Records written" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="jobType" label="What it was doing">
              <select {...flow.text("jobType")} className={selectClassName}>
                <Options
                  options={[
                    { value: "ingest", label: "Ingest — first load" },
                    { value: "refresh", label: "Refresh — bring up to date" },
                    { value: "validation", label: "Validation — check it" },
                    { value: "backfill", label: "Backfill — fill in history" },
                  ]}
                />
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="jobStatus" label="How it ended">
              <select {...flow.text("jobStatus")} className={selectClassName}>
                <Options
                  options={[
                    { value: "queued", label: "Queued" },
                    { value: "running", label: "Running" },
                    { value: "succeeded", label: "Succeeded" },
                    { value: "failed", label: "Failed" },
                    { value: "cancelled", label: "Cancelled" },
                  ]}
                />
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="jobRefreshMode" label="What started it">
              <select {...flow.text("jobRefreshMode")} className={selectClassName}>
                <Options
                  options={[
                    { value: "manual", label: "Somebody ran it" },
                    { value: "scheduled", label: "A schedule ran it" },
                    { value: "pipeline", label: "A pipeline ran it" },
                    { value: "analysis_runtime", label: "An analysis run needed it" },
                  ]}
                />
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="jobRecordsWritten" label="Rows written (optional)">
              <Input {...flow.text("jobRecordsWritten")} type="number" min="0" placeholder="0" />
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "when",
        title: "When did it run, and is there anything to note?",
        hint: "All optional. Leave the times blank if you are recording this after the fact.",
        fields: [
          { name: "jobStartedAt", label: "Started at" },
          { name: "jobCompletedAt", label: "Completed at" },
          { name: "jobTriggeredBy", label: "Triggered by" },
          { name: "jobErrorSummary", label: "Failure note" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="jobStartedAt" label="Started at">
              <Input {...flow.text("jobStartedAt")} type="datetime-local" />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="jobCompletedAt" label="Finished at">
              <Input {...flow.text("jobCompletedAt")} type="datetime-local" />
            </GuidedFlowRow>
            <GuidedFlowRow flow={flow} name="jobTriggeredBy" label="Who or what started it">
              <Input {...flow.text("jobTriggeredBy")} placeholder="Manual QA sweep / nightly cron" />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="jobErrorSummary"
              label="What happened (optional)"
              hint="What failed, what was refreshed, or what still needs somebody's attention."
            >
              <Textarea
                {...flow.text("jobErrorSummary")}
                rows={4}
                placeholder="Optional summary of what failed, what was refreshed, or what still needs attention."
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    onSubmit: async (values) => {
      await submitRecord({
        recordType: "refreshJob",
        jobName: values.jobName,
        connectorId: values.jobConnectorId || undefined,
        datasetId: values.jobDatasetId || undefined,
        jobType: values.jobType,
        status: values.jobStatus,
        refreshMode: values.jobRefreshMode,
        startedAt: values.jobStartedAt ? new Date(values.jobStartedAt).toISOString() : undefined,
        completedAt: values.jobCompletedAt
          ? new Date(values.jobCompletedAt).toISOString()
          : undefined,
        recordsWritten: values.jobRecordsWritten ? Number(values.jobRecordsWritten) : undefined,
        triggeredByLabel: values.jobTriggeredBy,
        errorSummary: values.jobErrorSummary,
      });
      setSavedNotice(`Refresh run “${values.jobName}” saved.`);
    },
  });

  return (
    <article className="module-section-surface">
      <div className="module-section-heading">
        <p className="module-section-label">Create records</p>
        <h2 className="module-section-title">Register a source, a dataset, or a refresh run</h2>
        <p className="module-section-description">
          These three records are how OpenPlan knows where your numbers came from. A connector is a
          place data comes from; a dataset is a body of data you use; a refresh run is one attempt to
          bring a dataset up to date.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" onClick={connectorFlow.open}>
          <Link2 className="mr-1.5 h-4 w-4" />
          Add a connector
        </Button>
        <Button type="button" variant="outline" onClick={datasetFlow.open}>
          <Database className="mr-1.5 h-4 w-4" />
          Add a dataset
        </Button>
        <Button type="button" variant="outline" onClick={jobFlow.open}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Log a refresh run
        </Button>
      </div>

      {savedNotice ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {savedNotice} It is in the catalogue below.
        </p>
      ) : null}

      <div className="module-alert mt-5 text-sm">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4.5 w-4.5" />
          <p>
            Register the governance records first. Automated ingestion and policy diffing are wired
            into these same objects later, rather than into parallel hidden state.
          </p>
        </div>
      </div>

      <GuidedFlow flow={connectorFlow} />
      <GuidedFlow flow={datasetFlow} />
      <GuidedFlow flow={jobFlow} />
    </article>
  );
}
