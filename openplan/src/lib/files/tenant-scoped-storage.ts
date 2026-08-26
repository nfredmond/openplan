import { parseStorageRef, storageRefAllowed } from "@/lib/models/artifact-source";

export type TenantScopedStorageTarget = { bucket: string; objectPath: string };

/**
 * Resolve a stored reference only inside the authorized bucket and parent
 * prefix. Download routes may sign the target; bundle generation may read its
 * bytes. Both use this same resolver, so stored paths cannot drift into two
 * different trust boundaries.
 */
export function resolveTenantScopedStorageTarget(
  value: string | null | undefined,
  options: {
    bucket: string;
    objectPathPrefix: string;
    extension?: string;
  }
): TenantScopedStorageTarget | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.startsWith("http://") || raw.startsWith("https://")) return null;
  const ref = parseStorageRef(raw) ?? { bucket: options.bucket, objectPath: raw };
  if (
    ref.objectPath.startsWith("/") ||
    !storageRefAllowed(ref, options) ||
    (options.extension && !ref.objectPath.toLowerCase().endsWith(options.extension.toLowerCase()))
  ) {
    return null;
  }
  return ref;
}
