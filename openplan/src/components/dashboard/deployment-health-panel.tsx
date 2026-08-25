import { AlertTriangle, Info } from "lucide-react";
import type { DeploymentCheck, DeploymentHealth } from "@/lib/config/deployment-health";
import type { ModelingWorkerHealth } from "@/lib/models/worker-health";

/**
 * Tells a workspace owner which capabilities this deployment currently cannot
 * provide, and why — so an empty map or an empty equity layer is never mistaken
 * for "there is no data for my area".
 *
 * SILENT WHEN HEALTHY. A panel that is always present becomes furniture and
 * stops being read; this renders nothing at all when every check passes.
 *
 * SHOWN TO OWNERS AND ADMINS, WORDED FOR BOTH KINDS OF READER. On a self-hosted
 * deployment the reader can act on `remedy`; on a hosted one they cannot change
 * an environment variable and the remedy is context for the conversation with
 * whoever operates it. So the consequence leads and the instruction follows,
 * rather than the panel telling a hosted tenant to go edit a server.
 */
export function DeploymentHealthPanel({ health, workerHealth }: { health: DeploymentHealth; workerHealth?: ModelingWorkerHealth | null }) {
  if (health.problems.length === 0 && !workerHealth) return null;

  const workerNeedsAttention = workerHealth
    ? [workerHealth.aequilibrae, workerHealth.activitysim].some((worker) => worker.state !== "fresh")
    : false;
  const blocked = health.status === "blocked" || workerNeedsAttention;
  const configProblems = health.problems.length > 0;

  return (
    <section
      className={
        blocked
          ? "rounded-xl border border-amber-400/60 bg-amber-50/60 p-5 dark:border-amber-900/60 dark:bg-amber-950/20"
          : "rounded-xl border border-border/70 p-5"
      }
      aria-label="Deployment configuration"
    >
      <div className="flex items-start gap-2">
        {blocked ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700 dark:text-amber-300" />
        ) : (
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {configProblems && blocked
              ? "Some capabilities are switched off by configuration"
              : configProblems
                ? "Some capabilities are limited by configuration"
                : workerNeedsAttention
                  ? "Modeling worker health needs attention"
                  : "Modeling workers are reporting"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {configProblems
              ? "These are settings of this OpenPlan deployment, not limits of your data or your area."
              : "This is deployment-wide operating health, not a reading about any model run already underway."}
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {health.problems.map((check) => (
          <DeploymentHealthRow key={check.key} check={check} />
        ))}
      </ul>
      {workerHealth ? (
        <div className="mt-4 border-t border-border/70 pt-3" data-testid="deployment-worker-health">
          <p className="text-sm font-medium">Modeling workers</p>
          {[workerHealth.aequilibrae, workerHealth.activitysim].map((worker) => (
            <p key={worker.kind} className="mt-1 text-xs text-muted-foreground" data-worker-state={worker.state}>
              {worker.kind === "aequilibrae" ? "AequilibraE" : "ActivitySim"}: {worker.reason}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DeploymentHealthRow({ check }: { check: DeploymentCheck }) {
  return (
    <li className="border-l-2 border-border/70 pl-3">
      <p className="text-sm font-medium text-foreground">
        {check.label}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {check.status === "fail" ? "unavailable" : "limited"}
        </span>
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">{check.detail}</p>
      {check.remedy ? (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">To enable it:</span> {check.remedy}
        </p>
      ) : null}
    </li>
  );
}
