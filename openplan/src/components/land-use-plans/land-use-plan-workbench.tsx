"use client";

import Link from "next/link";
import { FormEvent, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { LandUsePlanContextEditor } from "./land-use-plan-context-editor";
import { LandUsePlanRetainedContext } from "./land-use-plan-retained-context";
import { LandUsePlanFreezeControl } from "./land-use-plan-freeze-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildAdoptionBlockers, buildLandUsePlanWorkflow, buildPublicDraftBlockers, percentComplete } from "@/lib/land-use-plans/workflow";
import { describePlanSourceReview } from "@/lib/land-use-plans/source-review";
import { describeDescriptorCustody } from "@/lib/land-use-plans/descriptor-snapshot";
import type { FrozenPlanIdentity } from "@/lib/land-use-plans/frozen-identity";
import type { SavedPlanContext } from "@/lib/land-use-plans/plan-context";

type WorkbenchData = {
  actorId: string; descriptorHash: string;
  plan: { id: string; workspace_id: string; descriptor_id: string; plan_kind_key: string; title: string; authority_label: string; geography_label: string; geography_geojson: Record<string, unknown> | null; current_working_version_id: string | null; current_adopted_version_id: string | null };
  frozenVersion: { plan: FrozenPlanIdentity; descriptorCustody: "frozen" | "not_retained";
    context: { status: "retained"; context: SavedPlanContext } | { status: "legacy" } } | null;
  descriptor: {
    id: string; configured: boolean; disclosure: string; verifiedAt: string; reviewDueAt: string;
    terminology: { plan: string; section: string; adoptionInstrument: string; implementationReport: string };
    requirements: Array<{ key: string; label: string; applicability: "required" | "conditional" | "locally_defined"; condition?: string; sourceUrls: string[] }>;
    processSteps: Array<{ key: string; label: string; required: boolean; reviewPrerequisite?: boolean; adoptionPrerequisite?: boolean; deadline?: string; sourceUrls: string[] }>;
    sourceUrls: string[];
  };
  canWrite: boolean;
  isHistoricalVersion: boolean;
  versions: Array<{ id: string; version_number: number; version_kind: string; state: string; draft_revision: number; applicable_requirement_keys: string[]; content_hash: string | null; frozen_at: string | null; published_report_id: string | null }>;
  activeVersion: { id: string; version_number: number; version_kind: string; state: string; draft_revision: number; applicable_requirement_keys: string[]; content_hash: string | null; frozen_at: string | null; published_report_id: string | null };
  nodes: Array<{ id: string; parent_node_id: string | null; node_kind: string; requirement_key: string | null; title: string; body: string | null; sort_order: number; evidence_document_id: string | null; evidence_url: string | null }>;
  relationships: Array<{ id: string; related_plan_label: string; relationship_kind: string; notes: string | null }>;
  designations: Array<{ id: string; layer_id: string; layer_version_id: string; designation_set_label: string; public_field_keys: string[]; legend_field: string | null; map_note: string }>;
  actions: Array<{ id: string; title: string; responsible_party: string | null; due_on: string | null; status: string; project_id: string | null; program_id: string | null }>;
  reviews: Array<{ id: string; event_kind: string; occurred_on: string | null; decision_body: string | null; notes: string | null }>;
  decisions: Array<{ id: string; version_id: string; instrument_type: string; instrument_identifier: string; decided_on: string; effective_on: string | null }>;
  reports: Array<{ id: string; reporting_period_start: string; reporting_period_end: string; report_id: string | null }>;
  consultations: Array<{ id: string; status: string; confidential_notes: string | null; contains_sensitive_locations: boolean }>;
  processRecords: Array<{ id: string; process_key: string; status: string; due_on: string | null; completed_on: string | null; evidence_document_id: string | null; notes: string | null }>;
  reviewReleases: Array<{ id: string; version_id: string; version_content_hash: string; round_number: number; share_token: string; review_method: string; review_open_on: string; review_close_on: string; engagement_campaign_id: string | null; status: string; outcome_hash: string | null; withdrawal_reason: string | null }>;
  layers: Array<{ id: string; name: string; current_version_id: string | null }>;
  layerVersions: Array<{ id: string; attribute_fields: Array<{ name?: string }> | null; bbox: unknown; feature_count: number; feature_hash: string | null }>;
  documents: Array<{ id: string; title: string; citation_label: string | null }>;
  campaigns: Array<{ id: string; title: string; status: string }>;
  projects: Array<{ id: string; name: string }>;
  programs: Array<{ id: string; title: string }>;
};

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as { error?: string; blockers?: string[]; missing?: string[] };
  if (!response.ok) throw new Error([payload.error, ...(payload.blockers ?? []), ...(payload.missing ?? [])].filter(Boolean).join(" "));
  return payload;
}

async function patchJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The update failed");
  return payload;
}

// Refresh clean fields from the server while retaining local changes. A successful
// save acknowledges only its submitted snapshot, so typing during that save stays local.
function usePlanDraftMap<T extends string | { title: string; body: string }>() {
  const [state, setState] = useState<{ scope: string | null; values: Record<string, T>; drafts: Record<string, T> }>({ scope: null, values: {}, drafts: {} });
  const setDrafts = useCallback((update: SetStateAction<Record<string, T>>) => {
    setState((current) => ({ ...current, drafts: typeof update === "function" ? update(current.drafts) : update }));
  }, []);
  const refreshDrafts = useCallback((values: Record<string, T>, scope: string) => {
    setState((current) => ({
      scope, values,
      drafts: Object.fromEntries(Object.entries(values).map(([id, value]) => [
        id,
        current.scope === scope && Object.hasOwn(current.drafts, id)
          && JSON.stringify(current.drafts[id]) !== JSON.stringify(current.values[id]) ? current.drafts[id] : value,
      ])),
    }));
  }, []);
  const acknowledge = useCallback((id: string, value: T, scope: string) => {
    setState((current) => current.scope === scope ? { ...current, values: { ...current.values, [id]: value } } : current);
  }, []);
  const hasUnsaved = Object.entries(state.drafts).some(([id, value]) => JSON.stringify(value) !== JSON.stringify(state.values[id]));
  return { drafts: state.drafts, setDrafts, refreshDrafts, acknowledge, hasUnsaved };
}

export function LandUsePlanWorkbench({ planId, versionId }: { planId: string; versionId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contextGate, setContextGate] = useState<{ scope: string; blocked: boolean } | null>(null);
  const contextBlockChanged = useCallback((scope: string, blocked: boolean) => setContextGate({ scope, blocked }), []);
  const { drafts: sectionDrafts, setDrafts: setSectionDrafts, refreshDrafts: refreshSections, acknowledge: acknowledgeSection, hasUnsaved: unsavedSections } = usePlanDraftMap<string>();
  const { drafts: sectionEvidenceDocuments, setDrafts: setSectionEvidenceDocuments, refreshDrafts: refreshDocuments, acknowledge: acknowledgeDocument, hasUnsaved: unsavedDocuments } = usePlanDraftMap<string>();
  const { drafts: sectionEvidenceUrls, setDrafts: setSectionEvidenceUrls, refreshDrafts: refreshUrls, acknowledge: acknowledgeUrl, hasUnsaved: unsavedUrls } = usePlanDraftMap<string>();
  const { drafts: contentDrafts, setDrafts: setContentDrafts, refreshDrafts: refreshContent, acknowledge: acknowledgeContent, hasUnsaved: unsavedContent } = usePlanDraftMap<{ title: string; body: string }>();
  const [designationLayerId, setDesignationLayerId] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/land-use-plans/${planId}${versionId !== undefined ? `?versionId=${encodeURIComponent(versionId)}` : ""}`, { cache: "no-store" });
    const payload = await response.json() as WorkbenchData & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Failed to load plan");
    setData(payload);
    const scope = `${planId}:${payload.activeVersion.id}:${payload.activeVersion.state}`;
    refreshSections(Object.fromEntries(payload.nodes.filter((node) => node.node_kind === "section").map((node) => [node.id, node.body ?? ""])), scope);
    refreshDocuments(Object.fromEntries(payload.nodes.filter((node) => node.node_kind === "section").map((node) => [node.id, node.evidence_document_id ?? ""])), scope);
    refreshUrls(Object.fromEntries(payload.nodes.filter((node) => node.node_kind === "section").map((node) => [node.id, node.evidence_url ?? ""])), scope);
    refreshContent(Object.fromEntries(payload.nodes.filter((node) => node.node_kind !== "section").map((node) => [node.id, { title: node.title, body: node.body ?? "" }])), scope);
  }, [planId, versionId, refreshSections, refreshDocuments, refreshUrls, refreshContent]);

  useEffect(() => { void load().catch((error) => setLoadingError(error instanceof Error ? error.message : "Failed to load plan")); }, [load]);

  async function run(work: () => Promise<unknown>, event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!data?.canWrite) { setActionError("This plan view is read-only."); return; }
    setBusy(true); setActionError(null);
    try { await work(); await load(); router.refresh(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "The operation failed"); }
    finally { setBusy(false); }
  }

  const workflow = useMemo(() => {
    if (!data) return [];
    const completed = data.nodes.filter((node) => node.node_kind === "section" && node.body?.trim()).map((node) => node.requirement_key).filter((key): key is string => Boolean(key));
    return buildLandUsePlanWorkflow({
      descriptor: data.descriptor as Parameters<typeof buildLandUsePlanWorkflow>[0]["descriptor"],
      applicableRequirementKeys: data.activeVersion.applicable_requirement_keys,
      completedRequirementKeys: completed,
      hasDesignation: data.designations.length > 0,
      hasImplementationAction: data.actions.length > 0,
      hasStoredGeography: data.frozenVersion ? data.frozenVersion.context.status === "retained" : Boolean(data.plan.geography_geojson),
      processRecords: data.processRecords.map((record) => ({ processKey: record.process_key, status: record.status })),
      hasReviewRelease: data.reviewReleases.some((release) => release.version_id === data.activeVersion.id && release.status !== "withdrawn"),
      hasClosedReviewRelease: data.reviewReleases.some((release) => release.version_id === data.activeVersion.id && release.status === "closed"),
      hasAdoptionDecision: data.decisions.some((decision) => decision.version_id === data.activeVersion.id),
      hasPublishedReport: Boolean(data.activeVersion.published_report_id),
      hasImplementationReport: data.reports.length > 0,
    });
  }, [data]);

  const publicDraftBlockers = useMemo(() => {
    if (!data) return [];
    const completedRequirementKeys = data.nodes.filter((node) => node.node_kind === "section" && node.body?.trim()).map((node) => node.requirement_key).filter((key): key is string => Boolean(key));
    const requiredReviewPrerequisiteKeys = data.descriptor.processSteps.filter((step) => step.required && step.reviewPrerequisite).map((step) => step.key);
    const completedProcessKeys = data.processRecords.filter((record) => record.status === "complete").map((record) => record.process_key);
    return buildPublicDraftBlockers({
      descriptor: data.descriptor,
      applicableRequirementKeys: data.activeVersion.applicable_requirement_keys,
      completedRequirementKeys,
      hasDesignation: data.designations.length > 0,
      hasImplementationAction: data.actions.length > 0,
      requiredReviewPrerequisiteKeys,
      completedProcessKeys,
      requiresConsultation: data.descriptor.processSteps.some((step) => step.key === "tribal_consultation" && step.required),
      consultationStatus: data.consultations[0]?.status ?? null,
    });
  }, [data]);

  const adoptionBlockers = useMemo(() => {
    if (!data || data.activeVersion.state !== "public_review") return [];
    return buildAdoptionBlockers({
      requiredPrerequisites: data.descriptor.processSteps.filter((step) => step.required && step.adoptionPrerequisite).map((step) => ({ key: step.key, label: step.label })),
      processRecords: data.processRecords.map((record) => ({ processKey: record.process_key, status: record.status })),
      hasClosedReviewRelease: data.reviewReleases.some((release) => release.version_id === data.activeVersion.id && release.status === "closed"),
    });
  }, [data]);

  if (loadingError) return <div role="alert" className="rounded-lg border border-destructive p-4 text-destructive">{loadingError}. This is a read failure, not an empty plan.</div>;
  if (!data) return <p className="p-8 text-sm text-muted-foreground">Loading plan workbench…</p>;
  const workbenchData = data;
  const draftScope = `${planId}:${data.activeVersion.id}:${data.activeVersion.state}`;
  const contextScope = `${data.actorId}:${data.plan.workspace_id}:${planId}:${data.activeVersion.id}:${data.activeVersion.draft_revision}`;
  const contextBlocked = contextGate?.scope !== contextScope || contextGate.blocked;
  const hasUnsavedContent = unsavedSections || unsavedDocuments || unsavedUrls || unsavedContent || contextBlocked;
  const working = data.activeVersion.state === "working";
  const displayPlan = data.frozenVersion ? { title: data.frozenVersion.plan.title,
    authority_label: data.frozenVersion.plan.authorityLabel, geography_label: data.frozenVersion.plan.geographyLabel } : data.plan;
  const adopted = data.activeVersion.state === "adopted";
  const consultation = data.consultations[0];
  const selectedLayer = data.layers.find((layer) => layer.id === designationLayerId);
  const selectedLayerVersion = data.layerVersions.find((version) => version.id === selectedLayer?.current_version_id);
  const selectedLayerFields = (selectedLayerVersion?.attribute_fields ?? [])
    .flatMap((field) => typeof field?.name === "string" ? [field.name] : []);
  const currentVersionReleases = data.reviewReleases.filter((release) => release.version_id === data.activeVersion.id);
  async function saveSection(nodeId: string) {
    const body = sectionDrafts[nodeId] ?? "";
    const evidenceDocument = sectionEvidenceDocuments[nodeId] ?? "";
    const evidenceUrl = sectionEvidenceUrls[nodeId] ?? "";
    await postJson(`/api/land-use-plans/${planId}/content`, { operation: "update", nodeId, body, evidenceDocumentId: evidenceDocument || null, evidenceUrl: evidenceUrl || null });
    acknowledgeSection(nodeId, body, draftScope);
    acknowledgeDocument(nodeId, evidenceDocument, draftScope);
    acknowledgeUrl(nodeId, evidenceUrl, draftScope);
  }

  async function saveContentNode(nodeId: string) {
    const draft = contentDrafts[nodeId];
    if (!draft) throw new Error("That content node is unavailable");
    await postJson(`/api/land-use-plans/${planId}/content`, {
      operation: "update",
      nodeId,
      title: draft.title,
      body: draft.body || null,
    });
    acknowledgeContent(nodeId, draft, draftScope);
  }

  async function setRequirementApplicability(requirementKey: string, applicable: boolean) {
    const keys = new Set(workbenchData.activeVersion.applicable_requirement_keys);
    if (applicable) keys.add(requirementKey); else keys.delete(requirementKey);
    await patchJson(`/api/land-use-plans/${planId}`, { applicableRequirementKeys: [...keys] });
  }

  async function submitNode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await postJson(`/api/land-use-plans/${planId}/content`, { operation: "create", parentNodeId: String(form.get("parentNodeId")) || null, nodeKind: String(form.get("nodeKind")), title: String(form.get("title")), body: String(form.get("body")) || null, sortOrder: workbenchData.nodes.length + 1 });
    formElement.reset();
  }

  async function submitDesignation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const layerId = String(form.get("layerId"));
    const layer = workbenchData.layers.find((item) => item.id === layerId); const layerVersionId = layer?.current_version_id;
    if (!layerVersionId) throw new Error("Choose a GIS layer with a ready current version");
    await postJson(`/api/land-use-plans/${planId}/designations`, { layerId, layerVersionId, designationSetLabel: String(form.get("label")), legendMetadata: { source: "workspace_gis_layer", layerName: layer.name }, publicFieldKeys: form.getAll("publicFieldKeys").map(String), legendField: String(form.get("legendField")) || null, policyNodeIds: form.getAll("policyNodeIds").map(String) });
    formElement.reset();
    setDesignationLayerId("");
  }

  async function submitImplementation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await postJson(`/api/land-use-plans/${planId}/implementation`, { operation: "create", title: String(form.get("title")), responsibleParty: String(form.get("responsibleParty")) || null, dueOn: String(form.get("dueOn")) || null, projectId: String(form.get("projectId")) || null, programId: String(form.get("programId")) || null });
    formElement.reset();
  }

  async function submitRelationship(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await postJson(`/api/land-use-plans/${planId}/relationships`, { relatedPlanLabel: String(form.get("label")), relationshipKind: String(form.get("kind")), notes: String(form.get("notes")) || null });
    formElement.reset();
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await postJson(`/api/land-use-plans/${planId}/reviews`, { operation: "record_event", versionId: workbenchData.activeVersion.id, eventKind: String(form.get("eventKind")), occurredOn: String(form.get("occurredOn")) || null, decisionBody: String(form.get("decisionBody")) || null, engagementCampaignId: String(form.get("campaignId")) || null, evidenceDocumentId: String(form.get("documentId")) || null, notes: String(form.get("notes")) || null });
    formElement.reset();
  }

  async function submitConsultation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await postJson(`/api/land-use-plans/${planId}/reviews`, { operation: "record_consultation", versionId: workbenchData.activeVersion.id, status: String(form.get("status")), evidenceDocumentId: String(form.get("documentId")) || null, confidentialNotes: String(form.get("notes")) || null, containsSensitiveLocations: form.get("sensitive") === "on" });
  }

  async function submitAdoption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await postJson(`/api/land-use-plans/${planId}/decisions`, { operation: "adopt", versionId: workbenchData.activeVersion.id, versionContentHash: workbenchData.activeVersion.content_hash, decisionKind: workbenchData.activeVersion.version_kind === "amendment" ? "amendment" : "adoption", decisionBody: String(form.get("decisionBody")), instrumentType: String(form.get("instrumentType")), instrumentIdentifier: String(form.get("instrumentIdentifier")), vote: String(form.get("vote")) || null, decidedOn: String(form.get("decidedOn")), effectiveOn: String(form.get("effectiveOn")) || null, supportingDocumentId: String(form.get("documentId")) });
  }

  async function submitAnnualReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await postJson(`/api/land-use-plans/${planId}/implementation-reports`, { reportingPeriodStart: String(form.get("start")), reportingPeriodEnd: String(form.get("end")), title: String(form.get("title")), summary: String(form.get("summary")) || null });
    formElement.reset();
  }

  async function submitProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await postJson(`/api/land-use-plans/${planId}/process`, { versionId: workbenchData.activeVersion.id, processKey: String(form.get("processKey")), status: String(form.get("status")), dueOn: String(form.get("dueOn")) || null, completedOn: String(form.get("completedOn")) || null, evidenceDocumentId: String(form.get("documentId")) || null, notes: String(form.get("notes")) || null });
    formElement.reset();
  }

  async function submitReviewRelease(event: FormEvent<HTMLFormElement>, reviewMethod: "engagement_campaign" | "external_process") {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await postJson(`/api/land-use-plans/${planId}/review-releases`, { operation: "release", versionId: workbenchData.activeVersion.id, versionContentHash: workbenchData.activeVersion.content_hash, reviewMethod, reviewOpenOn: String(form.get("reviewOpenOn")), reviewCloseOn: String(form.get("reviewCloseOn")), engagementCampaignId: reviewMethod === "engagement_campaign" ? String(form.get("campaignId")) || null : null, externalReviewDocumentId: reviewMethod === "external_process" ? String(form.get("documentId")) || null : null });
    formElement.reset();
  }

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{data.descriptor.terminology.plan} · version {data.activeVersion.version_number}</p><h1 className="mt-1 text-3xl font-bold">{displayPlan.title}</h1><p className="mt-2 text-sm text-muted-foreground">{displayPlan.authority_label} · {displayPlan.geography_label}</p></div>
          <div className="rounded-lg bg-muted px-4 py-3 text-right"><p className="text-2xl font-bold">{percentComplete(workflow)}%</p><p className="text-xs text-muted-foreground">workflow complete</p></div>
        </div>
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">{data.descriptor.disclosure}</p>
        <p className="mt-2 text-xs text-muted-foreground">{describePlanSourceReview(data.descriptor)} OpenPlan does not certify legal sufficiency.</p>
        {data.frozenVersion ? <p className="mt-2 text-sm text-muted-foreground">{describeDescriptorCustody(data.frozenVersion.descriptorCustody)}</p> : null}
      </header>

      <nav aria-label="Plan version history" className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Version history</h2>
        <p className="text-sm text-muted-foreground">Open another version in a new tab to keep this page and any unsaved drafts in place.</p>
        {data.isHistoricalVersion ? <p className="text-sm">This historical view is read-only. <a href={`/land-use-plans/${planId}`} target="_blank" rel="noopener noreferrer" className="underline">Open the current plan in a new tab</a> to continue work.</p> : null}
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.versions.map(version => <li key={version.id} className="min-w-0 rounded-lg border border-border p-3 text-sm">
          {version.id === data.activeVersion.id ? <span aria-current="page" className="font-medium">Viewing version {version.version_number}</span>
            : <a href={`/land-use-plans/${planId}?versionId=${encodeURIComponent(version.id)}`} target="_blank" rel="noopener noreferrer" className="font-medium underline">Open version {version.version_number} in a new tab</a>}
          <p className="mt-1 text-muted-foreground">{version.version_kind.replaceAll("_", " ")} · {version.state.replaceAll("_", " ")}</p>
        </li>)}</ul>
      </nav>

      {actionError ? <div role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{actionError}</div> : null}
      {working ? <p role="status" className="rounded-lg border border-border bg-card p-3 text-sm">{busy ? "Saving and refreshing the plan. New typing remains unsaved." : hasUnsavedContent ? "Context or content needs attention. Save edits and review recovery copies before freezing the plan." : "Context, section and content-node changes are saved."}</p> : null}
      {data.frozenVersion ? <LandUsePlanRetainedContext value={data.frozenVersion.context}/> : null}
      <details open={working} className="space-y-3">
        <summary className="cursor-pointer text-sm font-medium">{working ? "Plan context and request recovery" : "Current plan context and request recovery"}</summary>
      <LandUsePlanContextEditor key={`${data.actorId}:${data.plan.workspace_id}:${planId}`} actorId={data.actorId} workspaceId={data.plan.workspace_id} planId={planId}
        activeVersionId={data.activeVersion.id} draftRevision={data.activeVersion.draft_revision} workingVersionId={data.plan.current_working_version_id} descriptorId={data.plan.descriptor_id} planKindKey={data.plan.plan_kind_key}
        working={working} canWrite={data.canWrite} disabled={busy} authorityLabel={data.plan.authority_label} geographyLabel={data.plan.geography_label}
        onRefresh={async () => { await load(); router.refresh(); }} onBlockChange={contextBlockChanged}/>
      </details>
      <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Workflow</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{workflow.map((step) => <div key={step.key} className={`rounded-lg border p-3 text-sm ${step.complete ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-border"}`}><span className="font-medium">{step.complete ? "Complete" : "Open"}</span> · {step.label}{step.humanOnly ? <span className="ml-1 text-xs text-muted-foreground">human only</span> : null}</div>)}</div></section>

      <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Applicable {data.descriptor.terminology.section}s</h2><p className="mt-1 text-sm text-muted-foreground">Conditional requirements stay visible with their trigger. The planner decides applicability.</p><div className="mt-4 space-y-4">{data.nodes.filter((node) => node.node_kind === "section").map((node) => { const requirement = data.descriptor.requirements.find((item) => item.key === node.requirement_key); const applicable = Boolean(node.requirement_key && (requirement?.applicability !== "conditional" || data.activeVersion.applicable_requirement_keys.includes(node.requirement_key))); return <div key={node.id} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 id={`section-title-${node.id}`} className="font-semibold">{node.title}</h3>{requirement?.applicability === "conditional" && node.requirement_key ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={applicable} disabled={!working || busy || !data.canWrite} onChange={(event) => void run(() => setRequirementApplicability(node.requirement_key!, event.target.checked))}/>Applicable to this version</label> : <span className="text-xs text-muted-foreground">{requirement?.applicability.replaceAll("_", " ")}</span>}</div>{requirement?.condition ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{requirement.condition}</p> : null}<Textarea aria-labelledby={`section-title-${node.id}`} className="mt-3 min-h-36" value={sectionDrafts[node.id] ?? ""} onChange={(event) => setSectionDrafts((current) => ({ ...current, [node.id]: event.target.value }))} disabled={!working || !data.canWrite || !applicable} placeholder="Author the plan text, with evidence links and policy details."/><div className="mt-3 grid gap-2 md:grid-cols-2"><label className="block text-sm">Evidence document<select className="module-select mt-1" value={sectionEvidenceDocuments[node.id] ?? ""} disabled={!working || !data.canWrite || !applicable} onChange={(event) => setSectionEvidenceDocuments((current) => ({ ...current, [node.id]: event.target.value }))}><option value="">No evidence document</option>{data.documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select></label><label className="block text-sm">Official evidence URL<Input className="mt-1" value={sectionEvidenceUrls[node.id] ?? ""} disabled={!working || !data.canWrite || !applicable} onChange={(event) => setSectionEvidenceUrls((current) => ({ ...current, [node.id]: event.target.value }))} placeholder="https://"/></label></div><Button className="mt-2" size="sm" disabled={!working || busy || !data.canWrite || !applicable} onClick={() => void run(() => saveSection(node.id))}>Save section</Button></div>; })}</div>
        {data.nodes.some((node) => node.node_kind !== "section") ? <div className="mt-5 space-y-3"><h3 className="font-semibold">Plan content</h3>{data.nodes.filter((node) => node.node_kind !== "section").map((node) => <article key={node.id} className="rounded-lg border border-border p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edit content node · {node.node_kind.replaceAll("_", " ")}</p><label className="mt-3 block text-sm">Title<Input className="mt-1" value={contentDrafts[node.id]?.title ?? node.title} disabled={!working || busy || !data.canWrite} onChange={(event) => setContentDrafts((current) => ({ ...current, [node.id]: { title: event.target.value, body: current[node.id]?.body ?? node.body ?? "" } }))}/></label><label className="mt-3 block text-sm">Draft text<Textarea className="mt-1 min-h-28" value={contentDrafts[node.id]?.body ?? node.body ?? ""} disabled={!working || busy || !data.canWrite} onChange={(event) => setContentDrafts((current) => ({ ...current, [node.id]: { title: current[node.id]?.title ?? node.title, body: event.target.value } }))}/></label><Button className="mt-3" size="sm" disabled={!working || busy || !data.canWrite || !(contentDrafts[node.id]?.title ?? node.title).trim()} onClick={() => void run(() => saveContentNode(node.id))}>Save content node</Button></article>)}</div> : null}
        {working ? <form className="mt-5 grid gap-3 rounded-lg border border-dashed border-border p-4 md:grid-cols-2" onSubmit={(event) => void run(() => submitNode(event), event)}><h3 className="md:col-span-2 font-semibold">Add a goal, objective, policy, standard, program, or action node</h3><label className="block text-sm">Parent section<select className="module-select mt-1" name="parentNodeId" defaultValue=""><option value="">Top level</option>{data.nodes.filter((node) => node.node_kind === "section").map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label><label className="block text-sm">Node type<select className="module-select mt-1" name="nodeKind" defaultValue="policy">{["goal","objective","policy","standard","program","implementation_action"].map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select></label><label className="block text-sm">Node title<Input className="mt-1" name="title" required/></label><label className="block text-sm">Node text<Textarea className="mt-1" name="body"/></label><Button disabled={busy || !data.canWrite}>Add content node</Button></form> : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Mapped designations</h2>
          <p className="mt-1 text-sm text-muted-foreground">Future land-use designations express plan policy. They are not zoning and do not change parcel entitlements.</p>
          {data.designations.map((item) => <p key={item.id} className="mt-3 rounded-lg border p-3 text-sm"><strong>{item.designation_set_label}</strong><br/><span className="text-muted-foreground">Frozen GIS layer version {item.layer_version_id} · public fields {item.public_field_keys.join(", ") || "shapes only"}</span></p>)}
          {working ? <form className="mt-4 space-y-3" onSubmit={(event) => void run(() => submitDesignation(event), event)}>
            <label className="block text-sm">Agency GIS layer<select className="module-select mt-1 w-full" name="layerId" required value={designationLayerId} onChange={(event) => setDesignationLayerId(event.target.value)}><option value="">Choose an agency GIS layer</option>{data.layers.filter((layer) => layer.current_version_id).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label>
            <label className="block text-sm">Designation set label<Input className="mt-1" name="label" required/></label>
            <label className="block text-sm">Public map fields<select className="module-select mt-1 min-h-24 w-full" name="publicFieldKeys" multiple>{selectedLayerFields.map((field) => <option key={field} value={field}>{field}</option>)}</select><span className="mt-1 block text-xs text-muted-foreground">Only selected fields can be made public. Select none to show shapes only.</span></label>
            <label className="block text-sm">Legend field<select className="module-select mt-1 w-full" name="legendField" defaultValue=""><option value="">No feature labels</option>{selectedLayerFields.map((field) => <option key={field} value={field}>{field}</option>)}</select></label>
            <label className="block text-sm">Linked policies<select className="module-select mt-1 min-h-28 w-full" name="policyNodeIds" multiple>{data.nodes.filter((node) => node.node_kind === "policy").map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
            <Button disabled={busy || !selectedLayerVersion?.feature_hash}>Attach exact finalized layer version</Button>
            <p className="text-xs text-muted-foreground">Need a layer? <Link className="underline" href="/data-hub">Open Data Hub</Link>.</p>
          </form> : null}
        </div>
        <div className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Implementation program</h2>{data.actions.map((item) => <div key={item.id} className="mt-3 rounded-lg border p-3 text-sm"><p className="font-semibold">{item.title}</p><p className="text-muted-foreground">{item.responsible_party || "No responsible party recorded"} · {item.due_on || "No due date"}</p><label className="mt-2 block text-sm">Status<span className="sr-only"> of {item.title}</span><select className="module-select mt-1" value={item.status} disabled={busy || !data.canWrite} onChange={(event) => void run(() => postJson(`/api/land-use-plans/${planId}/implementation`, { operation: "update_status", actionId: item.id, status: event.target.value }))}>{["not_started","in_progress","completed","deferred"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label></div>)}{working ? <form className="mt-4 space-y-3" onSubmit={(event) => void run(() => submitImplementation(event), event)}><label className="block text-sm">Implementation action<Input className="mt-1" name="title" required/></label><label className="block text-sm">Responsible party<Input className="mt-1" name="responsibleParty"/></label><label className="block text-sm">Due date<Input className="mt-1" name="dueOn" type="date"/></label><label className="block text-sm">Linked project<select className="module-select mt-1 w-full" name="projectId" defaultValue=""><option value="">No linked project</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-sm">Linked program<select className="module-select mt-1 w-full" name="programId" defaultValue=""><option value="">No linked program</option>{data.programs.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><Button disabled={busy || !data.canWrite}>Add implementation action</Button></form> : null}</div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Related plans</h2><p className="mt-1 text-sm text-muted-foreground">Record parent, subordinate, overlapping, superseding, and implementation relationships without forcing another plan type into this plan&apos;s legal model.</p><div className="mt-3 grid gap-2 md:grid-cols-2">{data.relationships.map((item) => <p key={item.id} className="rounded-lg border p-3 text-sm"><strong>{item.related_plan_label}</strong> · {item.relationship_kind}{item.notes ? <><br/><span className="text-muted-foreground">{item.notes}</span></> : null}</p>)}</div>{working ? <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => void run(() => submitRelationship(event), event)}><label className="block text-sm">Related plan label<Input className="mt-1" name="label" required/></label><label className="block text-sm">Relationship<select className="module-select mt-1" name="kind" defaultValue="implements">{["parent","child","overlapping","supersedes","implements"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label><label className="block text-sm md:col-span-2">Relationship and consistency notes<Textarea className="mt-1" name="notes"/></label><Button disabled={busy || !data.canWrite}>Add relationship</Button></form> : null}</section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Required process steps</h2>
        <p className="mt-1 text-sm text-muted-foreground">OpenPlan saves the dates you enter. It does not calculate a legal deadline from incomplete facts.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">{data.descriptor.processSteps.map((step) => { const record = data.processRecords.find((item) => item.process_key === step.key); return <div key={step.key} className="rounded-lg border p-3 text-sm"><strong>{step.label}</strong> · {record?.status.replaceAll("_", " ") ?? "no status"}{record?.due_on ? <><br/>Due {record.due_on}</> : null}{!step.required ? <span className="ml-2 text-xs text-muted-foreground">optional</span> : null}</div>; })}</div>
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => void run(() => submitProcess(event), event)}>
          <label className="block text-sm">Process step<select className="module-select mt-1" name="processKey" required defaultValue=""><option value="">Choose descriptor step</option>{data.descriptor.processSteps.map((step) => <option key={step.key} value={step.key}>{step.label}</option>)}</select></label>
          <label className="block text-sm">Status<select className="module-select mt-1" name="status" defaultValue="not_started">{["not_started","in_progress","complete","not_applicable"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
          <label className="text-sm">Actual due date<Input name="dueOn" type="date"/></label><label className="text-sm">Actual completion date<Input name="completedOn" type="date"/></label>
          <label className="block text-sm md:col-span-2">Evidence document<select className="module-select mt-1" name="documentId" defaultValue=""><option value="">No evidence document</option>{data.documents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label className="block text-sm md:col-span-2">Process note<Textarea className="mt-1" name="notes"/></label><Button className="md:col-span-2" disabled={busy || !data.canWrite}>Save process step</Button>
        </form>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Private tribal consultation</h2><p className="mt-1 text-sm text-muted-foreground">Status and evidence remain signed-in only. Confidential material and sensitive locations never enter the published plan.</p><form className="mt-4 space-y-3" onSubmit={(event) => void run(() => submitConsultation(event), event)}><label className="block text-sm">Consultation status<select className="module-select mt-1 w-full" name="status" defaultValue={consultation?.status ?? "not_started"}>{["not_started","initiated","in_progress","complete","not_applicable"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label><label className="block text-sm">Evidence document<select className="module-select mt-1 w-full" name="documentId" defaultValue=""><option value="">No evidence document selected</option>{data.documents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="block text-sm">Confidential consultation notes<Textarea className="mt-1" name="notes" defaultValue={consultation?.confidential_notes ?? ""}/></label><label className="flex gap-2 text-sm"><input type="checkbox" name="sensitive" defaultChecked={consultation?.contains_sensitive_locations ?? false}/>Contains sensitive-location information</label><Button disabled={busy || !data.canWrite}>Save private information</Button></form></div>
        <div className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Review history</h2>{data.reviews.map((event) => <p key={event.id} className="mt-2 rounded-lg border p-3 text-sm"><strong>{event.event_kind.replaceAll("_", " ")}</strong> · {event.occurred_on || "date unavailable"}{event.decision_body ? <><br/>{event.decision_body}</> : null}</p>)}<form className="mt-4 space-y-3" onSubmit={(event) => void run(() => submitReview(event), event)}><label className="block text-sm">Review event type<select className="module-select mt-1 w-full" name="eventKind" defaultValue="internal_consistency">{["internal_consistency","environmental_review","hearing","recommendation","comment_response"].map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select></label><label className="block text-sm">Event date<Input className="mt-1" name="occurredOn" type="date"/></label><label className="block text-sm">Reviewing or hearing body<Input className="mt-1" name="decisionBody"/></label><label className="block text-sm">Linked public engagement<select className="module-select mt-1 w-full" name="campaignId" defaultValue=""><option value="">No linked public engagement</option>{data.campaigns.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="block text-sm">Evidence document<select className="module-select mt-1 w-full" name="documentId" defaultValue=""><option value="">No evidence document</option>{data.documents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label className="block text-sm">Review notes<Textarea className="mt-1" name="notes" placeholder="What was reviewed, heard, recommended, or resolved"/></label><Button disabled={busy || !data.canWrite}>Save review event</Button><p className="text-xs text-muted-foreground">Public comments and responses stay in <Link className="underline" href="/engagement">Engagement</Link>; link that public engagement here.</p></form></div>
      </section>

      {data.activeVersion.state === "public_review" ? <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Public review releases</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each release keeps this exact plan hash. Closed rounds remain public; withdrawal hides a mistaken release without deleting its audit row.</p>
        {currentVersionReleases.map((release) => {
          const linkedCampaign = data.campaigns.find((campaign) => campaign.id === release.engagement_campaign_id);
          const linkedCampaignNeedsClosure = release.review_method === "engagement_campaign" && linkedCampaign?.status !== "closed";
          return (
            <article key={release.id} className="mt-4 rounded-lg border p-4 text-sm">
              <p><strong>Round {release.round_number}</strong> · {release.status} · {release.review_open_on} through {release.review_close_on}</p>
              {release.status !== "withdrawn"
                ? <a className="mt-2 inline-block underline" href={`/review/land-use-plans/${release.share_token}`}>Open public review</a>
                : <p className="mt-2 text-muted-foreground">Withdrawn: {release.withdrawal_reason}</p>}
              {release.status === "open" ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {release.review_method === "external_process" ? (
                    <label className="block text-sm">Disposition summary for external review<Textarea className="mt-1" id={`disposition-${release.id}`}/></label>
                  ) : (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
                      <p>Close the linked public review and finish reviewing its comments before freezing this review outcome.</p>
                      <p className="mt-1">Campaign status: {linkedCampaign?.status ?? "unavailable"}.</p>
                      {release.engagement_campaign_id ? (
                        <div className="mt-2 flex flex-wrap gap-3">
                          <Link className="font-medium underline" href={`/engagement/${release.engagement_campaign_id}?tab=responses`}>
                            Review pending comments
                          </Link>
                          <Link className="font-medium underline" href={`/engagement/${release.engagement_campaign_id}?tab=setup`}>
                            Open linked public review
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  )}
                  <Button
                    disabled={busy || !data.canWrite || linkedCampaignNeedsClosure}
                    onClick={() => {
                      const value = release.review_method === "external_process"
                        ? (document.getElementById(`disposition-${release.id}`) as HTMLTextAreaElement | null)?.value || null
                        : null;
                      void run(() => postJson(`/api/land-use-plans/${planId}/review-releases`, {
                        operation: "close",
                        releaseId: release.id,
                        dispositionSummary: value,
                      }));
                    }}
                  >
                    Close and freeze outcome
                  </Button>
                  {actionError ? (
                    <div className="md:col-span-2 rounded-lg border border-destructive p-3 text-destructive" data-testid="review-close-error">
                      {actionError}
                    </div>
                  ) : null}
                  <label className="block text-sm">Reason for withdrawal<Input className="mt-1" id={`withdraw-${release.id}`}/></label>
                  <Button
                    variant="outline"
                    disabled={busy || !data.canWrite}
                    onClick={() => {
                      const reason = (document.getElementById(`withdraw-${release.id}`) as HTMLInputElement | null)?.value ?? "";
                      void run(() => postJson(`/api/land-use-plans/${planId}/review-releases`, {
                        operation: "withdraw",
                        releaseId: release.id,
                        reason,
                      }));
                    }}
                  >
                    Withdraw mistaken release
                  </Button>
                </div>
              ) : null}
            </article>
          );
        })}
        {currentVersionReleases.length === 0 ? <div className="mt-4 grid gap-6 lg:grid-cols-2"><form className="space-y-3 rounded-lg border p-4" onSubmit={(event) => void run(() => submitReviewRelease(event, "engagement_campaign"), event)}><h3 className="font-semibold">Release with Engagement</h3><label className="block text-sm">Review opens<Input className="mt-1" name="reviewOpenOn" required type="date"/></label><label className="block text-sm">Review closes<Input className="mt-1" name="reviewCloseOn" required type="date"/></label><label className="block text-sm">Public engagement<select className="module-select mt-1 w-full" name="campaignId" required defaultValue=""><option value="">Active public engagement</option>{data.campaigns.filter((campaign) => campaign.status === "active").map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}</select></label><Button disabled={busy || !data.canWrite}>Publish review release</Button></form><form className="space-y-3 rounded-lg border p-4" onSubmit={(event) => void run(() => submitReviewRelease(event, "external_process"), event)}><h3 className="font-semibold">Release with external review</h3><label className="block text-sm">Review opens<Input className="mt-1" name="reviewOpenOn" required type="date"/></label><label className="block text-sm">Review closes<Input className="mt-1" name="reviewCloseOn" required type="date"/></label><label className="block text-sm">External review document<select className="module-select mt-1 w-full" name="documentId" required defaultValue=""><option value="">Ready external-review document</option>{data.documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select></label><Button disabled={busy || !data.canWrite}>Publish review release</Button></form></div> : null}
      </section> : null}

      <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Freeze, adopt, and publish</h2>{working ? <div className="mt-4"><p className="text-sm text-muted-foreground">Freezing captures plan content, exact GIS versions, policy links, and the implementation program under one SHA-256 hash. It cannot be edited afterward.</p>{publicDraftBlockers.length > 0 ? <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100"><p className="font-semibold">Before freezing, complete:</p><ul className="mt-2 list-disc space-y-1 pl-5">{publicDraftBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div> : hasUnsavedContent ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Save edited context, sections and content nodes, and review recovery copies before freezing.</p> : <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">The public draft is ready to freeze.</p>}</div> : null}<LandUsePlanFreezeControl key={`${data.actorId}:${data.plan.workspace_id}:${planId}`} actorId={data.actorId} workspaceId={data.plan.workspace_id} planId={planId} versionId={data.activeVersion.id} versionNumber={data.activeVersion.version_number} draftRevision={data.activeVersion.draft_revision} descriptorHash={data.descriptorHash} working={working} canWrite={data.canWrite} disabled={busy || hasUnsavedContent || publicDraftBlockers.length > 0} onRefresh={async () => { await load(); router.refresh(); }} />{data.activeVersion.state === "public_review" ? <><form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => void run(() => submitAdoption(event), event)}><p className="md:col-span-2 break-all rounded-lg bg-muted p-3 text-xs">Reviewed content hash: {data.activeVersion.content_hash}</p>{adoptionBlockers.length > 0 ? <div className="md:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100"><p className="font-semibold">Before adoption, complete:</p><ul className="mt-2 list-disc space-y-1 pl-5">{adoptionBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div> : <p className="md:col-span-2 text-sm text-emerald-700 dark:text-emerald-300">The latest closed review and adoption prerequisites are on file.</p>}<label className="block text-sm">Decision body<Input className="mt-1" name="decisionBody" required/></label><label className="block text-sm">Instrument type<Input className="mt-1" name="instrumentType" required defaultValue={data.descriptor.terminology.adoptionInstrument}/></label><label className="block text-sm">Instrument identifier<Input className="mt-1" name="instrumentIdentifier" required/></label><label className="block text-sm">Vote<Input className="mt-1" name="vote"/></label><label className="block text-sm">Decision date<Input className="mt-1" name="decidedOn" required type="date"/></label><label className="block text-sm">Effective date<Input className="mt-1" name="effectiveOn" type="date"/></label><label className="block text-sm md:col-span-2">Supporting adoption document<select className="module-select mt-1" name="documentId" required defaultValue=""><option value="">Supporting adoption document</option>{data.documents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><Button className="md:col-span-2" disabled={busy || !data.canWrite || adoptionBlockers.length > 0}>Save adoption of latest closed review</Button></form><Button className="mt-3" variant="outline" disabled={busy || !data.canWrite || currentVersionReleases.some((release) => release.status === "open")} onClick={() => void run(() => postJson(`/api/land-use-plans/${planId}/versions`, { baseVersionId: data.activeVersion.id }))}>Revise reviewed plan</Button></> : null}{adopted ? <div className="mt-4 space-y-3"><p className="break-all rounded-lg bg-muted p-3 text-xs">Adopted content hash: {data.activeVersion.content_hash}</p>{data.activeVersion.published_report_id ? <div className="flex flex-wrap gap-4 text-sm font-medium"><a className="underline" href={`/published-plans/${planId}`}>Open published plan</a><Link className="underline" href={`/reports/${data.activeVersion.published_report_id}`}>Open adopted-plan report</Link></div> : <Button disabled={busy || !data.canWrite} onClick={() => void run(() => postJson(`/api/land-use-plans/${planId}/decisions`, { operation: "publish", versionId: data.activeVersion.id, versionContentHash: data.activeVersion.content_hash, title: `${displayPlan.title} adopted plan` }))}>Publish frozen plan</Button>}<Button variant="outline" disabled={busy || !data.canWrite || Boolean(data.plan.current_working_version_id)} onClick={() => void run(() => postJson(`/api/land-use-plans/${planId}/versions`, {}))}>Fork amendment working version</Button></div> : null}</section>

      {adopted ? <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">{data.descriptor.terminology.implementationReport}</h2><p className="mt-1 text-sm text-muted-foreground">The report freezes the current implementation statuses against the adopted plan hash. Use the descriptor duty below to set the actual due date.</p><form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => void run(() => submitAnnualReport(event), event)}><label className="block text-sm">Reporting period start<Input className="mt-1" name="start" required type="date"/></label><label className="block text-sm">Reporting period end<Input className="mt-1" name="end" required type="date"/></label><label className="block text-sm md:col-span-2">Annual implementation report title<Input className="mt-1" name="title" required/></label><label className="block text-sm md:col-span-2">Summary<Textarea className="mt-1" name="summary"/></label><Button className="md:col-span-2" disabled={busy || !data.canWrite}>Generate frozen implementation report</Button></form>{data.reports.map((report) => <p key={report.id} className="mt-3 rounded-lg border p-3 text-sm">{report.reporting_period_start} through {report.reporting_period_end}{report.report_id ? <> · <Link className="underline" href={`/reports/${report.report_id}`}>open readable report</Link></> : " · report link unavailable"}</p>)}</section> : null}

      <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Descriptor duties and sources</h2><div className="mt-3 space-y-2">{data.descriptor.processSteps.map((step) => <div key={step.key} className="rounded-lg border p-3 text-sm"><strong>{step.label}</strong>{step.deadline ? <span> · {step.deadline}</span> : null}{step.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="ml-2 underline">source</a>)}</div>)}</div></section>
    </div>
  );
}
