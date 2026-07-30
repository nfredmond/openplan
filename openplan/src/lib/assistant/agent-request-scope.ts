/**
 * A NARROW ACTION MAY NOT RIDE A WIDE ROUTE.
 *
 * This is the sharpest failure mode in the whole action seam, and it is silent.
 *
 * A route's request body is usually wider than any one registered action's
 * payload — `PATCH /api/engagement/campaigns/{id}` accepts a title, a status, a
 * geofence and a place; `POST /api/stage-gates/decisions` accepts PASS as well
 * as HOLD. The approval hash is computed from the ACTION, which the route
 * reconstructs from its own parsed data. So a request that carries the action's
 * fields AND extra ones hashes identically to the action a planner approved,
 * passes verification, and then writes the extras too.
 *
 * The planner saw three accessibility fields in the approval sheet and got a
 * campaign whose status also changed. Nothing in the hash machinery catches
 * that: the hash is over what the planner approved, not over what the request
 * asked for, and those are only the same thing if something makes them so.
 *
 * This is that something. An agent-sourced request may carry the keys its action
 * declares and nothing else. Manual requests are untouched — a person using the
 * full endpoint is using the endpoint.
 *
 * WHY RAW KEYS AND NOT PARSED ONES. Zod strips unknown keys, so a check over
 * parsed data would silently pass for a field the schema does not know while the
 * dangerous case — a field the schema DOES know, like `status` — is exactly the
 * one that matters. Reading the raw body catches both, and the refusal can name
 * the offending key.
 */

export type AgentRequestScopeRefusal = {
  error: string;
  details: string;
  rejectedKeys: string[];
};

export function refuseOutOfScopeAgentRequest(params: {
  executionSource: "manual" | "planner_agent_quick_link";
  /** The raw request body, before validation. */
  body: unknown;
  /** Exactly the keys the registered action's payload maps onto this endpoint. */
  allowedKeys: readonly string[];
  /** How the refusal names the action, e.g. "record_stage_gate_hold". */
  actionKind: string;
}): AgentRequestScopeRefusal | null {
  if (params.executionSource !== "planner_agent_quick_link") return null;
  if (!params.body || typeof params.body !== "object" || Array.isArray(params.body)) return null;

  const allowed = new Set(params.allowedKeys);
  const rejectedKeys = Object.keys(params.body as Record<string, unknown>).filter(
    (key) => !allowed.has(key)
  );

  if (rejectedKeys.length === 0) return null;

  return {
    error: "Planner Agent action carried fields outside its own payload",
    details:
      `The ${params.actionKind} action may only send ${[...allowed].sort().join(", ")}. ` +
      `This request also carried ${rejectedKeys.sort().join(", ")}, which is not part of what a planner ` +
      "approved, so nothing was written. Use the endpoint directly to change those fields.",
    rejectedKeys,
  };
}
