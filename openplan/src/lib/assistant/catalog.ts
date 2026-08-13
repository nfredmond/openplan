import { resolveQuickLinkApproval } from "@/lib/runtime/action-metadata";

/**
 * EVERY SURFACE THE ASSISTANT CAN BE ASKED ABOUT — the one list, at runtime.
 *
 * ═══ WHY THIS IS A VALUE AND NOT JUST A TYPE ═══
 *
 * It used to be a bare union here, and the two places that need the names at
 * RUNTIME each wrote them out again: `chat-tools.ts` (the `load_surface_context`
 * tool's enum) and `app/api/assistant/context/route.ts` (the query schema). The
 * route's copy stopped at "run" and never gained the seven module lanes added by
 * the contexts lane, so the API rejected `grants`, `invoicing`, `engagement`,
 * `safety`, `aerial`, `knowledge_base` and `data_hub` — 7 of 19 — with
 * `400 Invalid assistant context query`.
 *
 * `loadAssistantContext` handled all seven perfectly well. The only thing wrong
 * was a hand-written list that could not see the type it was copying. Measured
 * in Chrome on 2026-08-13: one load of /safety fired eleven identical failing
 * requests and printed eleven console errors, and the Planner Agent got no
 * context for the page it was sitting on.
 *
 * The type is now DERIVED from this array, so a kind that exists is a kind both
 * runtime schemas accept: adding one here is the whole change, and there is no
 * second list left to forget.
 */
export const ASSISTANT_TARGET_KINDS = [
  "workspace",
  "analysis_studio",
  "project",
  "rtp_registry",
  "rtp_cycle",
  "plan",
  "program",
  "scenario_set",
  "model",
  "report",
  "rtp_packet_report",
  "run",
  // Module lanes (workspace-scoped; id optional) added by the contexts lane.
  "grants",
  "invoicing",
  "engagement",
  "safety",
  "aerial",
  "knowledge_base",
  "data_hub",
] as const;

export type AssistantTargetKind = (typeof ASSISTANT_TARGET_KINDS)[number];

export type AssistantTarget = {
  kind: AssistantTargetKind;
  id: string | null;
  workspaceId: string | null;
  runId: string | null;
  baselineRunId: string | null;
};

export type AssistantAction = {
  id: string;
  label: string;
  description: string;
  prompt: string;
};

export type AssistantPreviewStat = {
  label: string;
  value: string;
};

export type AssistantQuickLinkExecuteAction =
  | {
      kind: "generate_report_artifact";
      reportId: string;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  | {
      kind: "create_rtp_packet_record";
      rtpCycleId: string;
      modelingCountyRunId?: string | null;
      generateAfterCreate?: boolean;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  | {
      kind: "create_funding_opportunity";
      programId?: string;
      projectId?: string;
      title: string;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  | {
      kind: "create_project_funding_profile";
      projectId: string;
      notes?: string;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  | {
      kind: "update_funding_opportunity_decision";
      opportunityId: string;
      decisionState: "monitor" | "pursue" | "skip";
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  | {
      kind: "create_project_record";
      projectId: string;
      recordType: "submittal";
      title: string;
      submittalType?: "authorization_packet" | "invoice_backup" | "environmental_package" | "hearing_record" | "ps_e" | "reimbursement" | "progress_report" | "other";
      status?: "draft" | "internal_review" | "submitted" | "accepted" | "revise_and_resubmit";
      notes?: string;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  /**
   * Record a HOLD on a stage gate — and ONLY a hold.
   *
   * There is deliberately no `decision` field on this payload. The gate log
   * accepts PASS and HOLD; an agent may propose exactly one of them, and the
   * exclusion is expressed in the TYPE rather than in a validator, so there is
   * no value an agent-authored payload could carry that would produce a PASS.
   *
   * WHY THE ASYMMETRY IS THE WHOLE POINT. A PASS is the affirmative judgement a
   * board or a funder relies on to let a project advance; a HOLD is
   * conservative, and the log is append-only, so a HOLD that turns out to be
   * wrong is corrected by the PASS that supersedes it — which a person records.
   * An agent that could sign the affirmative verdict would be signing under a
   * planner's name (`stage_gate_decisions.decided_by`), which is the
   * impersonation this seam exists to end.
   *
   * The route enforces the same rule independently: an agent-sourced request
   * carrying `decision: "PASS"` is refused there too, because a type is not a
   * boundary once a payload crosses the wire.
   */
  | {
      kind: "record_stage_gate_hold";
      workspaceId: string;
      projectId: string;
      gateId: string;
      rationale: string;
      /** Evidence ids the agent believes are still outstanding. */
      missingArtifacts?: string[];
      /** At most one cited run, each verified against this workspace before the proposal is emitted. */
      runId?: string;
      modelRunId?: string;
      countyRunId?: string;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  | {
      kind: "link_billing_invoice_funding_award";
      workspaceId: string;
      invoiceId: string;
      fundingAwardId: string;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  | {
      /**
       * Fetch a transit feed again from the address the DATABASE already holds.
       *
       * TWO IDS AND NOTHING ELSE, and that is the entire argument for why this
       * one is registrable when `ingest a feed from a URL` is refused. Every
       * value that decides what happens — the download address, the catalog
       * provider, the agency's name, whether a catalog row has been superseded —
       * is read by the route off the feed row the planner already chose. The
       * model authors no URL, no host, no operator and no content.
       *
       * WHAT IS DELIBERATELY ABSENT: `adoptDespiteCollapse`. The endpoint takes
       * it; this action may never send it. `promoteGtfsFeedVersion` withholds a
       * refetch that is materially smaller than the feed in use, because a drop
       * that size is as likely to be a truncated download as a real service cut,
       * and an agent optimising for "the refresh completed" would set that flag
       * every time — which is precisely the incentive the collapse rule exists to
       * defeat. Leaving it out of this variant is necessary and NOT sufficient:
       * the approval hash covers the action the route rebuilds, not the request
       * body, so the route also runs `refuseOutOfScopeAgentRequest`.
       */
      kind: "refresh_gtfs_feed";
      workspaceId: string;
      gtfsFeedId: string;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  | {
      /**
       * Write a survey question that is NOT asked of anybody until a person
       * releases it.
       *
       * THIS IS THE FIRST REGISTERED ACTION WHOSE CONSEQUENTIAL CONTENT THE
       * MODEL AUTHORS, and it is registered anyway — by Nathaniel's decision of
       * 2026-08-03 — because of what `status = 'draft'` does to the argument
       * that refused the others.
       *
       * The campaign accessibility contact was refused because its only control
       * was an approver noticing a plausible wrong phone number on a sheet, and
       * the moment it was approved it was published under the agency's name. The
       * machine-translation actions were refused because accepting one deletes
       * the caveat a resident was reading. In both, approval and publication are
       * the same event, so review has to happen in the approval dialog or not at
       * all. Here they are separate events: approving this action puts wording in
       * the survey builder, where it sits with a "Draft — not public" badge until
       * somebody opens it, reads it in place, and presses publish. The review
       * surface is the product, not a dialog — which is the only form of review
       * that works for prose.
       *
       * WHAT IS DELIBERATELY ABSENT, and why each one:
       *
       *   `status`      — not a field. The route writes the literal, so there is
       *                   no value to transmit and no default to flip. The PATCH
       *                   that publishes is not a registered action at all, so
       *                   no approval an agent can obtain reaches it.
       *   `config`      — a question's condition graph lives in here. An agent
       *                   authoring one could gate an existing published question
       *                   on its own new draft.
       *   `sortOrder`   — position decides which questions may gate which, since
       *                   only earlier questions can. Writing it is editing the
       *                   graph by other means.
       *   `required`    — making a question mandatory changes what a resident
       *                   must answer to be heard at all. That is a burden on the
       *                   public, and it is not this action's to impose.
       *   `categoryId`  — filing is an editorial judgement about the agency's own
       *                   taxonomy, and it moves the question between sections a
       *                   resident navigates.
       *
       * Every one of those is available in the builder to the person who
       * publishes. The agent proposes wording; the planner decides everything
       * about how it is asked.
       */
      kind: "create_survey_question_draft";
      workspaceId: string;
      campaignId: string;
      questionType: string;
      prompt: string;
      helpText?: string;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  | {
      /**
       * Re-queue an EXISTING model run to the modeling worker.
       *
       * THE FIRST MODELING ACTION IN THE REGISTRY, and it is registerable
       * because of what the target route refuses rather than because of what
       * this payload omits. Three ids, all verified against workspace rows; the
       * model authors nothing. The route
       * (`/api/models/[modelId]/runs/[modelRunId]/launch`) accepts NO BODY at
       * all — study area, engine and zone geography are read off the run row
       * that a person created.
       *
       * WHY GATE-SHOPPING IS NOT AVAILABLE HERE, which is the question that
       * matters for a modeling action. A screening claim is derived from a
       * count comparison, so an agent able to re-roll a run until the numbers
       * land well would be manufacturing the tier the honesty firewall exists to
       * protect. Three properties of the route close that off, and all three are
       * structural rather than conventions:
       *
       *   - a SUCCEEDED run cannot be relaunched (400). Once a run has produced
       *     a gate, that gate stands; there is no second roll of the same dice.
       *   - the zone geography is read from the run's own `input_snapshot_json`
       *     specifically "so a relaunch of a stamped run cannot quietly change
       *     the zone geography" — the one launch parameter that moves the
       *     intrazonal share, and therefore the one that could flip a run from
       *     "link comparison cannot settle this" to a screening claim.
       *   - only `failed`/`queued`/`cancelled` runs are relaunchable, and none
       *     of those carries a gate to improve on.
       *
       * So the reachable use is the honest one: a run that failed for a reason
       * a planner has now fixed — no Census key, no study area, worker offline —
       * is retried. That is the recovery the worker's own error text tells them
       * to perform.
       *
       * NOT REGISTERED, and deliberately: creating a NEW run (`POST /runs`)
       * takes a full body including the study area, the engine and the zone
       * geography. Every argument above depends on the agent supplying none of
       * those, so the create path is a different action that would have to be
       * argued on its own terms.
       */
      kind: "launch_model_run";
      workspaceId: string;
      modelId: string;
      modelRunId: string;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    }
  | {
      /**
       * Scaffold an empty RTP cycle's horizon periods from its OWN declared
       * horizon — the one band-creation shape the 2026-08-05 analysis
       * permitted, registered in its derived form only.
       *
       * Every sibling of this action was refused, and the refusals are what
       * define this payload. Authoring a band's years is an authored phasing
       * judgement; authoring its escalation year switches off the public
       * document's "midpoint assumed" caveat (a caveat deletion on a public
       * page — the machine-translation refusal wearing another module's
       * clothes); deleting a band detaches programmed projects. So this
       * variant carries NO label, NO years, NO escalation year, NO cost
       * basis, NO sort order: the route computes every year from
       * `rtp_cycles.horizon_start_year/horizon_end_year` (refusing when the
       * cycle has not declared them), derives the labels from those years,
       * and writes `escalation_target_year` as a literal `null` with no code
       * path able to set it — pinned by
       * `rtp-scaffolded-bands-carry-no-escalation-year.test.ts`.
       *
       * `bandingProfileKey` is the one choice the payload carries, and it is
       * a key into the closed in-repo registry
       * (`@/lib/rtp/horizon-banding-profiles`), not authored content — the
       * same shape as an enum. The route refuses a cycle that already has
       * periods, so the scaffold only ever writes into an empty plan, and
       * every row it writes is the agency's to rename, re-year, or delete in
       * the band editor (Nathaniel's recorded decision: bands are
       * agency-defined; a scaffold proposes, it never locks).
       */
      kind: "create_rtp_horizon_bands_from_cycle_horizon";
      workspaceId: string;
      rtpCycleId: string;
      bandingProfileKey: string;
      postActionWorkflowId?: string;
      postActionPrompt?: string;
      postActionPromptLabel?: string;
    };

export type AssistantQuickLink = {
  id: string;
  label: string;
  href: string;
  targetKind: AssistantTargetKind;
  actionClass: "open_surface" | "review_controls" | "review_analysis" | "review_packet" | "inspect_readiness";
  executionMode: "navigate" | "future_agent_action";
  priority?: "primary" | "secondary" | "supporting";
  statusLabel?: string;
  reason?: string;
  approval?: "safe" | "review" | "approval_required";
  auditEvent?: string;
  auditNote?: string;
  workflowId?: string;
  prompt?: string;
  promptLabel?: string;
  executeAction?: AssistantQuickLinkExecuteAction;
};

export type AssistantOperationUrgency = "high" | "medium" | "low";
export type AssistantOperationTone = "danger" | "warning" | "info" | "success" | "neutral";
export type AssistantOperationGroupKey = "act_now" | "review_soon" | "support_context";
export type AssistantOperationGroup = {
  key: AssistantOperationGroupKey;
  label: string;
  description: string;
  items: AssistantQuickLink[];
};

export type AssistantOperationLead = {
  label: string;
  detail: string;
  statusLabel?: string;
};

export type AssistantOperationSummary = {
  total: number;
  actNow: number;
  reviewSoon: number;
  supportContext: number;
  approvalRequired: number;
  leadOperation: AssistantOperationLead | null;
};

export type AssistantOperationExecutionSummary = {
  navigateOnly: number;
  futureAgentAction: number;
  safe: number;
  review: number;
  approvalRequired: number;
};

export type AssistantBoardStateCue = {
  label: string;
  title: string;
  detail: string;
  items?: string[];
};

export type AssistantPreview = {
  kind: AssistantTargetKind;
  title: string;
  summary: string;
  stats: AssistantPreviewStat[];
  facts: string[];
  operatorCue?: AssistantBoardStateCue;
  boardStateCue?: AssistantBoardStateCue;
  quickLinks?: AssistantQuickLink[];
  suggestedActions: AssistantAction[];
};

export type AssistantResponse = {
  workflowId: string;
  label: string;
  title: string;
  summary: string;
  findings: string[];
  nextSteps: string[];
  evidence: string[];
  caution?: string;
  boardStateCue?: AssistantBoardStateCue;
  quickLinks?: AssistantQuickLink[];
};

const ACTIONS_BY_KIND: Record<AssistantTargetKind, AssistantAction[]> = {
  workspace: [
    {
      id: "workspace-overview",
      label: "Workspace overview",
      description: "Summarize the active planning workspace and recent activity.",
      prompt: "Give me the workspace brief and what to do next.",
    },
    {
      id: "workspace-funding",
      label: "Where the funding gaps are",
      description: "Show which projects still have a funding gap.",
      prompt: "Which project funding gaps need attention across this workspace, and where should I start?",
    },
    {
      id: "analysis-focus",
      label: "Analysis focus",
      description: "Point at the analysis most worth reading right now.",
      prompt: "Which analysis should I look at next, and why?",
    },
  ],
  analysis_studio: [
    {
      id: "analysis-focus",
      label: "Studio brief",
      description: "Summarize the current analysis posture and attached run context.",
      prompt: "Summarize the current Analysis Studio posture and what I should review next.",
    },
    {
      id: "run-compare",
      label: "Compare runs",
      description: "Explain current-vs-baseline movement when both runs are present.",
      prompt: "Compare the current run against the baseline and call out the important score shifts.",
    },
  ],
  project: [
    {
      id: "project-brief",
      label: "Project brief",
      description: "Summarize status, controls, and decision-useful context for the project.",
      prompt: "Give me the project brief and the next operator move.",
    },
    {
      id: "project-blockers",
      label: "Blockers",
      description: "Surface open risks, issues, and gate blockers.",
      prompt: "What is blocking this project right now?",
    },
    {
      id: "project-funding",
      label: "Funding posture",
      description: "Show funding-gap pressure, linked opportunities, and grant timing around this project.",
      prompt: "What funding opportunities or funding gaps need action on this project right now?",
    },
    {
      id: "project-data",
      label: "Data readiness",
      description: "Show linked dataset coverage and run support around this project.",
      prompt: "How strong is the data and analysis support for this project?",
    },
  ],
  rtp_registry: [
    {
      id: "rtp-registry-brief",
      label: "RTP registry brief",
      // NOT "overdue". In this codebase `overdue` means past a RECORDED
      // deadline (`lib/work/deadlines.ts`, funding decisions, work
      // notifications) — a board packet has no such date. What the brief
      // actually counts is packets that need regenerating and cycles that never
      // had one, which is what this now says.
      description:
        "Summarize the RTP cycle registry, which board packets need regenerating or have never been made, and the next operator move.",
      prompt: "Give me the RTP registry brief and the next operator move.",
    },
    {
      id: "rtp-registry-generate",
      label: "Cycles with no board packet yet",
      description: "Explain which RTP cycles still need their first board packet and where to start.",
      prompt: "Which RTP cycles still need a first board packet, and where should I start?",
    },
    {
      id: "rtp-registry-refresh",
      label: "Refresh queue",
      description: "Explain which RTP board packets are furthest out of date across the registry.",
      prompt: "Which RTP packets are stale across the registry, and what should I refresh first?",
    },
    {
      id: "rtp-registry-release",
      label: "Release-review queue",
      description: "Explain which RTP packets are current enough for release review and which cycle should be checked first.",
      prompt: "Which RTP packet is most ready for release review right now, and what should I verify before release?",
    },
  ],
  rtp_cycle: [
    {
      id: "rtp-brief",
      label: "RTP brief",
      description: "Summarize cycle readiness, the state of its board packet, and the next operator move.",
      prompt: "Give me the RTP cycle brief and the next operator move.",
    },
    {
      id: "rtp-packet-generate",
      label: "What the first board packet needs",
      description: "Explain what the cycle still needs before creating its first RTP board packet.",
      prompt: "What does this RTP cycle need before creating its first board packet?",
    },
    {
      id: "rtp-packet-refresh",
      label: "Refresh plan",
      description: "Explain what changed and what should be verified before refreshing the RTP board packet for this cycle.",
      prompt: "What changed in this RTP cycle, and what should I verify before refreshing its board packet?",
    },
    {
      id: "rtp-packet-release",
      label: "Release review",
      description: "Explain whether the current RTP packet is ready for board/public review and what still needs checking.",
      prompt: "Is this RTP cycle's current board packet ready for release review, and what should I verify first?",
    },
  ],
  plan: [
    {
      id: "plan-brief",
      label: "Plan brief",
      description: "Summarize plan readiness, linked evidence, and the next operator move.",
      prompt: "Give me the plan brief and the next operator move.",
    },
    {
      id: "plan-gaps",
      label: "Plan gaps",
      description: "Surface what this plan is still missing before it is trustworthy for handoff.",
      prompt: "What is this plan still missing, and what should I fix next?",
    },
  ],
  program: [
    {
      id: "program-brief",
      label: "Program brief",
      description: "Summarize package readiness, packet posture, and linked funding context.",
      prompt: "Give me the program brief and the next operator move.",
    },
    {
      id: "program-packet",
      label: "Packet posture",
      description: "Explain packet readiness, stale basis, and what should be refreshed or created next.",
      prompt: "What packet or evidence work does this program need next?",
    },
    {
      id: "program-funding",
      label: "Funding posture",
      description: "Explain which linked funding opportunities need attention and how they affect this package.",
      prompt: "Which funding opportunities tied to this package need action next, and why?",
    },
  ],
  scenario_set: [
    {
      id: "scenario-compare",
      label: "Scenario compare",
      description: "Summarize which alternatives materially move the scorecard.",
      prompt: "Compare the ready alternatives against baseline and tell me what moved.",
    },
    {
      id: "scenario-handoff",
      label: "Handoff path",
      description: "Explain what is ready for Analysis Studio or reporting handoff.",
      prompt: "What scenario evidence is actually ready to hand off into studio or reporting?",
    },
  ],
  model: [
    {
      id: "model-readiness",
      label: "Model readiness",
      description: "Summarize config, linkage, and execution readiness.",
      prompt: "Is this model ready for serious use, and what still needs work?",
    },
    {
      id: "model-launch",
      label: "Launch plan",
      description: "Recommend the next launch or validation step from the current model record.",
      prompt: "What is the safest useful next launch step for this model?",
    },
  ],
  report: [
    {
      id: "report-audit",
      label: "Report audit",
      description: "Summarize source runs, sections, and artifact posture.",
      prompt: "Audit this report for provenance and source posture.",
    },
    {
      id: "report-release",
      label: "Release check",
      description: "Call out what still needs review before sharing the packet.",
      prompt: "Is this report ready for release review, and what still needs verification?",
    },
  ],
  rtp_packet_report: [
    {
      id: "rtp-packet-audit",
      label: "RTP packet audit",
      description: "Summarize RTP board-packet provenance, cycle linkage, and artifact posture.",
      prompt: "Audit this RTP packet for cycle provenance, packet freshness, and board-packet posture.",
    },
    {
      id: "rtp-packet-generate",
      label: "First packet plan",
      description: "Explain what is missing before generating the first RTP board packet artifact.",
      prompt: "What does this RTP packet need before generating its first board packet artifact?",
    },
    {
      id: "rtp-packet-refresh",
      label: "Refresh plan",
      description: "Explain what changed and what should be checked before regenerating a stale RTP board packet.",
      prompt: "What changed since the last RTP packet generation, and what should I verify before refreshing it?",
    },
    {
      id: "rtp-packet-release",
      label: "RTP release check",
      description: "Call out what still needs review before this RTP board packet is ready for board or public use.",
      prompt: "Is this RTP board packet ready for release review, and what still needs verification before release?",
    },
  ],
  run: [
    {
      id: "run-brief",
      label: "Run brief",
      description: "Summarize scores, confidence, and source posture for this run.",
      prompt: "Give me a concise operator brief for this run.",
    },
    {
      id: "run-compare",
      label: "Run compare",
      description: "Compare this run to the attached baseline when available.",
      prompt: "Compare this run to baseline and tell me what changed.",
    },
  ],
  grants: [
    {
      id: "grants-brief",
      label: "Grants brief",
      description: "Summarize funding opportunities, decision states, and award posture across this workspace.",
      prompt: "Give me the grants brief and the next operator move.",
    },
    {
      id: "grants-decision-queue",
      label: "Decision queue",
      description: "Surface opportunities with overdue decisions or closing deadlines.",
      prompt: "Which funding opportunities need a decision or are closing soon?",
    },
    {
      id: "grants-awards",
      label: "Award posture",
      description: "Summarize recorded awards, spending status, and risk flags.",
      prompt: "What is the state of this workspace's funding awards?",
    },
  ],
  invoicing: [
    {
      id: "invoicing-brief",
      label: "Invoicing brief",
      description: "Summarize funder reimbursements and client receivables for this workspace.",
      prompt: "Give me the invoicing brief and the next operator move.",
    },
    {
      id: "invoicing-reimbursements",
      label: "Reimbursement queue",
      description: "Explain which grant-reimbursement invoices are outstanding, by funding award.",
      prompt: "Which reimbursement invoices are still outstanding, and against which awards?",
    },
    {
      id: "invoicing-receivables",
      label: "Receivables posture",
      description: "Summarize client invoices — what is drafted, sent, and unpaid.",
      prompt: "What is outstanding in client receivables right now?",
    },
  ],
  engagement: [
    {
      id: "engagement-brief",
      label: "Engagement brief",
      description: "Summarize campaigns by publication state and open public windows.",
      prompt: "Give me the engagement brief and the next operator move.",
    },
    {
      id: "engagement-moderation",
      label: "Moderation queue",
      description: "Report how many public submissions are pending or flagged for moderation.",
      prompt: "What is waiting in the engagement moderation queue?",
    },
    {
      id: "engagement-publication",
      label: "Publication state",
      description: "Explain which campaigns are live, staged as drafts, or closed.",
      prompt: "Which engagement campaigns are live right now, and which are still drafts?",
    },
  ],
  safety: [
    {
      id: "safety-brief",
      label: "Safety brief",
      description: "Summarize crash imports, coverage, and the latest ingest's posture.",
      prompt: "Give me the safety data brief and the next operator move.",
    },
    {
      id: "safety-coverage",
      label: "Coverage check",
      description: "Explain which years and coverage the crash data actually answers for, and where it is silent.",
      prompt: "What years and geography does our crash data actually cover, and where is it silent?",
    },
    {
      id: "safety-severity",
      label: "Severity mix",
      description: "Report the severity mix of the latest ready crash import, with its completeness caveat.",
      prompt: "What is the severity mix of our latest crash import, and how complete is it?",
    },
  ],
  aerial: [
    {
      id: "aerial-brief",
      label: "Aerial brief",
      description: "Summarize missions by status, processing jobs, and evidence-package readiness.",
      prompt: "Give me the aerial operations brief and the next operator move.",
    },
    {
      id: "aerial-jobs",
      label: "Processing jobs",
      description: "Report active and failed processing jobs and their artifact custody state.",
      prompt: "What aerial processing jobs are active or failed, and is artifact custody complete?",
    },
    {
      id: "aerial-packages",
      label: "Package readiness",
      description: "Explain which evidence packages are ready or shared, and which are still in QA.",
      prompt: "Which aerial evidence packages are ready to use as evidence?",
    },
  ],
  knowledge_base: [
    {
      id: "knowledge-base-brief",
      label: "Knowledge base brief",
      description: "Summarize the document corpus — counts by status and project linkage.",
      prompt: "Give me the knowledge base brief and the next operator move.",
    },
    {
      id: "knowledge-base-extraction",
      label: "Extraction failures",
      description: "Report documents whose text extraction failed and cannot be retrieved from.",
      prompt: "Which knowledge base documents failed extraction and need attention?",
    },
  ],
  data_hub: [
    {
      id: "data-hub-brief",
      label: "Data hub brief",
      description: "Summarize datasets, connectors, transit feeds, and refresh-job posture.",
      prompt: "Give me the data hub brief and the next operator move.",
    },
    {
      id: "data-hub-feeds",
      label: "Feed states",
      description: "Explain transit feed and connector states — what is current, degraded, or erroring.",
      prompt: "What is the state of our data connectors and transit feeds?",
    },
    {
      id: "data-hub-refresh",
      label: "Refresh posture",
      description: "Report recent refresh jobs and any failures.",
      prompt: "Have any recent data refresh jobs failed, and what should I re-run?",
    },
  ],
};

export function getAssistantActions(kind: AssistantTargetKind): AssistantAction[] {
  return ACTIONS_BY_KIND[kind] ?? ACTIONS_BY_KIND.workspace;
}

export function formatAssistantOperationActionClass(link: AssistantQuickLink): string {
  switch (link.actionClass) {
    case "review_controls":
      return "Review controls";
    case "review_analysis":
      return "Review analysis";
    case "review_packet":
      return "Review packet";
    case "inspect_readiness":
      return "Inspect readiness";
    case "open_surface":
    default:
      return "Open surface";
  }
}

export function formatAssistantOperationExecutionMode(link: AssistantQuickLink): string {
  if (link.executionMode !== "future_agent_action") return "Navigate only";
  return link.executeAction ? "Execute action" : "Agent action";
}

export function resolveAssistantOperationUrgency(link: AssistantQuickLink): AssistantOperationUrgency {
  const approval = resolveQuickLinkApproval(link);
  if (approval === "approval_required") return "high";
  if (link.priority === "primary" && (link.actionClass === "review_controls" || link.actionClass === "review_packet")) {
    return "high";
  }
  if (link.priority === "primary" || approval === "review" || link.priority === "secondary") {
    return "medium";
  }
  return "low";
}

export function resolveAssistantOperationTone(link: AssistantQuickLink): AssistantOperationTone {
  const approval = resolveQuickLinkApproval(link);
  if (approval === "approval_required") return "danger";
  switch (link.actionClass) {
    case "review_controls":
    case "review_packet":
      return "warning";
    case "review_analysis":
    case "inspect_readiness":
      return "info";
    case "open_surface":
      return approval === "safe" ? "success" : "neutral";
    default:
      return "neutral";
  }
}

function operationUrgencyRank(urgency: AssistantOperationUrgency): number {
  switch (urgency) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
    default:
      return 2;
  }
}

function operationPriorityRank(priority: AssistantQuickLink["priority"]): number {
  switch (priority) {
    case "primary":
      return 0;
    case "secondary":
      return 1;
    case "supporting":
    default:
      return 2;
  }
}

export function compareAssistantOperations(a: AssistantQuickLink, b: AssistantQuickLink): number {
  const urgencyDelta = operationUrgencyRank(resolveAssistantOperationUrgency(a)) - operationUrgencyRank(resolveAssistantOperationUrgency(b));
  if (urgencyDelta !== 0) return urgencyDelta;

  const priorityDelta = operationPriorityRank(a.priority) - operationPriorityRank(b.priority);
  if (priorityDelta !== 0) return priorityDelta;

  return a.label.localeCompare(b.label);
}

function resolveAssistantOperationGroupKey(link: AssistantQuickLink): AssistantOperationGroupKey {
  const urgency = resolveAssistantOperationUrgency(link);
  if (urgency === "high") return "act_now";
  if (urgency === "medium") return "review_soon";
  return "support_context";
}

const ASSISTANT_OPERATION_GROUP_META: Record<AssistantOperationGroupKey, { label: string; description: string }> = {
  act_now: {
    label: "Act now",
    description: "Highest-pressure operator moves. Review these first before drifting into supporting work.",
  },
  review_soon: {
    label: "Review soon",
    description: "Important checks and evidence reads that should happen next, but usually after the hottest queue pressure.",
  },
  support_context: {
    label: "Support context",
    description: "Lower-pressure navigation and context anchors that help you stay grounded while the main work moves.",
  },
};

export function groupAssistantOperations(links: AssistantQuickLink[]): AssistantOperationGroup[] {
  const buckets: Record<AssistantOperationGroupKey, AssistantQuickLink[]> = {
    act_now: [],
    review_soon: [],
    support_context: [],
  };

  for (const link of [...links].sort(compareAssistantOperations)) {
    buckets[resolveAssistantOperationGroupKey(link)].push(link);
  }

  return (["act_now", "review_soon", "support_context"] as AssistantOperationGroupKey[])
    .map((key) => ({
      key,
      label: ASSISTANT_OPERATION_GROUP_META[key].label,
      description: ASSISTANT_OPERATION_GROUP_META[key].description,
      items: buckets[key],
    }))
    .filter((group) => group.items.length > 0);
}

export function summarizeAssistantOperations(links: AssistantQuickLink[]): AssistantOperationSummary {
  let actNow = 0;
  let reviewSoon = 0;
  let supportContext = 0;
  let approvalRequired = 0;

  for (const link of links) {
    const groupKey = resolveAssistantOperationGroupKey(link);
    if (groupKey === "act_now") actNow += 1;
    else if (groupKey === "review_soon") reviewSoon += 1;
    else supportContext += 1;

    if (resolveQuickLinkApproval(link) === "approval_required") approvalRequired += 1;
  }

  const leadLink = [...links].sort(compareAssistantOperations)[0] ?? null;

  return {
    total: links.length,
    actNow,
    reviewSoon,
    supportContext,
    approvalRequired,
    leadOperation: leadLink
      ? {
          label: leadLink.label,
          detail:
            leadLink.reason ??
            leadLink.statusLabel ??
            `${formatAssistantOperationActionClass(leadLink)} is currently the strongest visible operator move.`,
          statusLabel: leadLink.statusLabel,
        }
      : null,
  };
}

export function summarizeAssistantOperationExecution(links: AssistantQuickLink[]): AssistantOperationExecutionSummary {
  let navigateOnly = 0;
  let futureAgentAction = 0;
  let safe = 0;
  let review = 0;
  let approvalRequired = 0;

  for (const link of links) {
    if (link.executionMode === "future_agent_action") futureAgentAction += 1;
    else navigateOnly += 1;

    const approval = resolveQuickLinkApproval(link);
    if (approval === "approval_required") approvalRequired += 1;
    else if (approval === "review") review += 1;
    else safe += 1;
  }

  return {
    navigateOnly,
    futureAgentAction,
    safe,
    review,
    approvalRequired,
  };
}

export function resolveAssistantTarget(
  pathname: string,
  searchParams: Pick<URLSearchParams, "get">
): AssistantTarget {
  const segments = pathname.split("/").filter(Boolean);
  const secondSegment = segments[1] ?? null;
  const currentRunId = searchParams.get("runId");
  const baselineRunId = searchParams.get("baselineRunId");
  const workspaceId = searchParams.get("workspaceId");

  if (segments[0] === "projects" && secondSegment) {
    return { kind: "project", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "rtp" && secondSegment) {
    return { kind: "rtp_cycle", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "rtp") {
    return { kind: "rtp_registry", id: null, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "plans" && secondSegment) {
    return { kind: "plan", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "programs" && secondSegment) {
    return { kind: "program", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "scenarios" && secondSegment) {
    return { kind: "scenario_set", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "models" && secondSegment) {
    return { kind: "model", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "reports" && secondSegment) {
    return { kind: "report", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "explore") {
    return {
      kind: currentRunId ? "run" : "analysis_studio",
      id: currentRunId,
      workspaceId,
      runId: currentRunId,
      baselineRunId,
    };
  }

  // Module lanes. Each resolves the whole subtree — deep children included — to
  // the module's own kind, so a planner on /engagement/<campaignId>/preview gets
  // engagement grounding rather than the generic workspace context these seven
  // modules used to fall back to. The id is the entity the path names when the
  // route has one (engagement campaign, aerial mission) and null on the module
  // roots, whose loaders are workspace-scoped.
  if (segments[0] === "grants") {
    return { kind: "grants", id: null, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "invoicing") {
    return { kind: "invoicing", id: null, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "engagement") {
    return { kind: "engagement", id: secondSegment, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "safety") {
    return { kind: "safety", id: null, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "aerial") {
    // Mission detail lives at /aerial/missions/[missionId]; the register root has no id.
    const missionId = secondSegment === "missions" ? segments[2] ?? null : null;
    return { kind: "aerial", id: missionId, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "knowledge-base") {
    return { kind: "knowledge_base", id: null, workspaceId, runId: null, baselineRunId: null };
  }

  if (segments[0] === "data-hub") {
    return { kind: "data_hub", id: null, workspaceId, runId: null, baselineRunId: null };
  }

  return { kind: "workspace", id: null, workspaceId, runId: currentRunId, baselineRunId };
}

function includesAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

export function resolveAssistantWorkflowId(
  kind: AssistantTargetKind,
  requestedWorkflowId?: string | null,
  question?: string | null
): string {
  const validActions = getAssistantActions(kind);
  if (requestedWorkflowId && validActions.some((action) => action.id === requestedWorkflowId)) {
    return requestedWorkflowId;
  }

  const normalized = (question ?? "").trim().toLowerCase();
  if (!normalized) {
    return validActions[0]?.id ?? "workspace-overview";
  }

  if (kind === "project") {
    if (includesAny(normalized, ["block", "risk", "issue", "hold", "gate"])) return "project-blockers";
    if (includesAny(normalized, ["data", "dataset", "source", "coverage", "overlay"])) return "project-data";
    return "project-brief";
  }

  if (kind === "rtp_cycle") {
    if (includesAny(normalized, ["generate", "first packet", "first artifact", "missing packet", "no packet"])) return "rtp-packet-generate";
    if (includesAny(normalized, ["refresh", "stale", "regenerate", "changed", "drift"])) return "rtp-packet-refresh";
    if (includesAny(normalized, ["release", "board-ready", "board ready", "public", "verify", "share", "release review"])) return "rtp-packet-release";
    return "rtp-brief";
  }

  if (kind === "rtp_registry") {
    if (includesAny(normalized, ["generate", "first packet", "missing packet", "no packet"])) return "rtp-registry-generate";
    if (includesAny(normalized, ["refresh", "stale", "regenerate", "changed", "drift"])) return "rtp-registry-refresh";
    if (includesAny(normalized, ["release", "board-ready", "board ready", "public", "verify", "share", "release review"])) return "rtp-registry-release";
    return "rtp-registry-brief";
  }

  if (kind === "plan") {
    if (includesAny(normalized, ["gap", "missing", "fix", "trust", "ready"])) return "plan-gaps";
    return "plan-brief";
  }

  if (kind === "program") {
    if (includesAny(normalized, ["packet", "report", "refresh", "evidence", "basis"])) return "program-packet";
    return "program-brief";
  }

  if (kind === "scenario_set") {
    if (includesAny(normalized, ["handoff", "report", "studio", "ready"])) return "scenario-handoff";
    return "scenario-compare";
  }

  if (kind === "model") {
    if (includesAny(normalized, ["launch", "run", "validate", "next step"])) return "model-launch";
    return "model-readiness";
  }

  if (kind === "report") {
    if (includesAny(normalized, ["share", "release", "client", "ready", "verify"])) return "report-release";
    return "report-audit";
  }

  if (kind === "rtp_packet_report") {
    if (includesAny(normalized, ["generate", "first packet", "first artifact", "missing artifact", "no packet"])) return "rtp-packet-generate";
    if (includesAny(normalized, ["refresh", "stale", "regenerate", "changed", "drift"])) return "rtp-packet-refresh";
    if (includesAny(normalized, ["share", "release", "board", "public", "ready", "verify"])) return "rtp-packet-release";
    return "rtp-packet-audit";
  }

  if (kind === "run" || kind === "analysis_studio") {
    if (includesAny(normalized, ["compare", "baseline", "delta", "changed"])) return "run-compare";
    return kind === "analysis_studio" ? "analysis-focus" : "run-brief";
  }

  if (kind === "grants") {
    if (includesAny(normalized, ["decision", "deadline", "closing", "overdue", "due"])) return "grants-decision-queue";
    if (includesAny(normalized, ["award", "spending", "risk", "obligat"])) return "grants-awards";
    return "grants-brief";
  }

  if (kind === "invoicing") {
    if (includesAny(normalized, ["reimburse", "award", "funder", "grant"])) return "invoicing-reimbursements";
    if (includesAny(normalized, ["receivable", "client", "unpaid", "sent", "collect"])) return "invoicing-receivables";
    return "invoicing-brief";
  }

  if (kind === "engagement") {
    if (includesAny(normalized, ["moderat", "pending", "flagged", "queue", "review"])) return "engagement-moderation";
    if (includesAny(normalized, ["live", "draft", "publish", "staged", "public", "open"])) return "engagement-publication";
    return "engagement-brief";
  }

  if (kind === "safety") {
    if (includesAny(normalized, ["coverage", "year", "silent", "geograph", "where"])) return "safety-coverage";
    if (includesAny(normalized, ["severity", "fatal", "injur", "kabco", "mix"])) return "safety-severity";
    return "safety-brief";
  }

  if (kind === "aerial") {
    if (includesAny(normalized, ["job", "processing", "custody", "worker", "running"])) return "aerial-jobs";
    if (includesAny(normalized, ["package", "ready", "evidence", "qa", "shared"])) return "aerial-packages";
    return "aerial-brief";
  }

  if (kind === "knowledge_base") {
    if (includesAny(normalized, ["fail", "extract", "error", "stuck"])) return "knowledge-base-extraction";
    return "knowledge-base-brief";
  }

  if (kind === "data_hub") {
    if (includesAny(normalized, ["feed", "connector", "gtfs", "transit", "degraded", "offline"])) return "data-hub-feeds";
    if (includesAny(normalized, ["refresh", "job", "fail", "stale", "re-run", "rerun"])) return "data-hub-refresh";
    return "data-hub-brief";
  }

  return validActions[0]?.id ?? "workspace-overview";
}

export function findAssistantAction(kind: AssistantTargetKind, workflowId: string): AssistantAction | null {
  return getAssistantActions(kind).find((action) => action.id === workflowId) ?? null;
}
