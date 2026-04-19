import type { PacketAttentionFilter, QueueActionFilter, QueueTraceStateFilter } from "./_types";

export function formatUsdWholeAmount(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function buildRtpRegistryHref(filters: {
  status?: string | null;
  packet?: PacketAttentionFilter | null;
  recent?: boolean | null;
  queueAction?: QueueActionFilter | null;
  queueTraceState?: QueueTraceStateFilter | null;
}) {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.packet && filters.packet !== "all") {
    params.set("packet", filters.packet);
  }
  if (filters.recent) {
    params.set("recent", "1");
  }
  if (filters.queueAction && filters.queueAction !== "all") {
    params.set("queueAction", filters.queueAction);
  }
  if (filters.queueTraceState && filters.queueTraceState !== "all") {
    params.set("queueTraceState", filters.queueTraceState);
  }
  const query = params.toString();
  return query ? `/rtp?${query}` : "/rtp";
}
