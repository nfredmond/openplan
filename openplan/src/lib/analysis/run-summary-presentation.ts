import { scoreValueForPresentation } from "./score-presentation";
import { resolveEstimatedDomains } from "./estimated-source";


/** Apply the same saved-prose disclosure in reports and their evidence view. */
export function presentRunSummary(summary: string | null, metrics: Record<string, unknown> | null | undefined) {
  const conflicts: string[] = [];
  for (const [key, label] of [
    ["overallScore", "Overall"],
    ["safetyScore", "Safety"],
    ["accessibilityScore", "Accessibility"],
    ["equityScore", "Equity"],
  ] as const) {
    if (scoreValueForPresentation(metrics ?? {}, key) === null
      && new RegExp(`\\b${label}(?: score)?\\s*:?\\s*\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*100|\\s+of\\s+100)`, "i").test(summary ?? "")) {
      conflicts.push(`${label.toLowerCase()} score is not eligible for presentation`);
    }
  }
  if (resolveEstimatedDomains(metrics).crashes && /no crash figures were estimated/i.test(summary ?? "")) {
    conflicts.push("the saved crash narrative contradicts the run's recorded estimated-source metadata");
  }
  return {
    withheld: conflicts.length > 0,
    text: conflicts.length > 0
      ? `Saved run summary withheld. This linked run's saved prose conflicts with current evidence-presentation rules: ${conflicts.join("; ")}. The stored run is unchanged; inspect or regenerate it before citing its narrative.`
      : summary || "No run summary is saved yet.",
  };
}
