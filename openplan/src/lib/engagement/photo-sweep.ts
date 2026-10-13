import type { SupabaseClient } from "@supabase/supabase-js";
import { ENGAGEMENT_PHOTO_BUCKET, isEngagementPhotoPathForCampaign } from "@/lib/engagement/photo";
import { PUBLIC_PHOTO_UPLOAD_BUCKET_KEY } from "@/lib/engagement/photo-upload-allowance";
import { loadSurveyFileReferenceText } from "@/lib/engagement/survey-responses";
import { readEveryPage, type PagedReadPage } from "@/lib/supabase/paged-read";

/**
 * Removes public photos that nothing took up (KI-2026-10-12-012).
 *
 * A resident's photo is stored before their comment exists: the portal uploads
 * it first and sends its path with the comment. A photo whose comment was never
 * sent stayed in storage for good, and a script could fill the bucket that way.
 *
 * Every public upload writes a `usage_events` row first (see
 * `photo-upload-allowance.ts`). This sweep reads those rows once they are older
 * than a day. A comment or survey answer can only take up a photo uploaded
 * within ENGAGEMENT_PHOTO_UPLOAD_LOOKBACK_MINUTES (two hours), so by then the
 * photo is either referenced or never will be.
 *
 * NEVER DELETE A PHOTO SOMETHING REFERENCES. Before removing anything the sweep
 * looks for the path in every place that keeps one:
 *
 *   engagement_items.photo_path                 a comment
 *   engagement_item_history.record_json         every version of a comment,
 *                                               including after staff removed
 *                                               the photo from it
 *   engagement_survey_answers.answer_json       a survey file answer
 *   engagement_survey_review_history            survey answers before and after
 *                                               staff review or redaction
 *
 * The survey records are searched as text, so a path anywhere in them counts.
 * Any failed read stops the run before anything is deleted. A referenced photo
 * is kept, and in both cases the row is then removed, so each upload is decided
 * once; a run that stops early leaves the rest for the next one.
 *
 * Photos uploaded before 2026-10-12 have no row and are not touched.
 */
export const UNATTACHED_PHOTO_MAX_AGE_HOURS = 24;
// Up to 2,000 uploads a run. A batch's paths go into one `in.(...)` filter, and
// 50 paths keeps that request line near 4 KB.
export const PHOTO_SWEEP_BATCH_SIZE = 50;
export const PHOTO_SWEEP_MAX_BATCHES = 40;

type SweepClient = Pick<SupabaseClient, "from" | "storage">;

export type PhotoSweepResult = {
  /** Upload rows read. */
  examined: number;
  /** Photos removed from storage. */
  removed: number;
  /** Photos kept because something references them. */
  kept: number;
  /** True when the run stopped at its batch limit with rows left. */
  more: boolean;
};

export class PhotoSweepError extends Error {}

function failIf(result: { error: { message: string } | null }, what: string): void {
  if (result.error) throw new PhotoSweepError(`Photo sweep stopped at ${what}: ${result.error.message}`);
}

/** Every row of a read, or a PhotoSweepError: a missed row here is a kept photo deleted. */
async function readAll<Row>(
  fetchPage: (from: number, toInclusive: number) => PromiseLike<PagedReadPage<Row>>,
  what: string
): Promise<Row[]> {
  const { rows, complete, error } = await readEveryPage(fetchPage);
  failIf({ error }, what);
  if (!complete) throw new PhotoSweepError(`Photo sweep stopped at ${what}: the read did not finish`);
  return rows;
}

/** The subset of `paths` that any comment, comment version or survey record mentions. */
export async function findReferencedPhotoPaths(client: SweepClient, paths: string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  if (paths.length === 0) return referenced;

  const items = await readAll<{ photo_path: unknown }>(
    (from, to) =>
      client
        .from("engagement_items")
        .select("id, photo_path")
        .in("photo_path", paths)
        .order("id", { ascending: true })
        .range(from, to),
    "reading comments"
  );
  const versions = await readAll<{ photo_path: unknown }>(
    (from, to) =>
      client
        .from("engagement_item_history")
        .select("id, photo_path:record_json->>photo_path")
        .in("record_json->>photo_path", paths)
        .order("id", { ascending: true })
        .range(from, to),
    "reading comment history"
  );
  for (const row of [...items, ...versions]) {
    if (typeof row.photo_path === "string") referenced.add(row.photo_path);
  }

  // Survey records keep paths inside nested JSON, so each campaign's records
  // are read whole and searched as text.
  const campaigns = [...new Set(paths.map((path) => path.split("/")[0]))];
  for (const campaignId of campaigns) {
    const survey = await loadSurveyFileReferenceText(client, campaignId);
    failIf(survey, "reading survey records");
    for (const path of paths) {
      if (path.startsWith(`${campaignId}/`) && survey.text?.includes(path)) referenced.add(path);
    }
  }

  return referenced;
}

/**
 * One sweep. Throws PhotoSweepError when a read or delete fails; whatever was
 * finished before that stays finished, and nothing unverified is deleted.
 */
export async function sweepUnattachedEngagementPhotos(
  client: SweepClient,
  options: { now?: Date; batchSize?: number; maxBatches?: number } = {}
): Promise<PhotoSweepResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? PHOTO_SWEEP_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? PHOTO_SWEEP_MAX_BATCHES;
  const cutoff = new Date(now.getTime() - UNATTACHED_PHOTO_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const result: PhotoSweepResult = { examined: 0, removed: 0, kept: 0, more: false };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const due = await client
      .from("usage_events")
      .select("id, event_key, metadata_json")
      .eq("bucket_key", PUBLIC_PHOTO_UPLOAD_BUCKET_KEY)
      .lt("occurred_at", cutoff)
      .order("occurred_at", { ascending: true })
      .limit(batchSize);
    failIf(due, "reading photo uploads");
    const rows = (due.data ?? []) as Array<{ id: string; event_key: string; metadata_json: { campaign_id?: unknown } | null }>;
    if (rows.length === 0) return result;
    result.examined += rows.length;

    // Only a path this lane wrote, under the campaign the row names, is ever a
    // candidate. Anything else is dropped from the queue and left in storage.
    const candidates = [
      ...new Set(
        rows
          .filter((row) => {
            const campaignId = row.metadata_json?.campaign_id;
            return typeof campaignId === "string" && isEngagementPhotoPathForCampaign(row.event_key, campaignId);
          })
          .map((row) => row.event_key)
      ),
    ];
    const referenced = await findReferencedPhotoPaths(client, candidates);
    const unreferenced = candidates.filter((path) => !referenced.has(path));

    if (unreferenced.length > 0) {
      const removal = await client.storage.from(ENGAGEMENT_PHOTO_BUCKET).remove(unreferenced);
      failIf(removal, "removing photos");
    }
    result.removed += unreferenced.length;
    result.kept += candidates.length - unreferenced.length;

    const dequeue = await client
      .from("usage_events")
      .delete()
      .eq("bucket_key", PUBLIC_PHOTO_UPLOAD_BUCKET_KEY)
      .in(
        "id",
        rows.map((row) => row.id)
      )
      .select("id");
    failIf(dequeue, "clearing the upload queue");
    // A row still there would be read again next batch; stop rather than loop.
    if ((dequeue.data ?? []).length !== rows.length) {
      throw new PhotoSweepError("Photo sweep stopped at clearing the upload queue: some rows were not removed");
    }

    if (rows.length < batchSize) return result;
  }

  result.more = true;
  return result;
}
