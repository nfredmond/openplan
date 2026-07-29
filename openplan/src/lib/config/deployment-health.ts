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

/**
 * The variable an operator sets to declare whether this deployment runs the
 * AequilibraE modeling worker. Lives here, beside the check that reports it, so
 * the name exists in exactly one place; `deployment-health-facts.ts` reads it.
 */
export const MODELING_WORKER_DECLARATION_ENV = "OPENPLAN_MODELING_WORKER";

/**
 * The OTHER way to give this deployment modeling compute: a worker OpenPlan
 * PUSHES to, rather than one that polls. These names live here for the same
 * reason the declaration's does — the remedies below have to print them, and a
 * variable name spelt two ways is an operator sent looking for something that
 * does not exist. `run-dispatch.ts` imports them and does the pushing.
 *
 * Unlike the declaration, a push endpoint is not merely a statement: OpenPlan
 * calls it at launch and gets an answer or a failure, which is the first thing
 * in this lane that is genuinely OBSERVED rather than declared or inferred. It
 * still says nothing about whether the worker can finish what it accepted.
 */
export const MODELING_WORKER_URL_ENV = "OPENPLAN_MODELING_WORKER_URL";
export const MODELING_WORKER_TOKEN_ENV = "OPENPLAN_MODELING_WORKER_TOKEN";

/**
 * What this deployment SAYS about the modeling worker — never what OpenPlan has
 * checked, because it cannot check.
 *
 * The AequilibraE worker CAN be a poller: it reads queued runs out of Postgres,
 * and in that shape it exposes no URL to probe and writes no heartbeat. Every
 * other worker in the product is declared by its URL and token, and that
 * declaration is what lets those routes answer honestly BEFORE doing anything.
 * This is the same declaration for a worker configured with no URL to declare.
 *
 * A deployment may now ALSO give the modeling worker a URL and token
 * (`MODELING_WORKER_URL_ENV`), in which case OpenPlan pushes each run to it and
 * gets a real answer at launch. That does not make this declaration obsolete —
 * a polling worker is still a supported, and simpler, configuration, and a
 * deployment that runs one has nothing to point a URL at.
 *
 * `undeclared` is the default and is deliberately NOT the same as `absent`.
 * Every deployment that already runs a worker has never set this variable, so
 * reading silence as "there is no worker" would refuse launches that work today
 * — and it would be a confident claim drawn from no evidence at all, which is
 * the failure this module exists to prevent. Silence means "nobody has said",
 * and callers fall back to inferring from run history, claiming nothing more.
 *
 * `unrecognized` exists so a typo cannot become a silent `undeclared`. A value
 * OpenPlan does not understand is reported to the operator rather than guessed
 * at in either direction.
 */
export type ModelingWorkerDeclaration = "deployed" | "absent" | "undeclared" | "unrecognized";

export type DeploymentHealthFacts = {
  mapbox: {
    /** A usable public token (`pk.`) was found under either accepted name. */
    hasValidToken: boolean;
    /** A token was set but is not a public token — e.g. a secret `sk.` key. */
    hasInvalidToken: boolean;
  };
  censusApiKeyPresent: boolean;
  anthropicApiKeyPresent: boolean;
  pdfRendering: {
    /** A browser rendering engine can be reached from this deployment. */
    browserEngineAvailable: boolean;
  };
  modelingWorker: {
    /** What the operator has declared, if anything. Never an observation. */
    declaration: ModelingWorkerDeclaration;
    /** Runs currently queued or running for this workspace. */
    nonTerminalRunCount: number;
    /** Of those, how many have stopped making progress (see run-liveness). */
    stalledRunCount: number;
    /**
     * Whether this deployment can PUSH a run at a worker instead of waiting for
     * one to poll. Configuration, resolved from env by the facts loader — the
     * booleans-only rule holds, so no URL and no token reaches this module.
     */
    pushDispatch: {
      /** A usable endpoint AND token are configured. */
      configured: boolean;
      /**
       * Set when a push endpoint was evidently INTENDED and will not be used —
       * a URL with no token, a token with no URL, an unparseable URL. Reporting
       * "no push endpoint is configured" in that state would be true to the
       * letter and false to the operator, who believes they configured one.
       */
      configurationProblem: string | null;
    };
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
 * Worker liveness is DECLARED, INFERRED, or — where the deployment configures a
 * push endpoint — ANSWERED AT LAUNCH. It is never probed from here.
 *
 * A polling AequilibraE worker reads queued runs out of the database and has no
 * endpoint to ping and no heartbeat column. There is therefore no way to ask "is
 * a worker running?" — only to be TOLD by whoever runs the deployment, and to
 * observe whether work is moving.
 *
 * The third source is different in kind and is why the remedies below changed.
 * A deployment can configure a worker OpenPlan pushes to, and a push either is
 * accepted or is not — that answer arrives at the moment of launch, to the
 * planner who launched it. This check reports whether that configuration EXISTS
 * (a fact about this deployment's environment); it never claims the worker
 * behind it is up, because a configured endpoint is not a heartbeat either.
 *
 * Those two sources are ranked deliberately, and the ranking is the whole
 * design. Observed run history outranks the declaration, in both directions,
 * because a declaration is a statement made once and evidence is what is
 * happening now — a worker that was declared and then retired must not keep
 * vouching for itself. The declaration covers the case evidence cannot: a
 * deployment with no run history at all, where before this the first run had to
 * be queued and reaped before anything could be said.
 *
 * The declaration is reflected back here so an operator can see what the
 * product believes about their deployment and correct it. It is deployment
 * configuration and nothing else — never a plan, a tier or an entitlement, and
 * the remedies name the operator rather than offering anyone an upgrade.
 */
function modelingWorkerCheck(facts: DeploymentHealthFacts): DeploymentCheck {
  const { declaration, nonTerminalRunCount, stalledRunCount, pushDispatch } = facts.modelingWorker;
  const base = { key: "modeling-worker", label: "Modeling worker" } as const;
  const runsInFlight = `${nonTerminalRunCount} model run${nonTerminalRunCount === 1 ? " is" : "s are"}`;

  /**
   * The sentence every remedy ends with.
   *
   * It exists because this module used to institutionalize a workaround: every
   * remedy said "deploy the AequilibraE worker", full stop, as though standing
   * up a long-lived polling process were the only shape modeling compute can
   * take. It is not, and a self-serve operator on a platform that scales to
   * zero could not follow that instruction at all. There are two configurations
   * now, both free, and a remedy that names only one of them is an incomplete
   * answer dressed as a complete one.
   */
  const executionOptions = pushDispatch.configured
    ? `This deployment already configures a push endpoint (${MODELING_WORKER_URL_ENV}), so OpenPlan hands every worker-backed run to it and records at launch whether it was accepted — that answer, or the failure in its place, is on the launch panel and in the audit log.`
    : `Two configurations give this deployment modeling compute and neither costs anything: run the worker as a long-lived poller (workers/aequilibrae_worker/DEPLOY.md), or run it behind its HTTP trigger and set ${MODELING_WORKER_URL_ENV} and ${MODELING_WORKER_TOKEN_ENV} so OpenPlan pushes each run to it and learns at launch whether anything took it.`;

  // Runs that have stopped moving are the strongest signal available, so they
  // are read first whatever the declaration says.
  if (stalledRunCount > 0) {
    const stalled = `${stalledRunCount} model run${stalledRunCount === 1 ? " has" : "s have"} stopped making progress.`;

    if (declaration === "deployed") {
      return {
        ...base,
        status: "fail",
        detail: `${stalled} This deployment declares that an AequilibraE worker runs against it, so the configuration and the run history disagree. The worker polls and has no heartbeat, so the declaration cannot be verified from here — only the contradiction can be reported.`,
        remedy: `Check that the worker process is running and pointed at THIS deployment's Supabase project, and read its logs (workers/aequilibrae_worker/DEPLOY.md). If the worker was retired, change the declaration so launches are refused before they are queued instead of after they are reaped. ${executionOptions}`,
      };
    }

    if (declaration === "absent") {
      return {
        ...base,
        status: "fail",
        detail: `${stalled} This deployment declares that it runs no AequilibraE worker, which is exactly what a queue nothing serves looks like. New worker-backed launches are now refused at the launch button, so these runs were queued before that declaration was made.`,
        remedy: `These runs cannot finish and the run reaper will fail them. ${executionOptions} Then set ${MODELING_WORKER_DECLARATION_ENV} to "deployed", so launches stop being refused at the button.`,
      };
    }

    return {
      ...base,
      status: "fail",
      detail: `${stalled} A worker-backed run executes only where something claims it — a worker polling this deployment's queue, or one OpenPlan pushes to. With neither, runs queue indefinitely instead of failing.`,
      remedy: `${executionOptions} Whichever is in use, check that it is pointed at THIS deployment's own Supabase project and read its logs. Setting ${MODELING_WORKER_DECLARATION_ENV} to "deployed" or "absent" also lets the launch controls answer before a run is queued rather than after it has been reaped.`,
    };
  }

  /**
   * A push endpoint that was evidently meant and cannot be used. Reported ahead
   * of the declaration branches because it is the one thing here an operator can
   * fix with certainty — everything below is about a poller that cannot be
   * probed, while this is a known-broken configuration in front of us.
   *
   * The DETAIL states the consequence and the REMEDY carries the variable names
   * (rule 2 of this module): the person reading a dashboard may not be the
   * person who can edit an environment.
   */
  if (pushDispatch.configurationProblem) {
    return {
      ...base,
      status: "warn",
      detail:
        "This deployment is partly configured to push model runs to a processing worker, but not enough of that configuration is present to use, so nothing is pushed. Worker-backed runs fall back to waiting for a worker that polls this deployment — which may or may not be what was intended, and is why this is reported rather than left silent.",
      remedy: `${pushDispatch.configurationProblem} ${executionOptions}`,
    };
  }

  /**
   * The deployment says one thing and its configuration does another. Both are
   * operator statements, so neither is "observed" and neither may be silently
   * preferred — the contradiction is what gets reported.
   */
  if (declaration === "absent" && pushDispatch.configured) {
    return {
      ...base,
      status: "warn",
      detail:
        "This deployment declares that it runs no AequilibraE worker, and also configures an endpoint for OpenPlan to push model runs to. Both are statements by whoever configured this deployment, and they disagree. While the declaration says no worker exists, worker-backed launches are refused at the button — so if the push endpoint is real, planners are being refused runs this deployment can actually execute.",
      // The middle case is the one a push-only operator actually lands in, and
      // it must not be answered with `deployed`. This variable states whether
      // anything POLLS the queue — so on a deployment whose runs are only ever
      // pushed, `deployed` is a false statement and `absent` is a true one that
      // refuses every worker-backed launch at the button. UNSET is the only
      // answer that is both truthful and lets the pool work, and an operator
      // will not guess that from a remedy that offers them two settings.
      remedy: `If a worker also POLLS this deployment, set ${MODELING_WORKER_DECLARATION_ENV} to "deployed". If runs are only ever pushed to the endpoint above, UNSET ${MODELING_WORKER_DECLARATION_ENV} instead — it answers whether anything polls the queue, and "absent" goes on refusing worker-backed launches at the button even though the push endpoint could serve them. If nothing serves this deployment at all, remove ${MODELING_WORKER_URL_ENV} so nothing is pushed at an endpoint that will not answer. Every one of those is free — none of this is a plan or a tier.`,
    };
  }

  // A declaration of absence that this workspace's runs may be contradicting —
  // MAY, and the wording has to stay inside that.
  //
  // `nonTerminalRunCount` counts runs that are queued or running and have not
  // yet crossed the abandonment threshold. On a deployment with no worker at
  // all, a run queued two minutes ago sits in exactly that state: nothing has
  // touched it, and nothing can tell it apart from a run waiting its turn until
  // it goes stale. Saying "something is executing them" here would be a
  // confident claim drawn from the absence of a symptom, and its remedy would
  // talk an operator into declaring a worker they do not have — which would put
  // the retrospective refusal back for everyone using this deployment.
  //
  // The launch controls have NOT stopped refusing in this state either: the gate
  // clears a declared absence only on a run something demonstrably started, not
  // on one that is merely young. So this reports a possible contradiction and
  // names who can resolve it, and nothing more.
  if (declaration === "absent" && nonTerminalRunCount > 0) {
    return {
      ...base,
      status: "warn",
      detail: `This deployment declares that it runs no AequilibraE worker, but ${runsInFlight} queued or running here, and none has yet been abandoned. A run nothing has picked up is indistinguishable from one waiting its turn until it goes stale, so this is not evidence that a worker exists — only a sign that the declaration may be out of date.`,
      remedy: `If this deployment does run a worker, change ${MODELING_WORKER_DECLARATION_ENV} to "deployed". While it says "absent", planners are told that worker-backed runs cannot execute here — so if they can, that is what needs correcting.`,
    };
  }

  if (declaration === "absent") {
    return {
      ...base,
      status: "warn",
      detail:
        "This deployment declares that it runs no AequilibraE worker. Worker-backed model runs — Fast Screening network assignment and the behavioral-demand preflight — are refused at the launch button instead of being queued and then failed minutes later, and a sketch run whose study area is large enough to be rerouted onto that same queue is disclosed as unable to finish. Every other run mode, and every other module, works normally.",
      remedy: `${executionOptions} Whichever you choose, set ${MODELING_WORKER_DECLARATION_ENV} to "deployed" so launches stop being refused. Declaring no worker is a valid, honest configuration and costs nothing — OpenPlan is free either way; it only changes whether the refusal arrives before the run or after it.`,
    };
  }

  if (declaration === "unrecognized") {
    return {
      ...base,
      status: "warn",
      detail: pushDispatch.configured
        ? "This deployment sets a modeling-worker declaration to a value OpenPlan does not understand, so it is being ignored. Nothing is being guessed from it. It costs less than it used to: this deployment also configures an endpoint OpenPlan pushes each worker-backed run to, so a planner is told at launch whether anything took their run rather than after it has been abandoned."
        : "This deployment sets a modeling-worker declaration to a value OpenPlan does not understand, so it is being ignored. Nothing is being guessed from it: the launch controls fall back to inferring a missing worker from runs that were already queued and abandoned, which means the first worker-backed run still has to be wasted before anyone can be warned.",
      remedy: `Set ${MODELING_WORKER_DECLARATION_ENV} to "deployed" if the AequilibraE worker runs against this deployment, or "absent" if it does not. ${executionOptions}`,
    };
  }

  if (declaration === "deployed") {
    if (nonTerminalRunCount > 0) {
      return {
        ...base,
        status: "pass",
        detail: `${runsInFlight} in flight and progressing, and this deployment declares that an AequilibraE worker runs against it.`,
        remedy: null,
      };
    }

    return {
      ...base,
      status: "pass",
      detail:
        "This deployment declares that an AequilibraE worker runs against it. The worker polls and has no heartbeat, so whether one is running at this moment cannot be observed from here — this reports the declaration, not a live check. The launch controls trust it until a run contradicts it.",
      remedy: null,
    };
  }

  /**
   * Undeclared, but this deployment configures somewhere to push runs.
   *
   * This is the one branch where the gap the declaration exists to close is
   * already closed by something better. The declaration is a statement made
   * once; a push endpoint is called at launch and either takes the run or does
   * not, so the planner is answered before they wait — which is the entire cost
   * the "undeclared" warning below is warning about. Passing here is therefore
   * not leniency, it is the check no longer having a gap to report.
   *
   * It claims nothing about the worker being able to FINISH what it accepts.
   * That is still only visible in the worker's own logs, and the detail says so.
   */
  if (pushDispatch.configured) {
    return {
      ...base,
      status: "pass",
      detail:
        nonTerminalRunCount > 0
          ? `${runsInFlight} queued or running here. This deployment configures an endpoint OpenPlan pushes each worker-backed run to, so whether anything accepted a run is answered at launch instead of being inferred later from runs that were abandoned. Acceptance is not completion: whether the worker finishes what it takes is visible only in its own logs.`
          : "This deployment configures an endpoint OpenPlan pushes each worker-backed run to, so whether anything accepted a run is answered at launch instead of being inferred later from runs that were abandoned. Acceptance is not completion: whether the worker finishes what it takes is visible only in its own logs.",
      remedy: null,
    };
  }

  // Undeclared, with nowhere to push. The app works; what is missing is the
  // ability to answer before the first run rather than after it, which is a real
  // cost a planner pays.
  //
  // The wording here is bound by the same limit spelt out above the `absent`
  // branch, and for the identical reason: a queued run that nothing has touched
  // is non-terminal and not yet stale, so it is counted here on a deployment
  // with no worker at all. "Something is executing them" would be a confident
  // claim drawn from the absence of a symptom — the one thing this whole check
  // exists to avoid — so it reports the counts and stops there.
  if (nonTerminalRunCount > 0) {
    return {
      ...base,
      status: "warn",
      detail: `${runsInFlight} queued or running here, and none has yet stopped making progress — which is not the same as something having picked them up, because until a run goes stale it looks identical whether a worker is serving it or nothing is. Nothing declares whether this deployment runs an AequilibraE worker, so before a run is queued OpenPlan still cannot tell a planner whether one exists — on a model with no worker-backed history, the first run is queued, waits, and is failed by the reaper before anything can warn them.`,
      remedy: `Set ${MODELING_WORKER_DECLARATION_ENV} to "deployed" or "absent" so the launch controls can answer before the first run rather than after it. ${executionOptions}`,
    };
  }

  return {
    ...base,
    status: "warn",
    detail:
      "No model runs are in flight, and nothing declares whether this deployment runs an AequilibraE worker. The worker is a poller with no heartbeat, so whether one is deployed cannot be observed until a run is queued — which means the first worker-backed run here is queued, waits, and is failed by the reaper before anything can warn the planner who launched it.",
    remedy: `Set ${MODELING_WORKER_DECLARATION_ENV} to "deployed" if you run the AequilibraE worker (workers/aequilibrae_worker/DEPLOY.md), or "absent" if you do not. Either answer lets the launch controls refuse or allow before a run is queued; unset, they can only infer from runs that have already been abandoned. ${executionOptions}`,
  };
}

/**
 * `warn`, not `fail`: a complete PDF still comes out either way. What changes
 * is how it is typeset, and the module's own line between the two statuses is
 * whether a named capability stops working — here it does not.
 */
function pdfRenderingCheck(facts: DeploymentHealthFacts): DeploymentCheck {
  if (facts.pdfRendering.browserEngineAvailable) {
    return {
      key: "pdf-rendering",
      label: "PDF exports",
      status: "pass",
      detail: "A browser rendering engine is available; PDF exports carry the styled layout.",
      remedy: null,
    };
  }

  return {
    key: "pdf-rendering",
    label: "PDF exports",
    status: "warn",
    detail:
      "No browser rendering engine is available on this deployment, so PDF exports are produced by " +
      "OpenPlan's built-in typesetter. Every section is present and nothing is shortened, but colours, " +
      "charts and table rules are not reproduced and non-Latin scripts are not rendered. HTML exports " +
      "are unaffected.",
    remedy:
      "Install Chrome or Chromium on the host and set CHROME_EXECUTABLE_PATH to its binary. " +
      "Deployments on Vercel or AWS Lambda get a bundled engine automatically and need no setup.",
  };
}

export function evaluateDeploymentHealth(facts: DeploymentHealthFacts): DeploymentHealth {
  const checks = [
    mapboxCheck(facts),
    censusCheck(facts),
    modelingWorkerCheck(facts),
    anthropicCheck(facts),
    pdfRenderingCheck(facts),
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
