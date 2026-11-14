import type { SupabaseClient } from "@supabase/supabase-js";
import type { KeptSourceFileStore } from "./types";

/**
 * Where reduced copies of public crash source files are kept.
 *
 * WHY THIS BUCKET. The kept files are public-domain source data shared by every
 * workspace, not a workspace's own records, and adding a bucket needs a
 * migration. `network-packages` is private, has no size or MIME limit, no
 * storage policy (only the service role reads or writes it) and no writer in
 * the application, and its paths do not start with a workspace id, so nothing
 * here counts toward a workspace's storage limit
 * (20261017000010_workspace_storage_quota.sql). Every path sits under
 * `KEPT_SOURCE_FILE_PREFIX` so these objects stay apart from anything else in
 * the bucket. A dedicated bucket is a migration for a later change.
 */
export const KEPT_SOURCE_FILE_BUCKET = "network-packages";
export const KEPT_SOURCE_FILE_PREFIX = "public-sources/";

/**
 * A kept-file store over the service-role client the caller already holds.
 * Every failure, including a client without Storage, reads as "not kept", so
 * the adapter falls back to the source and never fails an acquisition over
 * its own copy.
 */
export function keptSourceFileStore(service: SupabaseClient): KeptSourceFileStore {
  const bucket = () => service.storage.from(KEPT_SOURCE_FILE_BUCKET);
  return {
    async read(path) {
      try {
        const { data, error } = await bucket().download(`${KEPT_SOURCE_FILE_PREFIX}${path}`);
        if (error || !data) return null;
        return new Uint8Array(await data.arrayBuffer());
      } catch {
        return null;
      }
    },
    async write(path, bytes, contentType) {
      try {
        const { error } = await bucket().upload(`${KEPT_SOURCE_FILE_PREFIX}${path}`, bytes, {
          contentType,
          upsert: true,
        });
        return !error;
      } catch {
        return false;
      }
    },
  };
}
