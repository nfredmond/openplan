import { readFrozenPlanContext } from "@/lib/land-use-plans/context-snapshot";
import { LandUsePlanRetainedContext } from "./land-use-plan-retained-context";

/** Public readers verify the snapshot hash before this component presents its saved assessment. */
export function LandUsePlanPublicContext({ snapshot }: { snapshot: Record<string, unknown> }) {
  const value = readFrozenPlanContext(snapshot);
  if (value.status === "invalid") return <p role="alert">The saved plan area and authority assessment could not be verified.</p>;
  return <LandUsePlanRetainedContext value={value.status === "retained" ? value : { status: "legacy" }} />;
}
