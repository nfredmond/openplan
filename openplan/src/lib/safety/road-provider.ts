import type { SafetyCrashEvidenceIngest } from "./crash-evidence";
import { getCrashSourceById } from "./sources/registry";

/**
 * Select road context from every retained acquisition's declared source capability.
 * Coverage validates the retained scope only. It never establishes the geometry's
 * country, and a client country hint cannot supply missing source provenance.
 */
export function retainedCrashRoadProvider(
  ingests: readonly SafetyCrashEvidenceIngest[],
  selectedIngestIds: readonly string[],
): string | null {
  const selectedIds = new Set(selectedIngestIds);
  if (selectedIds.size === 0 || selectedIds.size !== selectedIngestIds.length || ingests.length !== selectedIds.size) return null;
  const retainedIds = new Set(ingests.map(({ id }) => id));
  if (retainedIds.size !== ingests.length || selectedIngestIds.some((id) => !retainedIds.has(id))) return null;
  let provider: string | null = null;
  for (const ingest of ingests) {
    if (!ingest.sourceId || !ingest.scopeBounds) return null;
    const source = getCrashSourceById(ingest.sourceId);
    if (!source?.roadContextProvider || !source.covers(ingest.scopeBounds)) return null;
    if (provider !== null && provider !== source.roadContextProvider) return null;
    provider = source.roadContextProvider;
  }
  return provider;
}
