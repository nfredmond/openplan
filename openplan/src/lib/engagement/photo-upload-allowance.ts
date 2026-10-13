import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW,
  PUBLIC_PHOTO_UPLOAD_RATE_WINDOW_MINUTES,
} from "@/lib/engagement/photo";

/**
 * How many public photos may be stored, counted in the database so every
 * server instance sees the same numbers (KI-2026-10-12-012).
 *
 * Until 2026-10-12 the per-connection limit was a Map inside each server
 * instance. On a platform that runs many instances, each one started its own
 * count, so the limit held for nobody, and nothing bounded what one campaign
 * could be sent in total.
 *
 * Every accepted upload now writes one `usage_events` row in its own bucket,
 * outside the AI buckets in `ai-rate-limit.ts`, so photo traffic can never use
 * up a workspace's AI allowance or be counted against it:
 *
 *   workspace_id  the campaign's workspace (the column is required)
 *   event_key     the storage path of the photo
 *   weight        the bytes stored
 *   metadata_json { campaign_id, source_fingerprint }
 *
 * The same rows are the queue `photo-sweep.ts` works through: a photo still
 * unattached a day after upload is removed, and its row with it.
 */
export const PUBLIC_PHOTO_UPLOAD_BUCKET_KEY = "engagement_public_photo_upload";
export const PUBLIC_PHOTO_UPLOAD_SOURCE_ROUTE = "/api/engage/[shareToken]/photo-upload";

/**
 * Per campaign, over a rolling day. 200 photos is 50 people at one workshop
 * attaching two photos each, twice over. 500 MB allows an average of 2.5 MB at
 * that count; one photo is at most 5 MB. Unattached photos are removed a day
 * after upload by a daily sweep, so a flood leaves at most about two days of
 * this budget in storage.
 */
export const PUBLIC_PHOTO_UPLOAD_CAMPAIGN_WINDOW_HOURS = 24;
export const PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_PER_WINDOW = 200;
export const PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_BYTES_PER_WINDOW = 500 * 1024 * 1024;

type QueryClient = Pick<SupabaseClient, "from">;

export type PhotoUploadScope = {
  workspaceId: string;
  campaignId: string;
  /** The connection fingerprint from `buildPublicSubmissionClientFingerprint`. */
  fingerprint: string;
};

export type PhotoUploadUsage = {
  /** Uploads from this connection, in any campaign, in the last 10 minutes. */
  fromConnection: number;
  /** Uploads to this campaign in the last day. */
  forCampaign: number;
  /** Bytes stored for this campaign in the last day. */
  campaignBytes: number;
};

export type PhotoUploadRefusal = "connection" | "campaign";

function isoBefore(now: number, milliseconds: number): string {
  return new Date(now - milliseconds).toISOString();
}

/** Reads the counts. `ok: false` when either read failed: the caller refuses the upload. */
export async function readPhotoUploadUsage(
  client: QueryClient,
  scope: PhotoUploadScope,
  now: number = Date.now()
): Promise<{ ok: true; usage: PhotoUploadUsage } | { ok: false; message: string }> {
  const [connection, campaign] = await Promise.all([
    client
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("bucket_key", PUBLIC_PHOTO_UPLOAD_BUCKET_KEY)
      .eq("metadata_json->>source_fingerprint", scope.fingerprint)
      .gte("occurred_at", isoBefore(now, PUBLIC_PHOTO_UPLOAD_RATE_WINDOW_MINUTES * 60 * 1000)),
    client
      .from("usage_events")
      .select("weight", { count: "exact" })
      .eq("workspace_id", scope.workspaceId)
      .eq("bucket_key", PUBLIC_PHOTO_UPLOAD_BUCKET_KEY)
      .eq("metadata_json->>campaign_id", scope.campaignId)
      .gte("occurred_at", isoBefore(now, PUBLIC_PHOTO_UPLOAD_CAMPAIGN_WINDOW_HOURS * 60 * 60 * 1000))
      // One row past the cap is all the decision needs; `count` stays exact.
      .limit(PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_PER_WINDOW + 1),
  ]);

  const failure = connection.error ?? campaign.error;
  if (failure) return { ok: false, message: failure.message };

  const rows = (campaign.data ?? []) as Array<{ weight: number | null }>;
  return {
    ok: true,
    usage: {
      fromConnection: connection.count ?? 0,
      forCampaign: campaign.count ?? rows.length,
      campaignBytes: rows.reduce((sum, row) => sum + (typeof row.weight === "number" ? row.weight : 0), 0),
    },
  };
}

/**
 * Which limit the upload would pass, if any. Before the reservation is written
 * the upload must leave room (`>=` refuses); after it, the counts include the
 * upload itself (`>` refuses).
 */
export function photoUploadRefusal(
  usage: PhotoUploadUsage,
  options: { includesThisUpload: boolean }
): PhotoUploadRefusal | null {
  const over = (value: number, max: number) => (options.includesThisUpload ? value > max : value >= max);
  if (over(usage.fromConnection, PUBLIC_PHOTO_UPLOAD_MAX_PER_WINDOW)) return "connection";
  if (
    over(usage.forCampaign, PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_PER_WINDOW) ||
    over(usage.campaignBytes, PUBLIC_PHOTO_UPLOAD_CAMPAIGN_MAX_BYTES_PER_WINDOW)
  ) {
    return "campaign";
  }
  return null;
}

/** Writes the upload's row before the bytes are stored. Returns its id, or null when the write failed. */
export async function reservePhotoUpload(
  client: QueryClient,
  scope: PhotoUploadScope & { photoPath: string; bytes: number }
): Promise<string | null> {
  const { data, error } = await client
    .from("usage_events")
    .insert({
      workspace_id: scope.workspaceId,
      bucket_key: PUBLIC_PHOTO_UPLOAD_BUCKET_KEY,
      event_key: scope.photoPath,
      weight: Math.max(1, Math.ceil(scope.bytes)),
      source_route: PUBLIC_PHOTO_UPLOAD_SOURCE_ROUTE,
      metadata_json: { campaign_id: scope.campaignId, source_fingerprint: scope.fingerprint },
    })
    .select("id")
    .single();
  const id = (data as { id?: unknown } | null)?.id;
  return error || typeof id !== "string" ? null : id;
}

/**
 * Removes a reservation whose photo was refused or never stored. Best-effort:
 * true when the row is gone. A row left behind only counts against the limits
 * for a day, and the sweep then clears it.
 */
export async function releasePhotoUpload(client: QueryClient, reservationId: string): Promise<boolean> {
  const { data, error } = await client
    .from("usage_events")
    .delete()
    .eq("id", reservationId)
    .eq("bucket_key", PUBLIC_PHOTO_UPLOAD_BUCKET_KEY)
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}
