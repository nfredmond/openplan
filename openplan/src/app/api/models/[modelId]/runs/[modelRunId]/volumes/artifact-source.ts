import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Artifact-source resolution for model-run volume GeoJSON.
 *
 * Runs authored by the worker register a private Storage reference
 * (`storage://<bucket>/<object-path>`) that is resolved with the service-role
 * client. Local-filesystem reads (`local://` and run-local reconstruction) are
 * a dev-only convenience and are disabled unless OPENPLAN_WORKER_LOCAL_ROOT is
 * set, so hosted deployments (app and worker on different hosts) never read the
 * local disk or depend on public Storage URLs.
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

export async function loadJsonArtifact(fileUrl: string): Promise<unknown> {
  // Private Storage path — download with the service-role client so workspace
  // RLS is enforced upstream (the route already gated model/run access) and no
  // public URL is ever exposed.
  const storageRef = parseStorageRef(fileUrl);
  if (storageRef) {
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
    const res = await fetch(fileUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Artifact fetch failed (${res.status})`);
    }
    return res.json();
  }

  // Local reads are dev-only and gated behind the env flag.
  if (!workerLocalRoot()) {
    throw new Error(
      "Local artifact reads are disabled; set OPENPLAN_WORKER_LOCAL_ROOT to enable dev-local reads."
    );
  }
  if (fileUrl.startsWith("local://")) {
    const payload = await readFile(fileUrl.slice("local://".length), "utf8");
    return JSON.parse(payload);
  }
  const payload = await readFile(fileUrl, "utf8");
  return JSON.parse(payload);
}

export function resolveRunWorkDir(localRoot: string, modelRunId: string): string {
  return path.join(localRoot, "runs", modelRunId.slice(0, 12));
}
