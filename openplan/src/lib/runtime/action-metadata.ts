import type { AssistantQuickLink, AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";

export type ActionApproval = "safe" | "review" | "approval_required";
export type RegroundingMode = "refresh_preview" | "none";

export type ActionMetadata<K extends AssistantQuickLinkExecuteAction["kind"]> = {
  kind: K;
  approval: ActionApproval;
  auditEvent: string;
  regrounding: RegroundingMode;
  /** Plain-language description of what the action will create or change, shown in approval UI. */
  description: string;
};

type ActionMetadataRegistry = {
  [K in AssistantQuickLinkExecuteAction["kind"]]: ActionMetadata<K>;
};

export const ACTION_METADATA: ActionMetadataRegistry = {
  generate_report_artifact: {
    kind: "generate_report_artifact",
    description: "Generates a new report packet artifact from the current grounded evidence and stores it on the report.",
    approval: "safe",
    auditEvent: "planner_agent.generate_report_artifact",
    regrounding: "refresh_preview",
  },
  create_rtp_packet_record: {
    kind: "create_rtp_packet_record",
    description: "Creates a new RTP packet report record linked to the selected cycle.",
    approval: "review",
    auditEvent: "planner_agent.create_rtp_packet_record",
    regrounding: "refresh_preview",
  },
  create_funding_opportunity: {
    kind: "create_funding_opportunity",
    description: "Creates a new funding opportunity record in this workspace.",
    approval: "approval_required",
    auditEvent: "planner_agent.create_funding_opportunity",
    regrounding: "none",
  },
  create_project_funding_profile: {
    kind: "create_project_funding_profile",
    description: "Creates a funding-need profile record for the selected project.",
    approval: "approval_required",
    auditEvent: "planner_agent.create_project_funding_profile",
    regrounding: "none",
  },
  update_funding_opportunity_decision: {
    kind: "update_funding_opportunity_decision",
    description: "Updates the recorded pursue/decline decision on an existing funding opportunity.",
    approval: "approval_required",
    auditEvent: "planner_agent.update_funding_opportunity_decision",
    regrounding: "none",
  },
  link_billing_invoice_funding_award: {
    kind: "link_billing_invoice_funding_award",
    description: "Links an existing reimbursement invoice to a funding award record.",
    approval: "approval_required",
    auditEvent: "planner_agent.link_billing_invoice_funding_award",
    regrounding: "none",
  },
  record_stage_gate_hold: {
    kind: "record_stage_gate_hold",
    description:
      "Records a HOLD on one stage gate for the selected project, with the stated rationale and any cited run. It cannot record a PASS — an affirmative gate verdict is a person's signature, not the agent's.",
    approval: "approval_required",
    auditEvent: "planner_agent.record_stage_gate_hold",
    // The gate board reads from the decision log, not from the assistant
    // preview, and a fresh hold changes what the next honest move is — so the
    // preview is re-grounded rather than left describing the pre-hold state.
    regrounding: "refresh_preview",
  },
  create_project_record: {
    kind: "create_project_record",
    description: "Creates a new project record in this workspace.",
    approval: "approval_required",
    auditEvent: "planner_agent.create_project_record",
    regrounding: "none",
  },
  refresh_gtfs_feed: {
    kind: "refresh_gtfs_feed",
    description:
      "Fetches the selected transit feed again from the address already recorded for it, and stores the result as a new version. It cannot supply an address, and it cannot adopt a refetch the collapse check withholds.",
    // `approval_required`, NOT `review`, and this reverses the tier this action
    // was first planned with. `review` shows no approval dialog at all:
    // `app-copilot.tsx` routes only `approval_required` through
    // `requestActionApproval`, a `review` action goes to
    // `requestActionExecutionFingerprint` with `requireApproval: false`, the
    // approvals route mints no row, and `verifyAssistantActionApproval`
    // short-circuits without ever comparing the client's hash. An action that
    // triggers an OUTBOUND FETCH to a third party — and that can change which
    // service data an entire workspace analyses with — has to be consented to by
    // a person who saw which feed it names.
    approval: "approval_required",
    auditEvent: "planner_agent.refresh_gtfs_feed",
    // A completed refetch moves the very fact the offer was keyed on: the
    // service window of the version this workspace analyses with. A preview left
    // describing the pre-refresh state would keep offering the refresh that just
    // happened.
    regrounding: "refresh_preview",
  },
};

export function getActionMetadata<K extends AssistantQuickLinkExecuteAction["kind"]>(
  kind: K
): ActionMetadata<K> {
  return ACTION_METADATA[kind];
}

export function resolveQuickLinkApproval(link: AssistantQuickLink): ActionApproval {
  return link.executeAction ? getActionMetadata(link.executeAction.kind).approval : (link.approval ?? "safe");
}

export function resolveQuickLinkAuditEvent(link: AssistantQuickLink): string | undefined {
  return link.executeAction ? getActionMetadata(link.executeAction.kind).auditEvent : link.auditEvent;
}

export function canonicalizeActionPayload(value: unknown): string {
  return JSON.stringify(sortCanonicalValue(value));
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortCanonicalValue(entryValue)])
  );
}
