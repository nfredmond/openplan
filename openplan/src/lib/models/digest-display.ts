/**
 * SHOWING A DIGEST TO A PLANNER, and being honest about what one proves.
 *
 * Two surfaces answer "which inputs did this run actually use?" — the run
 * evidence panel (corridor geometry) and the model detail page (the ingested
 * network). Both need the same two things: a short readable form, and a
 * truthful account of an absent value.
 *
 * This lives here rather than inside either of them because a helper that lives
 * in one of its two callers gets reimplemented, slightly differently, by the
 * other — and "slightly differently" for a provenance string means two surfaces
 * disagreeing about whether two runs used the same network.
 */

/**
 * The first 12 characters, which is what a person can actually compare by eye.
 *
 * Null in, null out. An absent digest is NOT an empty string and must never
 * render as one: the caller has to choose what to say about "not recorded",
 * and a blank looks like a value that failed to load.
 */
export function shortDigest(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const trimmed = hash.trim();
  if (!trimmed) return null;
  return trimmed.length > 12 ? `${trimmed.slice(0, 12)}…` : trimmed;
}

/**
 * What a network digest DOES answer, for the label beside it.
 *
 * Deliberately narrower than the database column's original comment, which
 * promised "SHA-256 hash of the primary network bundle for integrity
 * verification" and was never written by anything. There is no primary bundle:
 * network content arrives as parsed GeoJSON in a request body, so what is
 * hashed is the parsed payload. Two semantically identical files with different
 * key ordering digest differently, and nothing detects that they are the same
 * network.
 *
 * So it answers "is this the same ingest?" — which is the provenance question a
 * planner defending a model is actually asked — and not "is this file
 * uncorrupted?".
 */
export const NETWORK_DIGEST_MEANING =
  "Identifies the ingested nodes and links this version was built from: two versions with the same " +
  "digest carry the same network, and a re-ingest that changes one link changes it. It is a digest of " +
  "the parsed network, not a checksum of a file, so it cannot detect a corrupted upload.";

/**
 * What to say when a version carries no digest.
 *
 * Versions ingested before the digest was computed have none, and that is a
 * knowable fact about the record rather than an uncertainty about the network.
 * Saying "unknown" would blur a precise absence into a doubt — the shape of
 * every honesty defect in this repository.
 */
export const NETWORK_DIGEST_ABSENT_NOTE =
  "This version was ingested before OpenPlan recorded a network digest, so there is nothing to compare " +
  "it against. Re-ingesting the network records one.";
