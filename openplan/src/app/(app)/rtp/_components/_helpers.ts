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
  /**
   * Show plans the agency has archived — previous adopted plans, kept for the
   * record and for reading figures out of. Off by default so the registry shows
   * the plan being worked on rather than a decade of history.
   */
  archived?: boolean | null;
}) {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.archived) {
    params.set("archived", "1");
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
