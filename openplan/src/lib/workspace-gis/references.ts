/**
 * "What breaks if I delete this?" — answered before the question is asked.
 *
 * A dialog that says "are you sure?" asks the planner a question only the
 * database can answer. This one lists what has adopted the layer, by name, with
 * a link to each, and offers the alternative that keeps those things resolving:
 * archive it. The refusal itself is structural (the foreign key in
 * 20260812000018 takes no destructive action), so these sentences explain a
 * refusal that would happen with or without them.
 *
 * PURE — no I/O.
 */

import type {
  WorkspaceGisLayerReference,
  WorkspaceGisReferenceKind,
} from "./types";

const KIND_NOUNS: Record<WorkspaceGisReferenceKind, { singular: string; plural: string }> = {
  engagement_campaign: { singular: "engagement campaign", plural: "engagement campaigns" },
  report: { singular: "report", plural: "reports" },
  project: { singular: "project", plural: "projects" },
};

/**
 * The sentence shown when a layer cannot be deleted.
 *
 * It NAMES the adopters rather than counting them. "Used by 3 things" tells a
 * planner they are blocked; "used by the Downtown Circulation Study public map"
 * tells them what to go and change. Long lists are summarised at the tail so
 * the sentence stays readable, but the first names are always there.
 */
export function describeDeletionRefusal(
  layerName: string,
  references: readonly WorkspaceGisLayerReference[]
): string {
  const named = references.slice(0, 3).map((reference) => {
    const noun = KIND_NOUNS[reference.kind]?.singular ?? "record";
    return `${reference.label} (${noun})`;
  });
  const remainder = references.length - named.length;
  const list =
    remainder > 0
      ? `${named.join(", ")}, and ${remainder.toLocaleString()} more`
      : named.join(", ");

  return (
    `"${layerName}" cannot be deleted: ${list} ${references.length === 1 ? "uses" : "use"} it. Deleting it would leave ` +
    `${references.length === 1 ? "that record" : "those records"} pointing at a layer that no longer exists. Archive it ` +
    `instead — it stops appearing on maps and in the layer list, and everything that cites it keeps resolving.`
  );
}

/** The one-line note on a layer that is archived rather than deleted. */
export function describeArchivedLayer(archivedAt: string): string {
  const date = archivedAt.slice(0, 10);
  return `Archived on ${date}. It is not drawn on any map and does not appear in the layer list, but anything that cites it still resolves.`;
}
