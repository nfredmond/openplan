import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Artifact-source resolution for model-run artifacts.
 *
 * Runs authored by the worker register a private Storage reference
 * (`storage://<bucket>/<object-path>`) that is resolved with the service-role
 * client. Local-filesystem reads (`local://` and run-local reconstruction) are
 * a dev-only convenience and are disabled unless OPENPLAN_WORKER_LOCAL_ROOT is
 * set, so hosted deployments (app and worker on different hosts) never read the
 * local disk or depend on public Storage URLs.
 *
 * `file_url` values are data, not trust: workspace members can register
 * artifact rows directly (RLS checks only run membership) and the skims API
 * accepts caller-supplied file_url. Every dereference therefore has to be
 * scoped — storage reads to the expected bucket + run prefix, local reads
 * contained under the worker-local root — or the service-role client becomes
 * a read/signing oracle for arbitrary objects.
 */

/** Worker-local filesystem root for dev. Null disables all local reads. */
export function workerLocalRoot(): string | null {
  return process.env.OPENPLAN_WORKER_LOCAL_ROOT ?? null;
}

/** Parse a `storage://<bucket>/<object-path>` reference. */
export function parseStorageRef(
  fileUrl: string
): { bucket: string; objectPath: string } | null {
  if (!fileUrl.startsWith("storage://")) return null;
  const rest = fileUrl.slice("storage://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), objectPath: rest.slice(slash + 1) };
}

/** Read scope binding an artifact dereference to its authorized run. */
export type ArtifactReadScope = {
  bucket: string;
  objectPathPrefix: string;
  /**
   * Containment root for local:// / bare-path reads. Defaults to
   * OPENPLAN_WORKER_LOCAL_ROOT; pass the run's work dir to bind local reads to
   * the run the caller already authorized.
   */
  localRoot?: string;
};

/** True when the parsed ref stays inside the scope's bucket + path prefix. */
export function storageRefAllowed(
  ref: { bucket: string; objectPath: string },
  scope: Pick<ArtifactReadScope, "bucket" | "objectPathPrefix">
): boolean {
  return (
    ref.bucket === scope.bucket &&
    ref.objectPath.startsWith(scope.objectPathPrefix) &&
    !ref.objectPath.includes("..")
  );
}

/**
 * Resolve a local:// or bare filesystem ref to an absolute path, refusing any
 * path that escapes the containment root. Returns null when out of bounds.
 */
export function resolveContainedLocalPath(fileUrl: string, root: string): string | null {
  const raw = fileUrl.startsWith("local://") ? fileUrl.slice("local://".length) : fileUrl;
  const resolved = path.resolve(raw);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
    ? resolved
    : null;
}

export async function loadJsonArtifact(
  fileUrl: string,
  scope?: ArtifactReadScope
): Promise<unknown> {
  // Private Storage path — download with the service-role client so workspace
  // RLS is enforced upstream (the route already gated model/run access) and no
  // public URL is ever exposed. The scope check keeps member-registered rows
  // from turning the service-role client into a cross-bucket read oracle.
  const storageRef = parseStorageRef(fileUrl);
  if (storageRef) {
    if (scope && !storageRefAllowed(storageRef, scope)) {
      throw new Error("Artifact storage reference is outside this run's scope.");
    }
    const service = createServiceRoleClient();
    const { data, error } = await service.storage
      .from(storageRef.bucket)
      .download(storageRef.objectPath);
    if (error || !data) {
      throw new Error(`Storage download failed (${error?.message ?? "no data"})`);
    }
    return JSON.parse(await data.text());
  }

  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
    // Remote fetches of member-controlled URLs are an SSRF surface; scoped
    // readers never accept them. (Legacy public bucket URLs were repaired to
    // storage:// refs by migration 20260718000086.)
    if (scope) {
      throw new Error("Remote artifact URLs are not supported for scoped artifact reads.");
    }
    const res = await fetch(fileUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Artifact fetch failed (${res.status})`);
    }
    return res.json();
  }

  // Local reads are dev-only, gated behind the env flag, and always contained.
  const envRoot = workerLocalRoot();
  if (!envRoot) {
    throw new Error(
      "Local artifact reads are disabled; set OPENPLAN_WORKER_LOCAL_ROOT to enable dev-local reads."
    );
  }
  const contained = resolveContainedLocalPath(fileUrl, scope?.localRoot ?? envRoot);
  if (!contained) {
    throw new Error("Local artifact path escapes the worker-local root.");
  }
  const payload = await readFile(contained, "utf8");
  return JSON.parse(payload);
}

export function resolveRunWorkDir(localRoot: string, modelRunId: string): string {
  return path.join(localRoot, "runs", modelRunId.slice(0, 12));
}
