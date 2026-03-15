export const MODEL_FAMILY_OPTIONS = [
  { value: "travel_demand", label: "Travel Demand Model" },
  { value: "activity_based_model", label: "Activity-Based Model" },
  { value: "scenario_model", label: "Scenario Model" },
  { value: "accessibility", label: "Accessibility / Sketch Model" },
  { value: "other", label: "Other Model" },
] as const;

export const MODEL_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "configuring", label: "Configuring" },
  { value: "ready_for_review", label: "Ready for Review" },
  { value: "approved", label: "Approved" },
  { value: "archived", label: "Archived" },
] as const;

export const MODEL_LINK_TYPE_OPTIONS = [
  { value: "scenario_set", label: "Scenario Set" },
  { value: "report", label: "Report" },
  { value: "data_dataset", label: "Data Hub Dataset" },
  { value: "plan", label: "Plan" },
  { value: "project_record", label: "Project" },
  { value: "run", label: "Recorded Run" },
] as const;

export type ModelFamily = (typeof MODEL_FAMILY_OPTIONS)[number]["value"];
export type ModelStatus = (typeof MODEL_STATUS_OPTIONS)[number]["value"];
export type ModelLinkType = (typeof MODEL_LINK_TYPE_OPTIONS)[number]["value"];

export type ModelReadinessCheck = {
  key:
    | "project_basis"
    | "scenario_basis"
    | "config_version"
    | "owner"
    | "assumptions"
    | "inputs"
    | "outputs"
    | "validation";
  label: string;
  ready: boolean;
  detail: string;
};

export type ModelReadinessSummary = {
  status: "ready" | "incomplete";
  label: string;
  reason: string;
  tone: "success" | "warning" | "neutral";
  ready: boolean;
  readyCheckCount: number;
  totalCheckCount: number;
  missingCheckCount: number;
  missingCheckLabels: string[];
  nextSteps: string[];
  checks: ModelReadinessCheck[];
};

export type ModelWorkflowSummary = {
  label: string;
  reason: string;
  tone: "success" | "warning" | "neutral" | "info";
  packageLabel: string;
  packageDetail: string;
  packageTone: "success" | "warning" | "neutral" | "info";
  actionItems: string[];
  reviewNotes: string[];
};

export function titleizeModelValue(value: string | null | undefined): string {
  if (!value) return "Unknown";

  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatModelFamilyLabel(value: string | null | undefined): string {
  return MODEL_FAMILY_OPTIONS.find((option) => option.value === value)?.label ?? titleizeModelValue(value);
}

export function formatModelStatusLabel(value: string | null | undefined): string {
  return MODEL_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? titleizeModelValue(value);
}

export function formatModelLinkTypeLabel(value: string | null | undefined): string {
  return MODEL_LINK_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? titleizeModelValue(value);
}

export function modelStatusTone(
  status: string | null | undefined
): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "approved") return "success";
  if (status === "ready_for_review") return "info";
  if (status === "configuring") return "warning";
  if (status === "archived" || status === "draft") return "neutral";
  return "neutral";
}

export function formatModelDateTime(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function buildModelReadiness({
  hasProject,
  hasScenario,
  configVersion,
  ownerLabel,
  assumptionsSummary,
  inputDatasetCount,
  inputSummary,
  outputReportCount,
  outputRunCount,
  outputSummary,
  lastValidatedAt,
}: {
  hasProject: boolean;
  hasScenario: boolean;
  configVersion: string | null | undefined;
  ownerLabel: string | null | undefined;
  assumptionsSummary: string | null | undefined;
  inputDatasetCount: number;
  inputSummary: string | null | undefined;
  outputReportCount: number;
  outputRunCount: number;
  outputSummary: string | null | undefined;
  lastValidatedAt: string | null | undefined;
}): ModelReadinessSummary {
  const checks: ModelReadinessCheck[] = [
    {
      key: "project_basis",
      label: "Project basis",
      ready: hasProject,
      detail: hasProject ? "A primary project anchor is on record." : "Attach the project this model record is meant to support.",
    },
    {
      key: "scenario_basis",
      label: "Scenario basis",
      ready: hasScenario,
      detail: hasScenario ? "At least one scenario basis is linked." : "Link the scenario set or comparison framing this model supports.",
    },
    {
      key: "config_version",
      label: "Config version",
      ready: Boolean(configVersion?.trim()),
      detail: configVersion?.trim() ? `Version ${configVersion.trim()} recorded.` : "Capture a versioned config identifier before calling a run review-ready.",
    },
    {
      key: "owner",
      label: "Operator",
      ready: Boolean(ownerLabel?.trim()),
      detail: ownerLabel?.trim() ? ownerLabel.trim() : "Record the operator or team responsible for maintaining this model setup.",
    },
    {
      key: "assumptions",
      label: "Assumptions",
      ready: Boolean(assumptionsSummary?.trim()),
      detail: assumptionsSummary?.trim()
        ? "Assumptions summary captured."
        : "Summarize the principal assumptions, policy knobs, or calibration basis.",
    },
    {
      key: "inputs",
      label: "Input provenance",
      ready: inputDatasetCount > 0 || Boolean(inputSummary?.trim()),
      detail:
        inputDatasetCount > 0
          ? `${inputDatasetCount} linked dataset${inputDatasetCount === 1 ? "" : "s"} support the input stack.`
          : inputSummary?.trim()
            ? "Input posture described in metadata."
            : "Link Data Hub datasets or describe the input snapshot posture.",
    },
    {
      key: "outputs",
      label: "Output traceability",
      ready: outputReportCount > 0 || outputRunCount > 0 || Boolean(outputSummary?.trim()),
      detail:
        outputReportCount > 0 || outputRunCount > 0
          ? `${outputRunCount} recorded run${outputRunCount === 1 ? "" : "s"} and ${outputReportCount} linked report${outputReportCount === 1 ? "" : "s"} trace current outputs.`
          : outputSummary?.trim()
            ? "Output posture described in metadata."
            : "Link a run, report, or explicit output note so downstream review can be traced.",
    },
    {
      key: "validation",
      label: "Validation checkpoint",
      ready: Boolean(lastValidatedAt),
      detail: lastValidatedAt ? `Validated ${formatModelDateTime(lastValidatedAt)}.` : "Record when this model config was last checked or reviewed.",
    },
  ];

  const readyCheckCount = checks.filter((check) => check.ready).length;
  const missingChecks = checks.filter((check) => !check.ready);
  const ready = missingChecks.length === 0;

  if (ready) {
    return {
      status: "ready",
      label: "Run posture ready",
      reason: "Configuration metadata, provenance, and traceability are all present.",
      tone: "success",
      ready,
      readyCheckCount,
      totalCheckCount: checks.length,
      missingCheckCount: 0,
      missingCheckLabels: [],
      nextSteps: [],
      checks,
    };
  }

  return {
    status: "incomplete",
    label: readyCheckCount >= 5 ? "Metadata mostly assembled" : "Needs setup",
    reason: missingChecks[0]?.detail ?? "Capture model metadata and traceability before review.",
    tone: readyCheckCount === 0 ? "neutral" : "warning",
    ready,
    readyCheckCount,
    totalCheckCount: checks.length,
    missingCheckCount: missingChecks.length,
    missingCheckLabels: missingChecks.map((check) => check.label),
    nextSteps: missingChecks.map((check) => check.detail),
    checks,
  };
}

export function buildModelWorkflowSummary({
  modelStatus,
  readiness,
  linkedScenarioCount,
  linkedDatasetCount,
  linkedRunCount,
  linkedReportCount,
  lastRunRecordedAt,
}: {
  modelStatus: string | null | undefined;
  readiness: ModelReadinessSummary;
  linkedScenarioCount: number;
  linkedDatasetCount: number;
  linkedRunCount: number;
  linkedReportCount: number;
  lastRunRecordedAt: string | null | undefined;
}): ModelWorkflowSummary {
  if (modelStatus === "approved") {
    return {
      label: "Approved model record",
      reason: "The current metadata posture is suitable for operator handoff and downstream reporting.",
      tone: "success",
      packageLabel: linkedReportCount > 0 ? "Outputs linked" : "Outputs pending",
      packageDetail:
        linkedReportCount > 0
          ? `${linkedReportCount} report link${linkedReportCount === 1 ? "" : "s"} preserve downstream evidence.`
          : "Approval is recorded, but downstream packet/report linkage is still thin.",
      packageTone: linkedReportCount > 0 ? "success" : "warning",
      actionItems: linkedReportCount > 0 ? [] : ["Attach a report packet or evidence output for downstream traceability."],
      reviewNotes: lastRunRecordedAt ? [`Latest recorded run: ${formatModelDateTime(lastRunRecordedAt)}.`] : ["No recorded run timestamp yet."],
    };
  }

  if (modelStatus === "ready_for_review") {
    return {
      label: "Awaiting operator review",
      reason: readiness.ready ? "Core readiness checks are green and the record can be reviewed." : readiness.reason,
      tone: readiness.ready ? "info" : "warning",
      packageLabel: linkedRunCount > 0 ? "Run evidence present" : "Run evidence missing",
      packageDetail:
        linkedRunCount > 0
          ? `${linkedRunCount} run link${linkedRunCount === 1 ? "" : "s"} anchor the current review.`
          : "Review can start from metadata, but no concrete run record is attached yet.",
      packageTone: linkedRunCount > 0 ? "info" : "warning",
      actionItems: readiness.nextSteps.slice(0, 3),
      reviewNotes: [
        linkedScenarioCount > 0 ? `${linkedScenarioCount} linked scenario basis record${linkedScenarioCount === 1 ? "" : "s"} included.` : "Scenario linkage is still missing.",
        linkedDatasetCount > 0 ? `${linkedDatasetCount} linked dataset${linkedDatasetCount === 1 ? "" : "s"} visible for provenance.` : "Input provenance is still thin.",
      ],
    };
  }

  if (modelStatus === "configuring") {
    return {
      label: "Configuration in progress",
      reason: "The record is being assembled as a managed setup, not treated as an executable orchestration layer yet.",
      tone: "warning",
      packageLabel: readiness.readyCheckCount >= 4 ? "Foundation established" : "Early setup",
      packageDetail: `${readiness.readyCheckCount}/${readiness.totalCheckCount} readiness checks currently pass.`,
      packageTone: readiness.readyCheckCount >= 4 ? "info" : "neutral",
      actionItems: readiness.nextSteps.slice(0, 4),
      reviewNotes: [
        linkedScenarioCount > 0 ? "Scenario context already linked." : "Link the relevant scenario set when the comparison basis is known.",
        linkedReportCount > 0 ? "Reports are already connected." : "Report linkage can wait until output packaging starts.",
      ],
    };
  }

  return {
    label: modelStatus === "archived" ? "Archived record" : "Draft model record",
    reason:
      modelStatus === "archived"
        ? "The record is retained for audit continuity but not expected to advance."
        : "Capture config versioning, provenance, and traceability before moving the record forward.",
    tone: "neutral",
    packageLabel: linkedRunCount > 0 || linkedReportCount > 0 ? "Evidence partially linked" : "No output chain yet",
    packageDetail:
      linkedRunCount > 0 || linkedReportCount > 0
        ? `${linkedRunCount} run link${linkedRunCount === 1 ? "" : "s"} and ${linkedReportCount} report link${linkedReportCount === 1 ? "" : "s"} currently attached.`
        : "No run or report record is attached yet.",
    packageTone: linkedRunCount > 0 || linkedReportCount > 0 ? "info" : "neutral",
    actionItems: readiness.nextSteps.slice(0, 4),
    reviewNotes: [
      linkedDatasetCount > 0 ? `${linkedDatasetCount} dataset link${linkedDatasetCount === 1 ? "" : "s"} are already in place.` : "No linked datasets yet.",
    ],
  };
}
