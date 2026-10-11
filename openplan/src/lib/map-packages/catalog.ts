import { AGENT_MODEL_POLICY } from "@/lib/ai/model-policy";

/** What the maps are for. The brief names it so the agent picks the figure programme. */
export const MAP_PACKAGE_DELIVERABLES = [
  "grant_application",
  "corridor_study",
  "safety_plan",
  "active_transportation_plan",
  "transportation_plan",
  "general",
] as const;
export type MapPackageDeliverable = (typeof MAP_PACKAGE_DELIVERABLES)[number];

export const MAP_PACKAGE_DELIVERABLE_LABELS: Record<MapPackageDeliverable, string> = {
  grant_application: "Grant application",
  corridor_study: "Corridor study",
  safety_plan: "Safety plan",
  active_transportation_plan: "Active transportation plan",
  transportation_plan: "Transportation plan",
  general: "Other",
};

/**
 * Who may run the skill. Nathaniel's rule (2026-10-10): Claude Fable 5.1 is the
 * only model that should run it and GPT-6 Astra is a far second; no other model
 * may. Astra runs through Codex, which stays closed until a sandbox probe shows
 * the agent cannot read Codex's credentials (design note, phase C).
 */
const MAP_PACKAGE_RUNNERS = [
  {
    provider: "claude",
    authModes: ["claude_subscription"],
    modelId: AGENT_MODEL_POLICY.mapping.anthropic.modelId,
    effort: AGENT_MODEL_POLICY.mapping.anthropic.effort,
    label: "Claude Fable 5.1",
    ready: true,
  },
  {
    provider: "codex",
    authModes: ["chatgpt", "apiKey"],
    modelId: AGENT_MODEL_POLICY.mapping.openai.modelId,
    effort: AGENT_MODEL_POLICY.mapping.openai.effort,
    label: "GPT-6 Astra",
    ready: false,
  },
] as const;
export type MapPackageRunner = (typeof MAP_PACKAGE_RUNNERS)[number];

export function mapPackageRunnerFor(provider: string): MapPackageRunner | null {
  return MAP_PACKAGE_RUNNERS.find((runner) => runner.provider === provider) ?? null;
}

export type MapPackageState = "queued" | "running" | "uploading" | "ready" | "failed" | "cancelled" | "interrupted";
export const MAP_PACKAGE_ACTIVE_STATES: readonly MapPackageState[] = ["queued", "running", "uploading"];
