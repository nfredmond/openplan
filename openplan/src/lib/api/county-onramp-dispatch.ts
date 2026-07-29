import type { CountyOnrampWorkerPayload } from "@/lib/api/county-onramp-worker";

/**
 * Hand a county onramp job to the worker that runs it — or, when no worker is
 * configured, say plainly that nothing was handed to anything.
 *
 * `deliveryMode` is the whole point of this module, and the two values are NOT
 * degrees of the same thing:
 *
 *   "submitted" — an HTTP POST reached a configured worker, which will run the
 *                 bootstrap and call the manifest ingest endpoint back. The run
 *                 progresses on its own.
 *   "prepared"  — no worker URL is configured on this deployment, so no request
 *                 was made and nothing will execute this job on its own. The
 *                 payload is still built and stored, because it is a complete,
 *                 usable handoff: an operator can run the bootstrap script
 *                 themselves and POST the manifest back to the callback URL in
 *                 the payload. That manual lane is real and must not be deleted
 *                 by "fixing" this to throw.
 *
 * WHAT MUST NEVER HAPPEN AGAIN
 *   "prepared" was being surfaced to planners as a queued background run. It is
 *   not one. A prepared job sits forever unless a person picks it up, so any
 *   surface that offers this action has to say — before the click, not after —
 *   that on a deployment with no worker it produces a handoff rather than a
 *   run. The county-run launch and detail surfaces key on exactly this: a
 *   `prepared` record is proof that no worker was configured when it was made,
 *   because that is the only branch that can produce one.
 */
export type CountyOnrampDispatchResult = {
  deliveryMode: "prepared" | "submitted";
  workerUrl: string | null;
};

export async function dispatchCountyOnrampJob(
  payload: CountyOnrampWorkerPayload,
  fetcher: typeof fetch = fetch
): Promise<CountyOnrampDispatchResult> {
  const workerUrl = process.env.OPENPLAN_COUNTY_ONRAMP_WORKER_URL?.trim() || null;
  if (!workerUrl) {
    return { deliveryMode: "prepared", workerUrl: null };
  }

  const token = process.env.OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN?.trim();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetcher(workerUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = (await response.text().catch(() => "")).trim();
    throw new Error(
      errorText
        ? `County worker dispatch failed (${response.status}): ${errorText}`
        : `County worker dispatch failed (${response.status})`
    );
  }

  return { deliveryMode: "submitted", workerUrl };
}
