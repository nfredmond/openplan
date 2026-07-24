import {
  ACCESS_REQUEST_DEPLOYMENT_POSTURE_VALUES,
  ACCESS_REQUEST_FIRST_WORKFLOW_VALUES,
  ACCESS_REQUEST_SERVICE_LANE_VALUES,
  type AccessRequestDeploymentPosture,
  type AccessRequestFirstWorkflow,
  type AccessRequestServiceLane,
} from "@/lib/access-request-intake";

export type PublicIntakeSourceContext = {
  product?: string;
  tier?: string;
  checkout?: string;
  legacyCheckout?: boolean;
  checkoutDisabled?: boolean;
  workspaceId?: string;
  source?: string;
  intent?: string;
};

export type RequestAccessPrefill = {
  initialValues: {
    serviceLane?: AccessRequestServiceLane;
    deploymentPosture?: AccessRequestDeploymentPosture;
    desiredFirstWorkflow?: AccessRequestFirstWorkflow;
    onboardingNeeds?: string;
    useCase?: string;
  };
  sourcePath: string;
  sourceContext: PublicIntakeSourceContext;
};

type SearchParamsLike = Record<string, string | string[] | undefined>;

const SERVICE_LANE_ALIASES: Record<string, AccessRequestServiceLane> = {
  "self-hosted": "self_host_evaluation",
  self_hosted: "self_host_evaluation",
  "self-host": "self_host_evaluation",
  managed: "managed_hosting_admin",
  "managed-hosting": "managed_hosting_admin",
  managed_hosting: "managed_hosting_admin",
  hosting: "managed_hosting_admin",
  implementation: "implementation_onboarding",
  onboarding: "implementation_onboarding",
  services: "planning_services",
  planning: "planning_services",
  custom: "custom_software_ai_systems",
  "custom-fork": "custom_software_ai_systems",
};

const WORKFLOW_ALIASES: Record<string, AccessRequestFirstWorkflow> = {
  rtp: "rtp",
  grants: "grants",
  grant: "grants",
  aerial: "aerial_evidence",
  "aerial-evidence": "aerial_evidence",
  modeling: "modeling",
  model: "modeling",
  engagement: "engagement",
  other: "other",
};

const INTENT_NOTES: Record<string, string> = {
  "open-source-services-review":
    "CTA intent: learn about the Apache-2.0 open-source core.",
  "modeling-workspace-review":
    "CTA intent: question about the modeling or Analysis Studio surfaces.",
  "engagement-workspace-review":
    "CTA intent: question about running an engagement campaign.",
  "self-hosting-review":
    "CTA intent: running their own OpenPlan deployment.",
  "managed-hosting-review":
    "CTA intent: account, workspace, or access problem.",
  "implementation-review":
    "CTA intent: getting started with OpenPlan.",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /[^a-z0-9_-]/gi;

function firstParam(searchParams: SearchParamsLike, key: string): string | null {
  const value = searchParams[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function cleanToken(value: string | null | undefined, maxLength = 80): string | undefined {
  const cleaned = value?.trim().replace(TOKEN_PATTERN, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function cleanWorkspaceId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && UUID_PATTERN.test(trimmed) ? trimmed : undefined;
}

function resolveServiceLane(value: string | null | undefined): AccessRequestServiceLane | undefined {
  const token = cleanToken(value);
  if (!token) return undefined;
  if ((ACCESS_REQUEST_SERVICE_LANE_VALUES as readonly string[]).includes(token)) {
    return token as AccessRequestServiceLane;
  }

  return SERVICE_LANE_ALIASES[token];
}

function resolveWorkflow(value: string | null | undefined): AccessRequestFirstWorkflow | undefined {
  const token = cleanToken(value);
  if (!token) return undefined;
  if ((ACCESS_REQUEST_FIRST_WORKFLOW_VALUES as readonly string[]).includes(token)) {
    return token as AccessRequestFirstWorkflow;
  }

  return WORKFLOW_ALIASES[token];
}

function resolveDeploymentPosture(value: string | null | undefined): AccessRequestDeploymentPosture | undefined {
  const token = cleanToken(value);
  return token && (ACCESS_REQUEST_DEPLOYMENT_POSTURE_VALUES as readonly string[]).includes(token)
    ? (token as AccessRequestDeploymentPosture)
    : undefined;
}

function inferDeploymentPosture(serviceLane: AccessRequestServiceLane | undefined): AccessRequestDeploymentPosture | undefined {
  if (serviceLane === "self_host_evaluation") return "self_hosted";
  if (serviceLane === "managed_hosting_admin") return "nat_ford_managed";
  if (serviceLane === "implementation_onboarding" || serviceLane === "planning_services" || serviceLane === "custom_software_ai_systems") {
    return "undecided";
  }

  return undefined;
}

function compactContext(context: PublicIntakeSourceContext): PublicIntakeSourceContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== false),
  ) as PublicIntakeSourceContext;
}

function sourcePathWithAllowedParams(pathname: string, context: PublicIntakeSourceContext): string {
  const params = new URLSearchParams();

  if (context.product) params.set("product", context.product);
  if (context.tier) params.set("tier", context.tier);
  if (context.checkout) params.set("checkout", context.checkout);
  if (context.legacyCheckout) params.set("legacyCheckout", "1");
  if (context.checkoutDisabled) params.set("checkoutDisabled", "1");
  if (context.workspaceId) params.set("workspaceId", context.workspaceId);
  if (context.source) params.set("source", context.source);
  if (context.intent) params.set("intent", context.intent);

  const query = params.toString();
  return query ? `${pathname}?${query}`.slice(0, 220) : pathname.slice(0, 220);
}

export function buildRequestAccessPrefill(
  pathname: string,
  searchParams: SearchParamsLike = {},
): RequestAccessPrefill {
  // The legacy Stripe checkout deep-link params (tier / plan / checkout /
  // legacyCheckout / checkoutDisabled) and the /contact/openplan-fit route that
  // absorbed them are gone with the paid tier — nothing can generate such a
  // link any more, so nothing needs to parse one.
  const product = cleanToken(firstParam(searchParams, "product"));
  const source = cleanToken(firstParam(searchParams, "source"), 120);
  const intent = cleanToken(firstParam(searchParams, "intent"), 120);
  const workspaceId = cleanWorkspaceId(firstParam(searchParams, "workspaceId"));
  const isOpenPlanProduct = product === "openplan";

  const sourceContext = compactContext({
    product,
    workspaceId,
    source,
    intent,
  });

  const serviceLane = resolveServiceLane(firstParam(searchParams, "lane"));
  const deploymentPosture = resolveDeploymentPosture(firstParam(searchParams, "deployment")) ?? inferDeploymentPosture(serviceLane);
  const desiredFirstWorkflow = resolveWorkflow(firstParam(searchParams, "workflow"));

  const initialValues: RequestAccessPrefill["initialValues"] = {
    serviceLane,
    deploymentPosture,
    desiredFirstWorkflow,
  };

  if (isOpenPlanProduct && workspaceId) {
    initialValues.desiredFirstWorkflow ??= "other";
    initialValues.onboardingNeeds = `Workspace context: ${workspaceId}.`;
  } else if (intent && INTENT_NOTES[intent]) {
    initialValues.onboardingNeeds = [
      INTENT_NOTES[intent],
      "Review only: do not create a workspace or send email from this message without explicit human follow-up.",
    ].join(" ");
  }

  return {
    initialValues,
    sourceContext,
    sourcePath: sourcePathWithAllowedParams(pathname, sourceContext),
  };
}
