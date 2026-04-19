export type Tone = "info" | "success" | "warning" | "danger" | "neutral";

export function titleize(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function fmtCurrency(value: number | string | null | undefined): string {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "0");
  const safeValue = Number.isFinite(parsed) ? parsed : 0;
  return safeValue.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function buildProjectControlHref(targetId: string, targetRowId?: string | null): string {
  return `#${targetRowId ?? targetId}`;
}

export function toneForStatus(status: string): Tone {
  if (status === "active") return "success";
  if (status === "draft") return "neutral";
  if (status === "on_hold") return "warning";
  if (status === "complete") return "info";
  return "neutral";
}

export function toneForDecision(decision: string): Tone {
  if (decision === "PASS" || decision === "approved") return "success";
  if (decision === "HOLD" || decision === "proposed") return "warning";
  if (decision === "rejected") return "danger";
  return "neutral";
}

export function toneForDeliverableStatus(status: string): Tone {
  if (status === "complete") return "success";
  if (status === "in_progress") return "info";
  if (status === "blocked") return "warning";
  return "neutral";
}

export function toneForMilestoneStatus(status: string): Tone {
  if (status === "complete") return "success";
  if (status === "in_progress") return "info";
  if (status === "blocked") return "warning";
  if (status === "scheduled") return "neutral";
  return "neutral";
}

export function toneForSubmittalStatus(status: string): Tone {
  if (status === "accepted") return "success";
  if (status === "submitted") return "info";
  if (status === "internal_review") return "warning";
  if (status === "revise_and_resubmit") return "danger";
  return "neutral";
}

export function toneForInvoiceStatus(status: string): Tone {
  if (status === "paid") return "success";
  if (status === "submitted" || status === "approved_for_payment") return "info";
  if (status === "internal_review") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

export function toneForRiskSeverity(severity: string): Tone {
  if (severity === "critical") return "danger";
  if (severity === "high") return "warning";
  if (severity === "medium") return "info";
  if (severity === "low") return "success";
  return "neutral";
}

export function toneForDatasetStatus(status: string): Tone {
  if (status === "ready") return "success";
  if (status === "refreshing") return "info";
  if (status === "stale") return "warning";
  if (status === "error") return "danger";
  return "neutral";
}
