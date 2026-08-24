"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

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

export function LandUsePlanReportDetail({ report, plan, artifact }: { report: Report; plan: Plan; artifact: Artifact }) {
  const metadata = artifact.metadata_json ?? {};
  const implementation = metadata.kind === "land_use_plan_implementation_report";
  const frozen = metadata.frozenSnapshot && typeof metadata.frozenSnapshot === "object" ? metadata.frozenSnapshot as Record<string, unknown> : null;
  const snapshot = metadata.snapshot && typeof metadata.snapshot === "object" ? metadata.snapshot as Record<string, unknown> : null;
  const nodes = records(frozen?.nodes) as FrozenNode[];
  const actions = implementation ? records(snapshot?.actions) : records(frozen?.implementationActions);
  const topLevelNodes = nodes.filter((node) => !node.parent_node_id);

  return <main className="mx-auto w-full max-w-4xl p-5 md:p-10 print:max-w-none print:p-0">
    <header className="border-b pb-7"><p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{implementation ? "Implementation report" : "Adopted plan report"}</p><h1 className="mt-2 text-4xl font-semibold">{report.title}</h1><p className="mt-3 text-lg">{plan.title}</p><p className="mt-1 text-muted-foreground">{plan.authority_label} · {plan.geography_label}</p><p className="mt-4">{report.summary}</p><div className="mt-5 flex flex-wrap gap-3 print:hidden"><Button onClick={() => window.print()}>Print report</Button><Button asChild variant="outline"><a href={`/api/reports/${report.id}/provenance`}>Download source JSON</a></Button><Button asChild variant="outline"><Link href={`/land-use-plans/${plan.id}`}>Open plan workbench</Link></Button></div></header>
    {implementation ? <section className="mt-8"><h2 className="text-2xl font-semibold">Reporting period</h2><p className="mt-2">{text(snapshot ?? {}, "reportingPeriodStart") ?? "Start unavailable"} through {text(snapshot ?? {}, "reportingPeriodEnd") ?? "end unavailable"}</p><p className="mt-2 break-all text-xs text-muted-foreground">Adopted plan hash: {text(snapshot ?? {}, "adoptedVersionContentHash") ?? "unavailable"}</p></section> : <section className="mt-8"><h2 className="text-2xl font-semibold">Frozen plan content</h2><p className="mt-2 break-all text-xs text-muted-foreground">Plan content hash: {text(metadata, "contentHash") ?? "unavailable"}</p>{topLevelNodes.map((node, index) => <FrozenContentBranch key={node.id ?? index} node={node} nodes={nodes}/>)}</section>}
    <section className="mt-9 border-t pt-7"><h2 className="text-2xl font-semibold">{implementation ? "Frozen action-status snapshot" : "Implementation program"}</h2>{actions.length ? actions.map((action, index) => <article className="mt-4 rounded-lg border p-4" key={text(action, "id") ?? index}><h3 className="font-semibold">{text(action, "title") ?? "Untitled action"}</h3><p className="mt-1 text-sm">Status: {(text(action, "status") ?? "no status").replaceAll("_", " ")}{text(action, "due_on") ? ` · due ${text(action, "due_on")}` : ""}</p>{text(action, "description") ? <p className="mt-2">{text(action, "description")}</p> : null}</article>) : <p className="mt-3">No implementation actions were present in this frozen report.</p>}</section>
    <footer className="mt-10 border-t pt-5 text-xs text-muted-foreground"><p>Generated {artifact.generated_at}. Consultation details, confidential notes, and sensitive-location flags are not part of this report.</p><p className="mt-2 break-all">Report ID {report.id}</p></footer>
  </main>;
}
