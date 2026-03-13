"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Link2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const selectClassName =
  "flex h-11 w-full rounded-2xl border border-input bg-background px-3 text-sm text-foreground";

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

function FormError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

export function DataHubRecordComposer({
  workspaceId,
  connectors,
  projects,
  datasets,
}: DataHubRecordComposerProps) {
  const router = useRouter();

  const [connectorName, setConnectorName] = useState("");
  const [connectorKey, setConnectorKey] = useState("");
  const [connectorType, setConnectorType] = useState("custom");
  const [connectorCategory, setConnectorCategory] = useState("internal");
  const [connectorStatus, setConnectorStatus] = useState("active");
  const [connectorCadence, setConnectorCadence] = useState("manual");
  const [connectorAuthMode, setConnectorAuthMode] = useState("none");
  const [connectorEndpointUrl, setConnectorEndpointUrl] = useState("");
  const [connectorOwner, setConnectorOwner] = useState("");
  const [connectorDescription, setConnectorDescription] = useState("");
  const [connectorPolicyMonitorEnabled, setConnectorPolicyMonitorEnabled] = useState(false);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [connectorSaving, setConnectorSaving] = useState(false);

  const [datasetName, setDatasetName] = useState("");
  const [datasetConnectorId, setDatasetConnectorId] = useState("");
  const [datasetProjectId, setDatasetProjectId] = useState("");
  const [datasetRelationshipType, setDatasetRelationshipType] = useState("reference");
  const [datasetStatus, setDatasetStatus] = useState("draft");
  const [datasetGeographyScope, setDatasetGeographyScope] = useState("corridor");
  const [datasetCoverageSummary, setDatasetCoverageSummary] = useState("");
  const [datasetVintageLabel, setDatasetVintageLabel] = useState("");
  const [datasetSourceUrl, setDatasetSourceUrl] = useState("");
  const [datasetLicenseLabel, setDatasetLicenseLabel] = useState("");
  const [datasetSchemaVersion, setDatasetSchemaVersion] = useState("");
  const [datasetChecksum, setDatasetChecksum] = useState("");
  const [datasetRowCount, setDatasetRowCount] = useState("");
  const [datasetRefreshCadence, setDatasetRefreshCadence] = useState("manual");
  const [datasetCitationText, setDatasetCitationText] = useState("");
  const [datasetNotes, setDatasetNotes] = useState("");
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [datasetSaving, setDatasetSaving] = useState(false);

  const [jobName, setJobName] = useState("");
  const [jobConnectorId, setJobConnectorId] = useState("");
  const [jobDatasetId, setJobDatasetId] = useState("");
  const [jobType, setJobType] = useState("refresh");
  const [jobStatus, setJobStatus] = useState("queued");
  const [jobRefreshMode, setJobRefreshMode] = useState("manual");
  const [jobStartedAt, setJobStartedAt] = useState("");
  const [jobCompletedAt, setJobCompletedAt] = useState("");
  const [jobRecordsWritten, setJobRecordsWritten] = useState("");
  const [jobTriggeredBy, setJobTriggeredBy] = useState("");
  const [jobErrorSummary, setJobErrorSummary] = useState("");
  const [jobError, setJobError] = useState<string | null>(null);
  const [jobSaving, setJobSaving] = useState(false);

  async function submitRecord(payload: Record<string, unknown>) {
    const response = await fetch("/api/data-hub/records", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, ...payload }),
    });

    const data = (await response.json()) as { error?: string; details?: string; hint?: string };

    if (!response.ok) {
      throw new Error([data.error, data.details, data.hint].filter(Boolean).join(" — ") || "Failed to save record");
    }

    router.refresh();
  }

  async function handleConnectorSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConnectorError(null);
    setConnectorSaving(true);

    try {
      await submitRecord({
        recordType: "connector",
        displayName: connectorName,
        key: connectorKey,
        sourceType: connectorType,
        category: connectorCategory,
        status: connectorStatus,
        cadence: connectorCadence,
        authMode: connectorAuthMode,
        endpointUrl: connectorEndpointUrl,
        ownerLabel: connectorOwner,
        description: connectorDescription,
        policyMonitorEnabled: connectorPolicyMonitorEnabled,
      });

      setConnectorName("");
      setConnectorKey("");
      setConnectorType("custom");
      setConnectorCategory("internal");
      setConnectorStatus("active");
      setConnectorCadence("manual");
      setConnectorAuthMode("none");
      setConnectorEndpointUrl("");
      setConnectorOwner("");
      setConnectorDescription("");
      setConnectorPolicyMonitorEnabled(false);
    } catch (error) {
      setConnectorError(error instanceof Error ? error.message : "Failed to save connector");
    } finally {
      setConnectorSaving(false);
    }
  }

  async function handleDatasetSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDatasetError(null);
    setDatasetSaving(true);

    try {
      await submitRecord({
        recordType: "dataset",
        name: datasetName,
        connectorId: datasetConnectorId || undefined,
        projectId: datasetProjectId || undefined,
        relationshipType: datasetProjectId ? datasetRelationshipType : undefined,
        status: datasetStatus,
        geographyScope: datasetGeographyScope,
        coverageSummary: datasetCoverageSummary,
        vintageLabel: datasetVintageLabel,
        sourceUrl: datasetSourceUrl,
        licenseLabel: datasetLicenseLabel,
        schemaVersion: datasetSchemaVersion,
        checksum: datasetChecksum,
        rowCount: datasetRowCount ? Number(datasetRowCount) : undefined,
        refreshCadence: datasetRefreshCadence,
        citationText: datasetCitationText,
        notes: datasetNotes,
      });

      setDatasetName("");
      setDatasetConnectorId("");
      setDatasetProjectId("");
      setDatasetRelationshipType("reference");
      setDatasetStatus("draft");
      setDatasetGeographyScope("corridor");
      setDatasetCoverageSummary("");
      setDatasetVintageLabel("");
      setDatasetSourceUrl("");
      setDatasetLicenseLabel("");
      setDatasetSchemaVersion("");
      setDatasetChecksum("");
      setDatasetRowCount("");
      setDatasetRefreshCadence("manual");
      setDatasetCitationText("");
      setDatasetNotes("");
    } catch (error) {
      setDatasetError(error instanceof Error ? error.message : "Failed to save dataset");
    } finally {
      setDatasetSaving(false);
    }
  }

  async function handleRefreshJobSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJobError(null);
    setJobSaving(true);

    try {
      await submitRecord({
        recordType: "refreshJob",
        jobName,
        connectorId: jobConnectorId || undefined,
        datasetId: jobDatasetId || undefined,
        jobType,
        status: jobStatus,
        refreshMode: jobRefreshMode,
        startedAt: jobStartedAt ? new Date(jobStartedAt).toISOString() : undefined,
        completedAt: jobCompletedAt ? new Date(jobCompletedAt).toISOString() : undefined,
        recordsWritten: jobRecordsWritten ? Number(jobRecordsWritten) : undefined,
        triggeredByLabel: jobTriggeredBy,
        errorSummary: jobErrorSummary,
      });

      setJobName("");
      setJobConnectorId("");
      setJobDatasetId("");
      setJobType("refresh");
      setJobStatus("queued");
      setJobRefreshMode("manual");
      setJobStartedAt("");
      setJobCompletedAt("");
      setJobRecordsWritten("");
      setJobTriggeredBy("");
      setJobErrorSummary("");
    } catch (error) {
      setJobError(error instanceof Error ? error.message : "Failed to save refresh job");
    } finally {
      setJobSaving(false);
    }
  }

  const connectorSelectOptions = connectors.length > 0 ? connectors : [{ id: "", label: "No connectors yet" }];
  const datasetSelectOptions = datasets.length > 0 ? datasets : [{ id: "", label: "No datasets yet", connectorId: null }];

  return (
    <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
      <div className="space-y-2">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Create records</p>
        <h2 className="text-xl font-semibold tracking-tight">Register connectors, datasets, and refresh jobs</h2>
        <p className="text-sm text-muted-foreground">
          This is the first real operator surface for OpenPlan&apos;s data fabric: not just hidden helpers, but governed source records tied back to projects and refresh activity.
        </p>
      </div>

      <Tabs defaultValue="connector" className="mt-5">
        <TabsList
          variant="line"
          className="w-full justify-start gap-2 overflow-x-auto rounded-2xl border border-border/70 bg-background/70 p-2"
        >
          <TabsTrigger value="connector" className="gap-2 rounded-xl px-3 py-2 data-[state=active]:bg-card">
            <Link2 className="h-4 w-4" />
            Connector
          </TabsTrigger>
          <TabsTrigger value="dataset" className="gap-2 rounded-xl px-3 py-2 data-[state=active]:bg-card">
            <Database className="h-4 w-4" />
            Dataset
          </TabsTrigger>
          <TabsTrigger value="refresh-job" className="gap-2 rounded-xl px-3 py-2 data-[state=active]:bg-card">
            <RefreshCw className="h-4 w-4" />
            Refresh Job
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connector" className="pt-4">
          <form className="space-y-4" onSubmit={handleConnectorSubmit}>
            <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-2">
                <label htmlFor="connector-name" className="text-sm font-medium">
                  Connector name
                </label>
                <Input
                  id="connector-name"
                  value={connectorName}
                  onChange={(event) => setConnectorName(event.target.value)}
                  placeholder="Census ACS 5-Year"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="connector-key" className="text-sm font-medium">
                  Connector key
                </label>
                <Input
                  id="connector-key"
                  value={connectorKey}
                  onChange={(event) => setConnectorKey(event.target.value)}
                  placeholder="census-acs5"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <label htmlFor="connector-type" className="text-sm font-medium">
                  Source type
                </label>
                <select id="connector-type" className={selectClassName} value={connectorType} onChange={(event) => setConnectorType(event.target.value)}>
                  <option value="census">Census</option>
                  <option value="lodes">LODES</option>
                  <option value="gtfs">GTFS</option>
                  <option value="crashes">Crashes</option>
                  <option value="parcel">Parcel</option>
                  <option value="manual">Manual</option>
                  <option value="custom">Custom</option>
                  <option value="policy">Policy</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="connector-category" className="text-sm font-medium">
                  Category
                </label>
                <select id="connector-category" className={selectClassName} value={connectorCategory} onChange={(event) => setConnectorCategory(event.target.value)}>
                  <option value="federal">Federal</option>
                  <option value="state">State</option>
                  <option value="regional">Regional</option>
                  <option value="local">Local</option>
                  <option value="vendor">Vendor</option>
                  <option value="internal">Internal</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="connector-status" className="text-sm font-medium">
                  Status
                </label>
                <select id="connector-status" className={selectClassName} value={connectorStatus} onChange={(event) => setConnectorStatus(event.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="degraded">Degraded</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="connector-cadence" className="text-sm font-medium">
                  Cadence
                </label>
                <select id="connector-cadence" className={selectClassName} value={connectorCadence} onChange={(event) => setConnectorCadence(event.target.value)}>
                  <option value="manual">Manual</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                  <option value="ad_hoc">Ad hoc</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <label htmlFor="connector-url" className="text-sm font-medium">
                  Endpoint or source URL
                </label>
                <Input
                  id="connector-url"
                  value={connectorEndpointUrl}
                  onChange={(event) => setConnectorEndpointUrl(event.target.value)}
                  placeholder="https://api.census.gov/data/2023/acs/acs5"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="connector-auth" className="text-sm font-medium">
                  Auth mode
                </label>
                <select id="connector-auth" className={selectClassName} value={connectorAuthMode} onChange={(event) => setConnectorAuthMode(event.target.value)}>
                  <option value="none">None</option>
                  <option value="api_key">API key</option>
                  <option value="oauth">OAuth</option>
                  <option value="service_account">Service account</option>
                  <option value="manual_upload">Manual upload</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-2">
                <label htmlFor="connector-owner" className="text-sm font-medium">
                  Owner label
                </label>
                <Input
                  id="connector-owner"
                  value={connectorOwner}
                  onChange={(event) => setConnectorOwner(event.target.value)}
                  placeholder="Priya / Data Ops"
                />
              </div>
              <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={connectorPolicyMonitorEnabled}
                  onChange={(event) => setConnectorPolicyMonitorEnabled(event.target.checked)}
                />
                Enable policy / bulletin monitoring for this connector
              </label>
            </div>

            <div className="space-y-2">
              <label htmlFor="connector-description" className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id="connector-description"
                value={connectorDescription}
                onChange={(event) => setConnectorDescription(event.target.value)}
                rows={4}
                placeholder="What this source provides, why it matters, and any operating caveats."
              />
            </div>

            <FormError error={connectorError} />
            <Button type="submit" disabled={connectorSaving}>
              {connectorSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving connector…
                </>
              ) : (
                "Add connector"
              )}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="dataset" className="pt-4">
          <form className="space-y-4" onSubmit={handleDatasetSubmit}>
            <div className="space-y-2">
              <label htmlFor="dataset-name" className="text-sm font-medium">
                Dataset name
              </label>
              <Input
                id="dataset-name"
                value={datasetName}
                onChange={(event) => setDatasetName(event.target.value)}
                placeholder="ACS equity indicators for Nevada County corridors"
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="dataset-connector" className="text-sm font-medium">
                  Connector
                </label>
                <select id="dataset-connector" className={selectClassName} value={datasetConnectorId} onChange={(event) => setDatasetConnectorId(event.target.value)}>
                  <option value="">No connector / manual import</option>
                  {connectorSelectOptions.map((connector) => (
                    <option key={connector.id || connector.label} value={connector.id} disabled={!connector.id}>
                      {connector.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="dataset-project" className="text-sm font-medium">
                  Linked project
                </label>
                <select id="dataset-project" className={selectClassName} value={datasetProjectId} onChange={(event) => setDatasetProjectId(event.target.value)}>
                  <option value="">Not linked yet</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="dataset-relationship" className="text-sm font-medium">
                  Project relationship
                </label>
                <select id="dataset-relationship" className={selectClassName} value={datasetRelationshipType} onChange={(event) => setDatasetRelationshipType(event.target.value)} disabled={!datasetProjectId}>
                  <option value="primary_input">Primary input</option>
                  <option value="reference">Reference</option>
                  <option value="evidence">Evidence</option>
                  <option value="baseline">Baseline</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <label htmlFor="dataset-status" className="text-sm font-medium">
                  Status
                </label>
                <select id="dataset-status" className={selectClassName} value={datasetStatus} onChange={(event) => setDatasetStatus(event.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="ready">Ready</option>
                  <option value="refreshing">Refreshing</option>
                  <option value="stale">Stale</option>
                  <option value="error">Error</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="dataset-geo" className="text-sm font-medium">
                  Geography
                </label>
                <select id="dataset-geo" className={selectClassName} value={datasetGeographyScope} onChange={(event) => setDatasetGeographyScope(event.target.value)}>
                  <option value="corridor">Corridor</option>
                  <option value="tract">Tract</option>
                  <option value="county">County</option>
                  <option value="region">Region</option>
                  <option value="statewide">Statewide</option>
                  <option value="national">National</option>
                  <option value="route">Route</option>
                  <option value="point">Point</option>
                  <option value="none">Not spatial</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="dataset-vintage" className="text-sm font-medium">
                  Vintage
                </label>
                <Input id="dataset-vintage" value={datasetVintageLabel} onChange={(event) => setDatasetVintageLabel(event.target.value)} placeholder="ACS 2023 / Fall 2025" />
              </div>
              <div className="space-y-2">
                <label htmlFor="dataset-cadence" className="text-sm font-medium">
                  Refresh cadence
                </label>
                <select id="dataset-cadence" className={selectClassName} value={datasetRefreshCadence} onChange={(event) => setDatasetRefreshCadence(event.target.value)}>
                  <option value="manual">Manual</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                  <option value="ad_hoc">Ad hoc</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="dataset-coverage" className="text-sm font-medium">
                Coverage summary
              </label>
              <Input id="dataset-coverage" value={datasetCoverageSummary} onChange={(event) => setDatasetCoverageSummary(event.target.value)} placeholder="Nevada County focus areas + comparator geographies" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="dataset-url" className="text-sm font-medium">
                  Source URL
                </label>
                <Input id="dataset-url" value={datasetSourceUrl} onChange={(event) => setDatasetSourceUrl(event.target.value)} placeholder="https://api.census.gov/data/..." />
              </div>
              <div className="space-y-2">
                <label htmlFor="dataset-license" className="text-sm font-medium">
                  License / usage posture
                </label>
                <Input id="dataset-license" value={datasetLicenseLabel} onChange={(event) => setDatasetLicenseLabel(event.target.value)} placeholder="Public domain / CC BY / vendor-restricted" />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="dataset-schema" className="text-sm font-medium">
                  Schema version
                </label>
                <Input id="dataset-schema" value={datasetSchemaVersion} onChange={(event) => setDatasetSchemaVersion(event.target.value)} placeholder="v2026.03" />
              </div>
              <div className="space-y-2">
                <label htmlFor="dataset-checksum" className="text-sm font-medium">
                  Checksum / digest
                </label>
                <Input id="dataset-checksum" value={datasetChecksum} onChange={(event) => setDatasetChecksum(event.target.value)} placeholder="sha256:..." />
              </div>
              <div className="space-y-2">
                <label htmlFor="dataset-rows" className="text-sm font-medium">
                  Row count
                </label>
                <Input id="dataset-rows" type="number" min="0" value={datasetRowCount} onChange={(event) => setDatasetRowCount(event.target.value)} placeholder="1842" />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="dataset-citation" className="text-sm font-medium">
                Citation / provenance note
              </label>
              <Textarea
                id="dataset-citation"
                value={datasetCitationText}
                onChange={(event) => setDatasetCitationText(event.target.value)}
                rows={3}
                placeholder="How this dataset should be cited in reports, hearings, or exported evidence packs."
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="dataset-notes" className="text-sm font-medium">
                Notes
              </label>
              <Textarea
                id="dataset-notes"
                value={datasetNotes}
                onChange={(event) => setDatasetNotes(event.target.value)}
                rows={4}
                placeholder="Known caveats, QA notes, import assumptions, or pending cleanup steps."
              />
            </div>

            <FormError error={datasetError} />
            <Button type="submit" disabled={datasetSaving}>
              {datasetSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving dataset…
                </>
              ) : (
                "Add dataset"
              )}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="refresh-job" className="pt-4">
          <form className="space-y-4" onSubmit={handleRefreshJobSubmit}>
            <div className="space-y-2">
              <label htmlFor="job-name" className="text-sm font-medium">
                Job name
              </label>
              <Input id="job-name" value={jobName} onChange={(event) => setJobName(event.target.value)} placeholder="Weekly ACS refresh check" required />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="job-connector" className="text-sm font-medium">
                  Connector
                </label>
                <select id="job-connector" className={selectClassName} value={jobConnectorId} onChange={(event) => setJobConnectorId(event.target.value)}>
                  <option value="">No connector selected</option>
                  {connectorSelectOptions.map((connector) => (
                    <option key={connector.id || connector.label} value={connector.id} disabled={!connector.id}>
                      {connector.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="job-dataset" className="text-sm font-medium">
                  Dataset
                </label>
                <select id="job-dataset" className={selectClassName} value={jobDatasetId} onChange={(event) => setJobDatasetId(event.target.value)}>
                  <option value="">No dataset selected</option>
                  {datasetSelectOptions.map((dataset) => (
                    <option key={dataset.id || dataset.label} value={dataset.id} disabled={!dataset.id}>
                      {dataset.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <label htmlFor="job-type" className="text-sm font-medium">
                  Job type
                </label>
                <select id="job-type" className={selectClassName} value={jobType} onChange={(event) => setJobType(event.target.value)}>
                  <option value="ingest">Ingest</option>
                  <option value="refresh">Refresh</option>
                  <option value="validation">Validation</option>
                  <option value="backfill">Backfill</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="job-status" className="text-sm font-medium">
                  Status
                </label>
                <select id="job-status" className={selectClassName} value={jobStatus} onChange={(event) => setJobStatus(event.target.value)}>
                  <option value="queued">Queued</option>
                  <option value="running">Running</option>
                  <option value="succeeded">Succeeded</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="job-mode" className="text-sm font-medium">
                  Execution mode
                </label>
                <select id="job-mode" className={selectClassName} value={jobRefreshMode} onChange={(event) => setJobRefreshMode(event.target.value)}>
                  <option value="manual">Manual</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="pipeline">Pipeline</option>
                  <option value="analysis_runtime">Analysis runtime</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="job-records" className="text-sm font-medium">
                  Records written
                </label>
                <Input id="job-records" type="number" min="0" value={jobRecordsWritten} onChange={(event) => setJobRecordsWritten(event.target.value)} placeholder="0" />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="job-started" className="text-sm font-medium">
                  Started at
                </label>
                <Input id="job-started" type="datetime-local" value={jobStartedAt} onChange={(event) => setJobStartedAt(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="job-completed" className="text-sm font-medium">
                  Completed at
                </label>
                <Input id="job-completed" type="datetime-local" value={jobCompletedAt} onChange={(event) => setJobCompletedAt(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="job-triggered" className="text-sm font-medium">
                  Triggered by
                </label>
                <Input id="job-triggered" value={jobTriggeredBy} onChange={(event) => setJobTriggeredBy(event.target.value)} placeholder="Manual QA sweep / nightly cron" />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="job-error" className="text-sm font-medium">
                Failure note / operator summary
              </label>
              <Textarea
                id="job-error"
                value={jobErrorSummary}
                onChange={(event) => setJobErrorSummary(event.target.value)}
                rows={4}
                placeholder="Optional summary of what failed, what was refreshed, or what still needs attention."
              />
            </div>

            <FormError error={jobError} />
            <Button type="submit" disabled={jobSaving}>
              {jobSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving refresh job…
                </>
              ) : (
                "Add refresh job"
              )}
            </Button>
          </form>
        </TabsContent>
      </Tabs>

      <div className="mt-5 rounded-2xl border border-amber-300/40 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-200">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4.5 w-4.5" />
          <p>
            This first pass is deliberately operator-focused: create the governance records now, then wire automated ingestion and policy diffing into the same objects instead of inventing parallel hidden state later.
          </p>
        </div>
      </div>
    </article>
  );
}
