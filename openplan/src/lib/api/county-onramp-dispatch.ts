import type { CountyOnrampWorkerPayload } from "@/lib/api/county-onramp-worker";

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
