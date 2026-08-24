import { notFound } from "next/navigation";

import { PublicDesignationMap } from "@/components/land-use-plans/public-designation-map";
import { loadPublicLandUsePlanReviewPacket } from "@/lib/land-use-plans/public";

export const metadata = {
  title: "Land use plan public review",
  description: "An exact frozen land use plan draft released for public review.",
};

type FrozenNode = { id?: string; parent_node_id?: string | null; node_kind?: string; requirement_key?: string | null; title?: string; body?: string | null };
type FrozenDesignation = { id?: string; designation_set_label?: string; map_note?: string; layer_version_evidence?: { bbox?: unknown; feature_hash?: string } | null };

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function ContentBranch({ node, nodes, depth = 0, ancestors = new Set<string>() }: { node: FrozenNode; nodes: FrozenNode[]; depth?: number; ancestors?: Set<string> }) {
  const id = node.id ?? "";
  if (depth > 8 || (id && ancestors.has(id))) return null;
  const nextAncestors = new Set(ancestors);
  if (id) nextAncestors.add(id);
  const children = id ? nodes.filter((candidate) => candidate.parent_node_id === id) : [];
  const Heading = depth === 0 ? "h3" : depth === 1 ? "h4" : "h5";
  return <article className={depth ? "ml-4 mt-5 border-l pl-4" : ""}><Heading className={depth === 0 ? "text-2xl font-semibold" : "text-xl font-semibold"}>{node.title ?? "Untitled plan content"}</Heading>{node.body ? <p className="mt-3 whitespace-pre-wrap text-[1.0625rem] leading-relaxed">{node.body}</p> : null}{children.map((child, index) => <ContentBranch key={child.id ?? index} node={child} nodes={nodes} depth={depth + 1} ancestors={nextAncestors}/>)}</article>;
}

export default async function LandUsePlanReviewPage({ params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = await params;
  const result = await loadPublicLandUsePlanReviewPacket(shareToken);
  if (!result.ok && result.reason === "not_found") notFound();
  if (!result.ok) return <main className="mx-auto max-w-3xl px-5 py-12"><h1 className="text-3xl font-semibold">This review release could not be verified</h1><p className="mt-4">OpenPlan withheld the draft because its stored version and release hash did not agree.</p></main>;
  const { packet } = result;
  const nodes = records(packet.content.nodes) as FrozenNode[];
  const designations = records(packet.content.designations) as FrozenDesignation[];
  const version = packet.content.version && typeof packet.content.version === "object" ? packet.content.version as Record<string, unknown> : {};
  const applicableKeys = Array.isArray(version.applicableRequirementKeys)
    ? new Set(version.applicableRequirementKeys.filter((key): key is string => typeof key === "string"))
    : null;
  const sections = nodes.filter((node) => node.node_kind === "section" && (applicableKeys ? Boolean(node.requirement_key && applicableKeys.has(node.requirement_key)) : Boolean(node.body)));

  return <main className="mx-auto max-w-4xl px-5 py-12 print:max-w-none">
    <header className="border-b pb-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Public review round {packet.release.roundNumber} · {packet.release.status}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">{packet.plan.title}</h1>
      <p className="mt-3 text-lg text-muted-foreground">{packet.plan.authorityLabel} · {packet.plan.geographyLabel}</p>
      <p className="mt-4">Review period: {packet.release.reviewOpenOn} through {packet.release.reviewCloseOn}. Method: {packet.release.reviewMethod.replaceAll("_", " ")}.</p>
      <p className="mt-4 break-all rounded-lg bg-muted p-3 font-mono text-xs">Reviewed content hash: {packet.version.contentHash}</p>
      <a className="mt-4 inline-block text-sm font-medium underline" href={`/api/public/land-use-plan-reviews/${shareToken}`}>Download this exact reviewed plan</a>
    </header>
    <section className="mt-8 space-y-8"><h2 className="text-3xl font-semibold">Draft plan content</h2>{sections.map((section, index) => <ContentBranch key={section.id ?? index} node={section} nodes={nodes}/>)}</section>
    <section className="mt-10 border-t pt-8"><h2 className="text-3xl font-semibold">Mapped designations</h2>{designations.map((designation, index) => <article className="mt-5 rounded-lg border p-4" key={designation.id ?? index}><h3 className="text-xl font-semibold">{designation.designation_set_label ?? "Mapped designations"}</h3><p className="mt-1 break-all text-xs text-muted-foreground">Frozen GIS feature hash: {designation.layer_version_evidence?.feature_hash ?? "unavailable"}</p>{designation.id ? <PublicDesignationMap endpoint={`/api/public/land-use-plan-reviews/${shareToken}/map/${designation.id}`} bbox={designation.layer_version_evidence?.bbox} label={designation.designation_set_label ?? "Mapped designations"}/> : null}{designation.map_note ? <p className="mt-3">{designation.map_note}</p> : null}</article>)}</section>
    <aside className="mt-10 rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100"><p>{packet.descriptor?.disclosure ?? "Local legal requirements were not configured for this plan."}</p><p className="mt-3 text-sm">{packet.privacy}</p>{packet.release.status === "closed" ? <p className="mt-3 text-sm">This closed release remains available to the public. Outcome hash: {packet.release.outcomeHash}</p> : null}</aside>
  </main>;
}
