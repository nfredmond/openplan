"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildLandUsePlanWorkflow, percentComplete } from "@/lib/land-use-plans/workflow";

type WorkbenchData = {
  plan: { id: string; title: string; authority_label: string; geography_label: string; current_working_version_id: string | null; current_adopted_version_id: string | null };
  descriptor: {
    id: string; configured: boolean; disclosure: string; verifiedAt: string; reviewDueAt: string;
    terminology: { plan: string; section: string; adoptionInstrument: string; implementationReport: string };
    requirements: Array<{ key: string; label: string; applicability: string; condition?: string; sourceUrls: string[] }>;
    processSteps: Array<{ key: string; label: string; required: boolean; deadline?: string; sourceUrls: string[] }>;
    sourceUrls: string[];
  };
  canWrite: boolean;
  versions: Array<{ id: string; version_number: number; version_kind: string; state: string; applicable_requirement_keys: string[]; content_hash: string | null; frozen_at: string | null; published_report_id: string | null }>;
  activeVersion: { id: string; version_number: number; version_kind: string; state: string; applicable_requirement_keys: string[]; content_hash: string | null; frozen_at: string | null; published_report_id: string | null };
  nodes: Array<{ id: string; parent_node_id: string | null; node_kind: string; requirement_key: string | null; title: string; body: string | null; sort_order: number; evidence_document_id: string | null; evidence_url: string | null }>;
  relationships: Array<{ id: string; related_plan_label: string; relationship_kind: string; notes: string | null }>;
  designations: Array<{ id: string; layer_id: string; layer_version_id: string; designation_set_label: string; map_note: string }>;
  actions: Array<{ id: string; title: string; responsible_party: string | null; due_on: string | null; status: string; project_id: string | null; program_id: string | null }>;
  reviews: Array<{ id: string; event_kind: string; occurred_on: string | null; decision_body: string | null; notes: string | null }>;
  decisions: Array<{ id: string; version_id: string; instrument_type: string; instrument_identifier: string; decided_on: string; effective_on: string | null }>;
  reports: Array<{ id: string; reporting_period_start: string; reporting_period_end: string; report_id: string | null }>;
  consultations: Array<{ id: string; status: string; confidential_notes: string | null; contains_sensitive_locations: boolean }>;
  layers: Array<{ id: string; name: string; current_version_id: string | null }>;
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

export function LandUsePlanWorkbench({ planId }: { planId: string }) {
  const router = useRouter();
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, string>>({});
  const [sectionEvidenceDocuments, setSectionEvidenceDocuments] = useState<Record<string, string>>({});
  const [sectionEvidenceUrls, setSectionEvidenceUrls] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const response = await fetch(`/api/land-use-plans/${planId}`, { cache: "no-store" });
    const payload = await response.json() as WorkbenchData & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Failed to load plan");
    setData(payload);
    setSectionDrafts(Object.fromEntries(payload.nodes.filter((node) => node.node_kind === "section").map((node) => [node.id, node.body ?? ""])));
    setSectionEvidenceDocuments(Object.fromEntries(payload.nodes.filter((node) => node.node_kind === "section").map((node) => [node.id, node.evidence_document_id ?? ""])));
    setSectionEvidenceUrls(Object.fromEntries(payload.nodes.filter((node) => node.node_kind === "section").map((node) => [node.id, node.evidence_url ?? ""])));
  }, [planId]);

  useEffect(() => { void load().catch((error) => setLoadingError(error instanceof Error ? error.message : "Failed to load plan")); }, [load]);

  async function run(work: () => Promise<unknown>) {
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
      reviewEventKinds: data.reviews.map((event) => event.event_kind),
      versionState: data.activeVersion.state,
      hasAdoptionDecision: data.decisions.some((decision) => decision.version_id === data.activeVersion.id),
      hasPublishedReport: Boolean(data.activeVersion.published_report_id),
      hasImplementationReport: data.reports.length > 0,
    });
  }, [data]);

  if (loadingError) return <div className="rounded-lg border border-destructive p-4 text-destructive">{loadingError}. This is a read failure, not an empty plan.</div>;
  if (!data) return <p className="p-8 text-sm text-muted-foreground">Loading plan workbench…</p>;
  const workbenchData = data;
  const working = data.activeVersion.state === "working";
  const adopted = data.activeVersion.state === "adopted";
  const consultation = data.consultations[0];

  async function saveSection(nodeId: string) {
    await postJson(`/api/land-use-plans/${planId}/content`, { operation: "update", nodeId, body: sectionDrafts[nodeId] ?? "", evidenceDocumentId: sectionEvidenceDocuments[nodeId] || null, evidenceUrl: sectionEvidenceUrls[nodeId] || null });
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
    await postJson(`/api/land-use-plans/${planId}/designations`, { layerId, layerVersionId, designationSetLabel: String(form.get("label")), legendMetadata: { source: "workspace_gis_layer", layerName: layer.name }, policyNodeIds: form.getAll("policyNodeIds").map(String) });
    formElement.reset();
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

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{data.descriptor.terminology.plan} · version {data.activeVersion.version_number}</p><h1 className="mt-1 text-3xl font-bold">{data.plan.title}</h1><p className="mt-2 text-sm text-muted-foreground">{data.plan.authority_label} · {data.plan.geography_label}</p></div>
          <div className="rounded-lg bg-muted px-4 py-3 text-right"><p className="text-2xl font-bold">{percentComplete(workflow)}%</p><p className="text-xs text-muted-foreground">workflow complete</p></div>
        </div>
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">{data.descriptor.disclosure}</p>
        <p className="mt-2 text-xs text-muted-foreground">Sources reviewed {data.descriptor.verifiedAt}; review due {data.descriptor.reviewDueAt}. OpenPlan does not certify legal sufficiency.</p>
      </header>

      {actionError ? <div className="rounded-lg border border-destructive p-3 text-sm text-destructive">{actionError}</div> : null}
      <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Workflow</h2><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{workflow.map((step) => <div key={step.key} className={`rounded-lg border p-3 text-sm ${step.complete ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-border"}`}><span className="font-medium">{step.complete ? "Complete" : "Open"}</span> · {step.label}{step.humanOnly ? <span className="ml-1 text-xs text-muted-foreground">human only</span> : null}</div>)}</div></section>

      <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Applicable {data.descriptor.terminology.section}s</h2><p className="mt-1 text-sm text-muted-foreground">Conditional requirements stay visible with their trigger. The planner decides applicability.</p><div className="mt-4 space-y-4">{data.nodes.filter((node) => node.node_kind === "section").map((node) => { const requirement = data.descriptor.requirements.find((item) => item.key === node.requirement_key); const applicable = Boolean(node.requirement_key && data.activeVersion.applicable_requirement_keys.includes(node.requirement_key)); return <div key={node.id} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{node.title}</h3>{requirement?.applicability === "conditional" && node.requirement_key ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={applicable} disabled={!working || busy || !data.canWrite} onChange={(event) => void run(() => setRequirementApplicability(node.requirement_key!, event.target.checked))}/>Applicable to this version</label> : <span className="text-xs text-muted-foreground">{requirement?.applicability.replaceAll("_", " ")}</span>}</div>{requirement?.condition ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{requirement.condition}</p> : null}<Textarea className="mt-3 min-h-36" value={sectionDrafts[node.id] ?? ""} onChange={(event) => setSectionDrafts((current) => ({ ...current, [node.id]: event.target.value }))} disabled={!working || !data.canWrite || !applicable} placeholder="Author the plan text, with evidence links and policy details."/><div className="mt-3 grid gap-2 md:grid-cols-2"><select className="module-select" value={sectionEvidenceDocuments[node.id] ?? ""} disabled={!working || !data.canWrite || !applicable} onChange={(event) => setSectionEvidenceDocuments((current) => ({ ...current, [node.id]: event.target.value }))}><option value="">No evidence document</option>{data.documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select><Input value={sectionEvidenceUrls[node.id] ?? ""} disabled={!working || !data.canWrite || !applicable} onChange={(event) => setSectionEvidenceUrls((current) => ({ ...current, [node.id]: event.target.value }))} placeholder="Official evidence URL"/></div><Button className="mt-2" size="sm" disabled={!working || busy || !data.canWrite || !applicable} onClick={() => void run(() => saveSection(node.id))}>Save section</Button></div>; })}</div>
        {working ? <form className="mt-5 grid gap-3 rounded-lg border border-dashed border-border p-4 md:grid-cols-2" onSubmit={(event) => void run(() => submitNode(event))}><h3 className="md:col-span-2 font-semibold">Add a goal, objective, policy, standard, program, or action node</h3><select className="module-select" name="parentNodeId" defaultValue=""><option value="">Top level</option>{data.nodes.filter((node) => node.node_kind === "section").map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select><select className="module-select" name="nodeKind" defaultValue="policy">{["goal","objective","policy","standard","program","implementation_action"].map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select><Input name="title" required placeholder="Node title"/><Textarea name="body" placeholder="Draft text"/><Button disabled={busy}>Add content node</Button></form> : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Mapped designations</h2><p className="mt-1 text-sm text-muted-foreground">Future land-use designations express plan policy. They are not zoning and do not change parcel entitlements.</p>{data.designations.map((item) => <p key={item.id} className="mt-3 rounded-lg border p-3 text-sm"><strong>{item.designation_set_label}</strong><br/><span className="text-muted-foreground">Frozen GIS layer version {item.layer_version_id}</span></p>)}{working ? <form className="mt-4 space-y-3" onSubmit={(event) => void run(() => submitDesignation(event))}><select className="module-select w-full" name="layerId" required defaultValue=""><option value="">Choose an agency GIS layer</option>{data.layers.filter((layer) => layer.current_version_id).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select><Input name="label" required placeholder="Designation set label"/><label className="block text-sm">Linked policies<select className="module-select mt-1 min-h-28 w-full" name="policyNodeIds" multiple>{data.nodes.filter((node) => node.node_kind === "policy").map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label><Button disabled={busy}>Attach exact current layer version</Button><p className="text-xs text-muted-foreground">Need a layer? <Link className="underline" href="/data-hub">Open Data Hub</Link>.</p></form> : null}</div>
        <div className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Implementation program</h2>{data.actions.map((item) => <div key={item.id} className="mt-3 rounded-lg border p-3 text-sm"><p className="font-semibold">{item.title}</p><p className="text-muted-foreground">{item.responsible_party || "No responsible party recorded"} · {item.due_on || "No due date"}</p><select className="module-select mt-2" value={item.status} disabled={busy || !data.canWrite} onChange={(event) => void run(() => postJson(`/api/land-use-plans/${planId}/implementation`, { operation: "update_status", actionId: item.id, status: event.target.value }))}>{["not_started","in_progress","completed","deferred"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></div>)}{working ? <form className="mt-4 space-y-3" onSubmit={(event) => void run(() => submitImplementation(event))}><Input name="title" required placeholder="Implementation action"/><Input name="responsibleParty" placeholder="Responsible party"/><Input name="dueOn" type="date"/><select className="module-select w-full" name="projectId" defaultValue=""><option value="">No linked project</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className="module-select w-full" name="programId" defaultValue=""><option value="">No linked program</option>{data.programs.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><Button disabled={busy}>Add implementation action</Button></form> : null}</div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Related plans</h2><p className="mt-1 text-sm text-muted-foreground">Record parent, subordinate, overlapping, superseding, and implementation relationships without forcing another plan type into this plan&apos;s legal model.</p><div className="mt-3 grid gap-2 md:grid-cols-2">{data.relationships.map((item) => <p key={item.id} className="rounded-lg border p-3 text-sm"><strong>{item.related_plan_label}</strong> · {item.relationship_kind}{item.notes ? <><br/><span className="text-muted-foreground">{item.notes}</span></> : null}</p>)}</div>{working ? <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => void run(() => submitRelationship(event))}><Input name="label" required placeholder="Related plan label"/><select className="module-select" name="kind" defaultValue="implements">{["parent","child","overlapping","supersedes","implements"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select><Textarea className="md:col-span-2" name="notes" placeholder="Relationship and consistency notes"/><Button disabled={busy}>Add relationship</Button></form> : null}</section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Private tribal consultation</h2><p className="mt-1 text-sm text-muted-foreground">Status and evidence remain signed-in only. Confidential material and sensitive locations never enter the published plan.</p><form className="mt-4 space-y-3" onSubmit={(event) => void run(() => submitConsultation(event))}><select className="module-select w-full" name="status" defaultValue={consultation?.status ?? "not_started"}>{["not_started","initiated","in_progress","complete","not_applicable"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select><select className="module-select w-full" name="documentId" defaultValue=""><option value="">No evidence document selected</option>{data.documents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><Textarea name="notes" defaultValue={consultation?.confidential_notes ?? ""} placeholder="Confidential consultation notes"/><label className="flex gap-2 text-sm"><input type="checkbox" name="sensitive" defaultChecked={consultation?.contains_sensitive_locations ?? false}/>Contains sensitive-location information</label><Button disabled={busy || !data.canWrite}>Save private information</Button></form></div>
        <div className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Review history</h2>{data.reviews.map((event) => <p key={event.id} className="mt-2 rounded-lg border p-3 text-sm"><strong>{event.event_kind.replaceAll("_", " ")}</strong> · {event.occurred_on || "date unavailable"}{event.decision_body ? <><br/>{event.decision_body}</> : null}</p>)}<form className="mt-4 space-y-3" onSubmit={(event) => void run(() => submitReview(event))}><select className="module-select w-full" name="eventKind" defaultValue="internal_consistency">{["internal_consistency","environmental_review","hearing","recommendation","comment_response"].map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select><Input name="occurredOn" type="date"/><Input name="decisionBody" placeholder="Reviewing or hearing body"/><select className="module-select w-full" name="campaignId" defaultValue=""><option value="">No linked public engagement</option>{data.campaigns.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select className="module-select w-full" name="documentId" defaultValue=""><option value="">No evidence document</option>{data.documents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><Textarea name="notes" placeholder="What was reviewed, heard, recommended, or resolved"/><Button disabled={busy || !data.canWrite}>Save review event</Button><p className="text-xs text-muted-foreground">Public comments and responses stay in <Link className="underline" href="/engagement">Engagement</Link>; link that public engagement here.</p></form></div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Freeze, adopt, and publish</h2>{working ? <div className="mt-4"><p className="text-sm text-muted-foreground">Freezing captures plan content, exact GIS versions, policy links, and the implementation program under one SHA-256 hash. It cannot be edited afterward.</p><Button className="mt-3" disabled={busy || !data.canWrite} onClick={() => void run(() => postJson(`/api/land-use-plans/${planId}/freeze`, { state: "public_review" }))}>Freeze public draft</Button></div> : null}{data.activeVersion.state === "public_review" ? <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => void run(() => submitAdoption(event))}><p className="md:col-span-2 break-all rounded-lg bg-muted p-3 text-xs">Reviewed content hash: {data.activeVersion.content_hash}</p><Input name="decisionBody" required placeholder="Decision body"/><Input name="instrumentType" required defaultValue={data.descriptor.terminology.adoptionInstrument}/><Input name="instrumentIdentifier" required placeholder="Instrument identifier"/><Input name="vote" placeholder="Vote"/><Input name="decidedOn" required type="date"/><Input name="effectiveOn" type="date"/><select className="module-select md:col-span-2" name="documentId" required defaultValue=""><option value="">Supporting adoption document</option>{data.documents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><Button className="md:col-span-2" disabled={busy || !data.canWrite}>Save adoption of this exact hash</Button></form> : null}{adopted ? <div className="mt-4 space-y-3"><p className="break-all rounded-lg bg-muted p-3 text-xs">Adopted content hash: {data.activeVersion.content_hash}</p>{data.activeVersion.published_report_id ? <a className="text-sm font-medium underline" href={`/published-plans/${planId}`}>Open published plan</a> : <Button disabled={busy || !data.canWrite} onClick={() => void run(() => postJson(`/api/land-use-plans/${planId}/decisions`, { operation: "publish", versionId: data.activeVersion.id, versionContentHash: data.activeVersion.content_hash, title: `${data.plan.title} adopted plan` }))}>Publish frozen plan</Button>}<Button variant="outline" disabled={busy || !data.canWrite || Boolean(data.plan.current_working_version_id)} onClick={() => void run(() => postJson(`/api/land-use-plans/${planId}/versions`, {}))}>Fork amendment working version</Button></div> : null}</section>

      {adopted ? <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">{data.descriptor.terminology.implementationReport}</h2><p className="mt-1 text-sm text-muted-foreground">The report freezes the current implementation statuses against the adopted plan hash. California&apos;s scoped descriptor records an April 1 duty; verify every applicable reporting rule.</p><form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => void run(() => submitAnnualReport(event))}><Input name="start" required type="date"/><Input name="end" required type="date"/><Input className="md:col-span-2" name="title" required placeholder="Annual implementation report title"/><Textarea className="md:col-span-2" name="summary" placeholder="Summary"/><Button className="md:col-span-2" disabled={busy || !data.canWrite}>Generate frozen implementation report</Button></form>{data.reports.map((report) => <p key={report.id} className="mt-3 rounded-lg border p-3 text-sm">{report.reporting_period_start} through {report.reporting_period_end} · report {report.report_id}</p>)}</section> : null}

      <section className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Descriptor duties and sources</h2><div className="mt-3 space-y-2">{data.descriptor.processSteps.map((step) => <div key={step.key} className="rounded-lg border p-3 text-sm"><strong>{step.label}</strong>{step.deadline ? <span> · {step.deadline}</span> : null}{step.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="ml-2 underline">source</a>)}</div>)}</div></section>
    </div>
  );
}
