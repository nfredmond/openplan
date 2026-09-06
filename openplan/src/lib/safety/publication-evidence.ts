type Provenance = Record<string, unknown>;

/** Interpret new and historical publication metadata without changing stored evidence. */
export function readCrashPublicationEvidence(
  publishedThrough?: string | null,
  provenance?: Provenance | null,
) {
  const isResourceUpdate = provenance?.basis === "resource_updates" ||
    (typeof provenance?.label === "string" && /last[- ]modified/i.test(provenance.label));
  if (!isResourceUpdate) {
    return { publishedThrough: publishedThrough ?? null, provenance: provenance ?? null, resourceUpdateNote: null };
  }

  const legacyDate = typeof provenance?.legacyPublishedThrough === "string"
    ? provenance.legacyPublishedThrough : publishedThrough;
  const retainedProvenance = legacyDate ? { ...provenance, legacyPublishedThrough: legacyDate } : provenance ?? null;
  const updates = Array.isArray(provenance?.resources)
    ? provenance.resources.filter((item): item is Provenance => Boolean(item) && typeof item === "object")
      .map((item) => `${typeof item.year === "number" ? item.year : "Resource"}: ${typeof item.lastModified === "string" ? item.lastModified : "update date unavailable"}`)
    : [];
  const detail = updates.length > 0 ? `Source file updates: ${updates.join("; ")}.`
    : legacyDate ? `Recorded file update: ${legacyDate}.` : "Source file update date unavailable.";
  return {
    publishedThrough: null,
    provenance: retainedProvenance,
    resourceUpdateNote: `The source supplied no exact publication cutoff. ${detail} A file update is not a crash-coverage cutoff.`,
  };
}

/** Shared live-read, saved-acquisition, and history disclosure. */
export function describeCrashPublicationEvidence(publishedThrough?: string | null, provenance?: Provenance | null): string {
  const evidence = readCrashPublicationEvidence(publishedThrough, provenance);
  return evidence.resourceUpdateNote ?? (evidence.publishedThrough
    ? `The source states that its published data runs through ${evidence.publishedThrough}.`
    : "The source supplied no exact publication cutoff; requested and returned years are not substitutes.");
}
