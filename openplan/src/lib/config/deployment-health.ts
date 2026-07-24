/**
 * DEPLOYMENT HEALTH — what this installation of OpenPlan cannot currently do,
 * and why.
 *
 * WHY THIS EXISTS
 *   OpenPlan's posture is that any agency can run it unaided. The failure mode
 *   that quietly breaks that promise is not a crash — it is a feature that
 *   returns NOTHING because a key was never set, and says nothing about it. A
 *   planner sees an empty equity layer and concludes their county has no data;
 *   the truth is that `CENSUS_API_KEY` is absent. "Empty" and "not configured"
 *   look identical from the outside, and only one of them is honest.
 *
 *   The codebase already refuses this elsewhere — Safety states plainly that
 *   CCRS is California-only rather than returning an empty result; the county
 *   onramp reports `deliveryMode: "prepared"` when no worker URL is set. This
 *   module generalizes that: every capability that can be switched off by
 *   configuration says so, in terms of what a planner loses.
 *
 * TWO RULES
 *   1. NO SECRETS IN, NO SECRETS OUT. This module takes BOOLEANS, never token
 *      strings. The caller resolves presence and validity (via
 *      `resolvePublicMapboxToken` / `hasInvalidPublicMapboxToken`) and passes
 *      the verdict. The module therefore cannot echo a key even by accident —
 *      it has never seen one. This is a structural guarantee, not a discipline.
 *
 *   2. STATE THE CONSEQUENCE, NOT THE VARIABLE NAME. A workspace owner on a
 *      hosted deployment cannot edit environment variables and should not be
 *      told to. `detail` says what stops working, in planner terms; `remedy` is
 *      the operator instruction, and is null when there is nothing to do.
 *
 * PURE — no I/O, no `process.env`, no clock. Facts come in, verdicts come out,
 * so every branch is unit-testable without stubbing an environment.
 */

export type DeploymentCheckStatus = "pass" | "warn" | "fail";

export type DeploymentCheck = {
  key: string;
  label: string;
  status: DeploymentCheckStatus;
  /** What a planner loses. Never a secret, never a bare variable name. */
  detail: string;
  /** What an operator would do about it, or null when nothing is required. */
  remedy: string | null;
};

/**
 * `blocked` — a core surface cannot function at all.
 * `degraded` — the app works, but a named capability returns nothing.
 * `ready`    — nothing configuration-dependent is currently switched off.
 */
export type DeploymentHealthStatus = "ready" | "degraded" | "blocked";

export type DeploymentHealth = {
  status: DeploymentHealthStatus;
  checks: DeploymentCheck[];
  /** Checks that are not passing, most severe first — what a surface renders. */
  problems: DeploymentCheck[];
};

export type DeploymentHealthFacts = {
  mapbox: {
    /** A usable public token (`pk.`) was found under either accepted name. */
    hasValidToken: boolean;
    /** A token was set but is not a public token — e.g. a secret `sk.` key. */
    hasInvalidToken: boolean;
  };
  censusApiKeyPresent: boolean;
  anthropicApiKeyPresent: boolean;
  modelingWorker: {
    /** Runs currently queued or running for this workspace. */
    nonTerminalRunCount: number;
    /** Of those, how many have stopped making progress (see run-liveness). */
    stalledRunCount: number;
  };
};

const SEVERITY: Record<DeploymentCheckStatus, number> = { fail: 0, warn: 1, pass: 2 };

/**
 * Maps are the substrate of nearly every OpenPlan surface, so a missing token
 * is a `fail` rather than a `warn` — without it the app is a spreadsheet.
 */
function mapboxCheck(facts: DeploymentHealthFacts): DeploymentCheck {
  if (facts.mapbox.hasValidToken) {
    return {
      key: "mapbox",
      label: "Maps",
      status: "pass",
      detail: "A public Mapbox token is configured; map surfaces render.",
      remedy: null,
    };
  }

  // Distinguishing these two matters: a present-but-wrong token is a paste
  // mistake with a specific fix, and reporting it as "missing" sends the
  // operator looking for something they believe they already did.
  if (facts.mapbox.hasInvalidToken) {
    return {
      key: "mapbox",
      label: "Maps",
      status: "fail",
      detail:
        "A Mapbox token is set but is not a public token, so every map renders blank — including the shell backdrop, Explore, Safety, and engagement maps.",
      remedy:
        "Public tokens begin with 'pk.'. A secret token ('sk.') will not work in a browser and must not be published. Replace it with the public token from your Mapbox account.",
    };
  }

  return {
    key: "mapbox",
    label: "Maps",
    status: "fail",
    detail:
      "No Mapbox token is configured, so every map renders blank — including the shell backdrop, Explore, Safety, and engagement maps.",
    remedy:
      "Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a public Mapbox token (the legacy name NEXT_PUBLIC_MAPBOX_TOKEN is also accepted), then redeploy — public variables are inlined at build time.",
  };
}

/**
 * `warn`, not `fail`: the app is fully usable without it, but three specific
 * capabilities return empty rather than erroring — which is exactly the silent
 * emptiness this module exists to name.
 */
function censusCheck(facts: DeploymentHealthFacts): DeploymentCheck {
  if (facts.censusApiKeyPresent) {
    return {
      key: "census",
      label: "Census / equity data",
      status: "pass",
      detail: "A Census API key is configured; ACS-backed demographics and equity tracts can load.",
      remedy: null,
    };
  }

  return {
    key: "census",
    label: "Census / equity data",
    status: "warn",
    detail:
      "No Census API key is configured. Equity choropleths stay empty, census-tract ingestion for a workspace's county does not populate, and ACS-backed corridor demographics are unavailable — these surfaces return no data rather than an error, so they look like 'nothing here' instead of 'not configured'.",
    remedy:
      "A Census API key is free from the U.S. Census Bureau (api.census.gov/data/key_signup.html). Set it as CENSUS_API_KEY.",
  };
}

function anthropicCheck(facts: DeploymentHealthFacts): DeploymentCheck {
  if (facts.anthropicApiKeyPresent) {
    return {
      key: "anthropic",
      label: "AI assistance",
      status: "pass",
      detail: "An Anthropic API key is configured; AI-assisted drafting and synthesis are available.",
      remedy: null,
    };
  }

  return {
    key: "anthropic",
    label: "AI assistance",
    status: "warn",
    detail:
      "No Anthropic API key is configured. AI-assisted features — grant narrative drafting, engagement comment synthesis, translation and moderation, and the in-app assistant — are unavailable. Every other module works normally.",
    remedy: "Set ANTHROPIC_API_KEY to an Anthropic API key.",
  };
}

/**
 * Worker liveness is INFERRED, never asserted.
 *
 * The AequilibraE screening worker is a poller: it reads queued runs out of the
 * database and has no endpoint to ping and no heartbeat column. There is
 * therefore no way to ask "is a worker running?" — only to observe whether work
 * is moving. So this check claims nothing when there is nothing in flight, and
 * reports a problem only when THIS workspace has runs that have stopped
 * progressing. That is a symptom the viewer genuinely has, whatever other
 * workspaces are doing.
 */
function modelingWorkerCheck(facts: DeploymentHealthFacts): DeploymentCheck {
  const { nonTerminalRunCount, stalledRunCount } = facts.modelingWorker;

  if (stalledRunCount > 0) {
    const plural = stalledRunCount === 1 ? "run has" : "runs have";
    return {
      key: "modeling-worker",
      label: "Modeling worker",
      status: "fail",
      detail: `${stalledRunCount} model ${plural} stopped making progress. The AequilibraE worker polls for queued runs; if none is deployed and running, runs queue indefinitely instead of failing.`,
      remedy:
        "Deploy the AequilibraE worker (workers/aequilibrae_worker/DEPLOY.md) against this deployment's own Supabase project, and check its logs.",
    };
  }

  if (nonTerminalRunCount > 0) {
    return {
      key: "modeling-worker",
      label: "Modeling worker",
      status: "pass",
      detail: `${nonTerminalRunCount} model run${nonTerminalRunCount === 1 ? " is" : "s are"} in flight and progressing.`,
      remedy: null,
    };
  }

  return {
    key: "modeling-worker",
    label: "Modeling worker",
    status: "pass",
    detail:
      "No model runs are in flight. The worker is a poller with no heartbeat, so whether one is deployed cannot be observed until a run is queued.",
    remedy: null,
  };
}

export function evaluateDeploymentHealth(facts: DeploymentHealthFacts): DeploymentHealth {
  const checks = [
    mapboxCheck(facts),
    censusCheck(facts),
    modelingWorkerCheck(facts),
    anthropicCheck(facts),
  ];

  const problems = checks
    .filter((check) => check.status !== "pass")
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);

  const status: DeploymentHealthStatus = problems.some((check) => check.status === "fail")
    ? "blocked"
    : problems.length > 0
      ? "degraded"
      : "ready";

  return { status, checks, problems };
}
