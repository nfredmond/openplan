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

function cleanBoolean(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
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

  const query = params.toString();
  return query ? `${pathname}?${query}`.slice(0, 220) : pathname.slice(0, 220);
}

export function buildRequestAccessPrefill(
  pathname: string,
  searchParams: SearchParamsLike = {},
): RequestAccessPrefill {
  const product = cleanToken(firstParam(searchParams, "product"));
  const tier = cleanToken(firstParam(searchParams, "tier") ?? firstParam(searchParams, "plan"));
  const checkout = cleanToken(firstParam(searchParams, "checkout"));
  const source = cleanToken(firstParam(searchParams, "source"), 120);
  const workspaceId = cleanWorkspaceId(firstParam(searchParams, "workspaceId"));
  const legacyCheckout = cleanBoolean(firstParam(searchParams, "legacyCheckout"));
  const checkoutDisabled = cleanBoolean(firstParam(searchParams, "checkoutDisabled")) || checkout === "disabled";
  const isOpenPlanFit = product === "openplan" || pathname.endsWith("/openplan-fit");

  const sourceContext = compactContext({
    product: product ?? (isOpenPlanFit ? "openplan" : undefined),
    tier,
    checkout,
    legacyCheckout,
    checkoutDisabled,
    workspaceId,
    source,
  });

  const initialValues: RequestAccessPrefill["initialValues"] = {
    serviceLane: resolveServiceLane(firstParam(searchParams, "lane")),
    deploymentPosture: resolveDeploymentPosture(firstParam(searchParams, "deployment")),
    desiredFirstWorkflow: resolveWorkflow(firstParam(searchParams, "workflow")),
  };

  if (isOpenPlanFit) {
    initialValues.serviceLane ??= "implementation_onboarding";
    initialValues.deploymentPosture ??= "undecided";
    initialValues.desiredFirstWorkflow ??= "other";
    initialValues.onboardingNeeds = [
      "OpenPlan fit review requested before any managed deployment, support commitment, direct checkout, or custom fork is scoped.",
      tier ? `Legacy tier/reference: ${tier}.` : null,
      workspaceId ? `Workspace context: ${workspaceId}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    initialValues.useCase =
      "Review fit for OpenPlan implementation/support before any managed deployment, checkout, or custom fork is created.";
  }

  return {
    initialValues,
    sourceContext,
    sourcePath: sourcePathWithAllowedParams(pathname, sourceContext),
  };
}
