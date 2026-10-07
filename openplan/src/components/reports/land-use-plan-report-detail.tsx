"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { PublicDesignationMap } from "@/components/land-use-plans/public-designation-map";

type Report = { id: string; title: string; report_type: string; summary: string | null; generated_at: string | null };
type Plan = { id: string; title: string; authority_label: string; geography_label: string };
type Artifact = { id: string; generated_at: string; metadata_json: Record<string, unknown> | null };
type FrozenNode = Record<string, unknown> & { id?: string; parent_node_id?: string | null };

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function text(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function FrozenContentBranch({ node, nodes, depth = 0, ancestors = new Set<string>() }: { node: FrozenNode; nodes: FrozenNode[]; depth?: number; ancestors?: Set<string> }) {
  const id = node.id ?? "";
  if (depth > 8 || (id && ancestors.has(id))) return null;
  const nextAncestors = new Set(ancestors);
  if (id) nextAncestors.add(id);
  const children = id ? nodes.filter((candidate) => candidate.parent_node_id === id) : [];
  const Heading = depth === 0 ? "h3" : depth === 1 ? "h4" : "h5";
  return <article className={depth ? "ml-4 mt-5 border-l pl-4" : "mt-6"}><Heading className={depth === 0 ? "text-xl font-semibold" : "text-lg font-semibold"}>{text(node, "title") ?? "Untitled plan content"}</Heading>{text(node, "body") ? <p className="mt-2 whitespace-pre-wrap leading-relaxed">{text(node, "body")}</p> : null}{children.map((child, index) => <FrozenContentBranch key={child.id ?? index} node={child} nodes={nodes} depth={depth + 1} ancestors={nextAncestors}/>)}</article>;
}

export function LandUsePlanReportDetail({ report, plan, artifact, retainedContext, retainedAdoption }: { report: Report; plan: Plan; artifact: Artifact; retainedContext?: ReactNode; retainedAdoption?: ReactNode }) {
  const metadata = artifact.metadata_json ?? {};
  const implementation = metadata.kind === "land_use_plan_implementation_report";
  const frozen = metadata.frozenSnapshot && typeof metadata.frozenSnapshot === "object" ? metadata.frozenSnapshot as Record<string, unknown> : null;
  const snapshot = metadata.snapshot && typeof metadata.snapshot === "object" ? metadata.snapshot as Record<string, unknown> : null;
  const nodes = records(frozen?.nodes) as FrozenNode[];
  const actions = implementation ? records(snapshot?.actions) : records(frozen?.implementationActions);
  const topLevelNodes = nodes.filter((node) => !node.parent_node_id);
  const relationships = records(frozen?.relationships);
  const designations = records(frozen?.designations);

  return <div className="mx-auto min-w-0 w-full max-w-4xl [overflow-wrap:anywhere] p-5 md:p-10 print:max-w-none print:p-0">
    <header className="border-b pb-7"><p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{implementation ? "Implementation report" : "Adopted plan report"}</p><h1 className="mt-2 text-4xl font-semibold">{report.title}</h1><p className="mt-3 text-lg">{plan.title}</p><p className="mt-1 text-muted-foreground">{plan.authority_label} · {plan.geography_label}</p><p className="mt-4">{report.summary}</p><div className="mt-5 flex flex-wrap gap-3 print:hidden"><Button onClick={() => window.print()}>Print report</Button><Button asChild variant="outline"><a href={`/api/reports/${report.id}/provenance`} download={`openplan-report-${report.id}-provenance.json`}>Download source JSON</a></Button><Button asChild variant="outline"><Link href={`/land-use-plans/${plan.id}`}>Open plan workbench</Link></Button></div></header>
    {retainedContext ? <div className="mt-8">{retainedContext}</div> : null}
    {retainedAdoption}
    {implementation ? <section className="mt-8"><h2 className="text-2xl font-semibold">Reporting period</h2><p className="mt-2">{text(snapshot ?? {}, "reportingPeriodStart") ?? "Start unavailable"} through {text(snapshot ?? {}, "reportingPeriodEnd") ?? "end unavailable"}</p><p className="mt-2 break-all text-xs text-muted-foreground">Adopted plan hash: {text(snapshot ?? {}, "adoptedVersionContentHash") ?? "unavailable"}</p></section> : <section className="mt-8"><h2 className="text-2xl font-semibold">Frozen plan content</h2><p className="mt-2 break-all text-xs text-muted-foreground">Plan content hash: {text(metadata, "contentHash") ?? "unavailable"}</p>{topLevelNodes.map((node, index) => <FrozenContentBranch key={node.id ?? index} node={node} nodes={nodes}/>)}</section>}
    <section className="mt-9 border-t pt-7"><h2 className="text-2xl font-semibold">{implementation ? "Frozen action-status snapshot" : "Implementation program"}</h2>{actions.length ? actions.map((action, index) => <article className="mt-4 rounded-lg border p-4" key={text(action, "id") ?? index}><h3 className="font-semibold">{text(action, "title") ?? "Untitled action"}</h3><p className="mt-1 text-sm">Status: {(text(action, "status") ?? "no status").replaceAll("_", " ")}{text(action, "due_on") ? ` · due ${text(action, "due_on")}` : ""}</p>{text(action, "description") ? <p className="mt-2">{text(action, "description")}</p> : null}{implementation ? <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Responsible party at reporting</dt><dd>{text(action, "responsible_party") ?? "Not specified"}</dd></div>
      <div><dt className="text-muted-foreground">Last action update retained</dt><dd>{text(action, "updated_at") ?? "Unavailable"}</dd></div>
    </dl> : null}</article>) : <p className="mt-3">No implementation actions were present in this frozen report.</p>}</section>
    {!implementation ? <section aria-labelledby="report-maps-heading" className="mt-9 border-t pt-7">
      <h2 id="report-maps-heading" className="text-2xl font-semibold">Mapped designations retained with this version</h2>
      {designations.length ? designations.map((designation, index) => {
        const evidence = designation.layer_version_evidence && typeof designation.layer_version_evidence === "object"
          ? designation.layer_version_evidence as Record<string, unknown> : {};
        const id = text(designation, "id");
        const label = text(designation, "designation_set_label") ?? "Designation layer";
        return <article className="mt-4 rounded-lg border p-4" key={id ?? index}>
          <h3 className="font-semibold">{label}</h3>
          {text(designation, "map_note") ? <p className="mt-2 whitespace-pre-wrap">{text(designation, "map_note")}</p> : null}
          <p className="mt-2 break-all text-xs text-muted-foreground">Frozen GIS feature hash: {text(evidence, "feature_hash") ?? "Not retained"}</p>
          {id ? <PublicDesignationMap endpoint={`/api/reports/${report.id}/land-use-map/${id}`} bbox={evidence.bbox} label={label} />
            : <p className="mt-3" role="alert">This designation has no retained map identifier. Its map cannot be loaded.</p>}
        </article>;
      }) : <p className="mt-3">No mapped designations were retained with this version.</p>}
    </section> : null}
    {!implementation ? <section aria-labelledby="report-relationships-heading" className="mt-9 border-t pt-7">
      <h2 id="report-relationships-heading" className="text-2xl font-semibold">Related plans retained with this version</h2>
      {relationships.length ? <ul className="mt-4 space-y-4">{relationships.map((relationship, index) => <li className="rounded-lg border p-4" key={text(relationship, "id") ?? index}>
        <h3 className="font-semibold">{text(relationship, "related_plan_label") ?? "Related plan label not recorded"}</h3>
        <p className="mt-1 text-sm">Relationship saved as: {(text(relationship, "relationship_kind") ?? "not recorded").replaceAll("_", " ")}</p>
        {text(relationship, "notes") ? <p className="mt-2 whitespace-pre-wrap">{text(relationship, "notes")}</p> : null}
      </li>)}</ul> : <p className="mt-3">No related-plan references were retained with this version.</p>}
    </section> : null}
    <footer className="mt-10 border-t pt-5 text-xs text-muted-foreground"><p>Generated {artifact.generated_at}. Consultation details, confidential notes, and sensitive-location flags are not part of this report.</p><p className="mt-2 break-all">Report ID {report.id}</p></footer>
  </div>;
}
