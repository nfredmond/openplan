/**
 * The Planner Agent's identity, as a principal distinct from the person at the
 * keyboard.
 *
 * WHY THIS EXISTS. Until now the only trace of the agent in the action ledger
 * was `execution_source = 'planner_agent_quick_link'` — a fact about the
 * TRANSPORT, sitting next to a `user_id` that named a person. Read back, a row
 * said a planner created a funding opportunity. What actually happened is that a
 * language model composed it and a planner approved it. Both facts belong in the
 * record, and only one of them was there.
 *
 * The identifier is a stable machine string rather than a display label because
 * it is written into an audit column that will outlive this UI. When the agent
 * eventually holds its own credential — a Buzz member keypair, or anything else
 * that can be verified rather than asserted — that principal is a NEW value
 * here, not a schema change and not a rewrite of rows already written under this
 * one.
 *
 * WHAT THIS IS NOT. `actorKind` is derived server-side from the request's
 * execution source. It is trustworthy to exactly the degree the execution-source
 * header is, which is: it can only be set by something already authenticated as
 * this user, and setting it can only ever ADD an agent attribution, never remove
 * one. It is not a cryptographic attestation and no surface may present it as
 * one.
 */

export const ASSISTANT_ACTOR_KINDS = ["user", "planner_agent"] as const;
export type AssistantActorKind = (typeof ASSISTANT_ACTOR_KINDS)[number];

/**
 * The stable identifier of the in-app Planner Agent principal.
 *
 * Namespaced so a deployment reading its own ledger can tell OpenPlan's built-in
 * agent apart from anything else that might one day write through the same seam.
 */
export const PLANNER_AGENT_PRINCIPAL_ID = "openplan.planner_agent";

/** How the agent principal is named to a person reading the ledger. */
export const PLANNER_AGENT_PRINCIPAL_LABEL = "Planner Agent";

/**
 * The authorship half of an action record: who composed it, and who consented.
 *
 * Kept as one shape rather than four loose fields so a route cannot thread three
 * of them and forget the fourth — the failure that would put an agent-authored
 * write into the ledger wearing a person's name.
 */
export type AssistantActionAuthorship = {
  actorKind: AssistantActorKind;
  /** Non-null exactly when `actorKind` is not `"user"`. */
  actorAgentId: string | null;
  /** The person who approved, when the action's tier required approval. */
  approvedByUserId: string | null;
  /** When they approved — not when the action executed. */
  approvedAt: string | null;
};

/** Authorship for a write a person composed themselves. */
export const USER_AUTHORED: AssistantActionAuthorship = {
  actorKind: "user",
  actorAgentId: null,
  approvedByUserId: null,
  approvedAt: null,
};

/**
 * Authorship for a write the Planner Agent composed.
 *
 * `approvedByUserId`/`approvedAt` are null for the `safe` and `review` tiers,
 * and that null is the honest answer rather than a gap: nobody approved it,
 * because the tier did not ask anyone to.
 */
export function plannerAgentAuthored(approval: {
  approvedByUserId: string | null;
  approvedAt: string | null;
}): AssistantActionAuthorship {
  // Both or neither, matching the database CHECK. A half-recorded consent — an
  // approver with no time, or a time with no approver — is not a weaker record
  // of approval, it is an unreadable one, and it would fail the insert anyway.
  const paired = Boolean(approval.approvedByUserId && approval.approvedAt);
  return {
    actorKind: "planner_agent",
    actorAgentId: PLANNER_AGENT_PRINCIPAL_ID,
    approvedByUserId: paired ? approval.approvedByUserId : null,
    approvedAt: paired ? approval.approvedAt : null,
  };
}

/** One sentence naming both principals, for a ledger row or a record's own metadata. */
export function describeAssistantAuthorship(authorship: AssistantActionAuthorship): string {
  if (authorship.actorKind === "user") return "Composed by a workspace member.";
  const drafted = `Drafted by the ${PLANNER_AGENT_PRINCIPAL_LABEL} (${authorship.actorAgentId ?? "unidentified agent"}).`;
  if (!authorship.approvedByUserId || !authorship.approvedAt) {
    return `${drafted} No separate approval was required for this action's tier.`;
  }
  return `${drafted} Approved by a workspace member at ${authorship.approvedAt}.`;
}
