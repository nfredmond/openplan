import type { DriftStatus } from "./_types";

export function driftTone(
  status: DriftStatus
): "success" | "warning" | "neutral" | "info" {
  if (status === "unchanged") return "success";
  if (status === "gate changed" || status === "count changed") return "warning";
  if (status === "updated") return "info";
  return "neutral";
}

export function formatCurrency(value: number | null | undefined): string {
  const numeric = typeof value === "number" ? value : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}
