import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveGtfsCatalogRedirect } from "./catalog";
import { normalizeGtfsSourceUrl, provisionalFeedNameFromUrl } from "./ingest";
import { classifyRouteReadFailure } from "../http/read-outcome";
import { GtfsSourceResolutionError } from "./managed-route";
import { GTFS_FEED_REFRESH_SOURCE_COLUMNS } from "./route-projections";
import type { GtfsSavedSubmission } from "./managed-admission";
import type { GtfsAdmissionSource } from "./managed-admission";

const identity = z.string().uuid().transform(value => value.toLowerCase());
export const gtfsFeedIntentSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("url"), workspaceId: identity, url: z.string().trim().url().max(2048), label: z.string().trim().min(1).max(120).optional() }).strict(),
  z.object({ source: z.literal("catalog"), workspaceId: identity, catalogId: z.string().trim().min(1).max(120),
    area: z.object({ minLon: z.number().min(-180).max(180), minLat: z.number().min(-90).max(90), maxLon: z.number().min(-180).max(180), maxLat: z.number().min(-90).max(90) }).strict().optional() }).strict(),
]);

export const gtfsSubmissionIntentSchema = z.discriminatedUnion("source", [
  ...gtfsFeedIntentSchema.options,
  z.object({ source: z.literal("upload"), workspaceId: identity, feedId: identity.optional(), filename: z.string().trim().min(1).max(255).optional(), label: z.string().trim().min(1).max(120).optional() }).strict(),
  z.object({ source: z.literal("refresh"), workspaceId: identity, feedId: identity }).strict(),
]);

/** Worker recovery reads current original-actor membership before resolving a
 * catalog or replaying admission. SQL independently rechecks it at mutation.
 */
export async function authorizeManagedGtfsSubmission(service: Pick<SupabaseClient, "from">, saved: GtfsSavedSubmission, signal: AbortSignal) {
  signal.throwIfAborted();
  const ending = new AbortController(), bounded = AbortSignal.any([signal, ending.signal]);
  const timer = setTimeout(() => ending.abort(new Error("GTFS submission membership is unavailable")), 10000);
  let abort = () => {};
  try {
    const unavailable = new Promise<never>((_, reject) => { abort = () => reject(bounded.reason); bounded.addEventListener("abort", abort, { once: true }); if (bounded.aborted) abort(); });
    const query = service.from("workspace_members").select("role").eq("workspace_id", saved.binding.workspaceId).eq("user_id", saved.binding.actorId).abortSignal(bounded).maybeSingle();
    const result = await Promise.race([query, unavailable]); bounded.throwIfAborted();
    if (result.error || !result.data || !["owner", "admin", "member"].includes(z.object({ role: z.string() }).strict().parse(result.data).role)) throw new Error("GTFS submission writer access is unavailable");
  } finally { clearTimeout(timer); bounded.removeEventListener("abort", abort); ending.abort(); }
}

/** Resolve a validated human source selection once, inside private admission
 * custody. Recovery uses its saved resolution and original feed choice. Catalog
 * extent remains a search disclosure; this function claims no service coverage.
 */
export async function resolveManagedGtfsSource(service: Pick<SupabaseClient, "from">, raw: unknown): Promise<{ feedId: string | null; source: GtfsAdmissionSource }> {
  const intent = gtfsFeedIntentSchema.parse(raw);
  let downloadUrl: string, provisionalName: string, catalogProvider: string | null = null, catalogSourceId: string | null = null, catalogRowStatus: string | null = null;
  if (intent.source === "catalog") {
    const resolved = await resolveGtfsCatalogRedirect(intent.catalogId);
    if (resolved.status === "catalog_unavailable") throw new GtfsSourceResolutionError(503, { error: "The transit feed catalog could not be read", detail: resolved.detail });
    if (resolved.status === "refused") throw new GtfsSourceResolutionError(422, { error: "That catalog entry cannot be imported", reason: resolved.reason, detail: resolved.detail });
    if (!resolved.entry.downloadUrl) throw new GtfsSourceResolutionError(422, { error: "That catalog entry publishes no download address" });
    downloadUrl = resolved.entry.downloadUrl; catalogProvider = resolved.entry.provider; catalogSourceId = resolved.entry.catalogId; catalogRowStatus = resolved.entry.status;
    provisionalName = resolved.entry.provider?.trim() || resolved.entry.name?.trim() || `Catalog entry ${resolved.entry.catalogId}`;
  } else { downloadUrl = intent.url; provisionalName = intent.label ?? provisionalFeedNameFromUrl(intent.url); }
  const normalizedSourceUrl = normalizeGtfsSourceUrl(downloadUrl);
  if (!normalizedSourceUrl) throw new GtfsSourceResolutionError(400, { error: "A transit feed address must use http:// or https://" });
  const result = await (catalogSourceId ? service.from("gtfs_feeds").select("id, agency_name").eq("workspace_id", intent.workspaceId).eq("catalog_source_id", catalogSourceId)
    : service.from("gtfs_feeds").select("id, agency_name").eq("workspace_id", intent.workspaceId).eq("normalized_source_url", normalizedSourceUrl)).maybeSingle();
  const failure = classifyRouteReadFailure("transit feeds", result);
  if (failure) throw new GtfsSourceResolutionError(failure.status, failure.body);
  const existing = result.data === null ? null : z.object({ id: z.string().uuid(), agency_name: z.string().nullable() }).strict().parse(result.data);
  return { feedId: existing?.id ?? null, source: { kind: catalogSourceId ? "catalog" : "url", provisionalName: (existing?.agency_name?.trim() || provisionalName).slice(0, 120),
    sourceUrl: downloadUrl, normalizedSourceUrl, catalogProvider, catalogSourceId, catalogRowStatus } };
}


/** Resolve upload/refresh intent only when the private request has no saved
 * resolution. A refreshed feed takes its source from its scoped stored row.
 */
export async function resolveManagedGtfsSubmission(service: Pick<SupabaseClient, "from">, raw: unknown, archive: { sha256: string; bytes: number } | null) {
  const intent = gtfsSubmissionIntentSchema.parse(raw);
  if (intent.source === "url" || intent.source === "catalog") return resolveManagedGtfsSource(service, intent);
  if (intent.source === "upload") {
    if (!archive) throw new GtfsSourceResolutionError(409, { error: "Retained upload bytes are unavailable" });
    if (intent.feedId) {
      const result = await service.from("gtfs_feeds").select("id").eq("workspace_id", intent.workspaceId).eq("id", intent.feedId).maybeSingle();
      const failure = classifyRouteReadFailure("the transit feed", result); if (failure) throw new GtfsSourceResolutionError(failure.status, failure.body);
      if (!result.data) throw new GtfsSourceResolutionError(404, { error: "Transit feed not found" });
      const row = z.object({ id: z.string().uuid() }).strict().parse(result.data);
      if (row.id !== intent.feedId) throw new Error("GTFS upload feed lookup differs");
    }
    const basename = (intent.filename ?? "").split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "").trim();
    return { feedId: intent.feedId ?? null, source: { kind: "upload" as const, provisionalName: (intent.label || basename || "Uploaded transit feed").slice(0, 120), uploadSha256: archive.sha256, uploadBytes: archive.bytes } };
  }
  const result = await service.from("gtfs_feeds").select(GTFS_FEED_REFRESH_SOURCE_COLUMNS).eq("workspace_id", intent.workspaceId).eq("id", intent.feedId).maybeSingle();
  const failure = classifyRouteReadFailure("the transit feed", result); if (failure) throw new GtfsSourceResolutionError(failure.status, failure.body);
  if (!result.data) throw new GtfsSourceResolutionError(404, { error: "Transit feed not found" });
  const row = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid().nullable(), agency_name: z.string(), source_kind: z.string().nullable(), feed_url: z.string().nullable(), catalog_provider: z.string().nullable(), catalog_source_id: z.string().nullable() }).strict().parse(result.data);
  if (row.id !== intent.feedId || row.workspace_id !== intent.workspaceId) throw new Error("GTFS refresh feed scope differs");
  if (row.source_kind === "upload") throw new GtfsSourceResolutionError(409, { error: "Upload a new ZIP to refresh this feed" });
  const resolved = row.catalog_source_id ? await resolveManagedGtfsSource(service, { source: "catalog", workspaceId: intent.workspaceId, catalogId: row.catalog_source_id })
    : row.feed_url ? await resolveManagedGtfsSource(service, { source: "url", workspaceId: intent.workspaceId, url: row.feed_url, label: row.agency_name }) : null;
  if (!resolved) throw new GtfsSourceResolutionError(409, { error: "This feed has no saved refresh source" });
  return { feedId: intent.feedId, source: { ...resolved.source, provisionalName: row.agency_name.trim().slice(0, 120) || resolved.source.provisionalName } };
}
