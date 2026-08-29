import { redirect } from "next/navigation";

import { BuildIdentityLine } from "@/components/dashboard/build-identity-line";
import { DeploymentHealthPanel } from "@/components/dashboard/deployment-health-panel";
import { WorkspaceGeographyPanel } from "@/components/workspaces/workspace-geography-panel";
import { WorkspaceIntegrationKeysPanel } from "@/components/workspaces/workspace-integration-keys-panel";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { WorkspaceStageGatePanel } from "@/components/workspaces/workspace-stage-gate-panel";
import { WorkspaceTeamPanel } from "@/components/workspaces/workspace-team-panel";
import { JurisdictionReadinessPanel } from "@/components/jurisdiction-readiness/jurisdiction-readiness-panel";
import { evaluateDeploymentHealth } from "@/lib/config/deployment-health";
import {
  loadModelingWorkerFacts,
  readDeploymentEnvFacts,
  resolveModelingWorkerDeclaration,
} from "@/lib/config/deployment-health-facts";
import { loadModelingWorkerHealth } from "@/lib/models/worker-health-server";
import {
  buildStageGateRebindChoices,
  STAGE_GATE_BINDING_WORKSPACE_COLUMNS,
} from "@/lib/stage-gates/rebind";
import { createClient } from "@/lib/supabase/server";
import { moduleMetadata } from "@/lib/ui/page-title";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { buildJurisdictionReadinessPayload } from "@/lib/jurisdiction-readiness/payload";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";
import { parseWorkspaceHomeGeography } from "@/lib/workspaces/home-geography";

export const metadata = moduleMetadata("Workspace setup & health");

export default async function WorkspacePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in?next=/workspace");

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);
  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Workspace setup & health"
        title="Workspace setup needs a workspace"
        description="Create or join a workspace before configuring its geography, team, integrations, delivery gates, or deployment health."
        primaryHref="/projects"
        primaryLabel="Create or open a project workspace"
      />
    );
  }

  const workspaceId = membership.workspace_id;
  const canManage = membership.role === "owner" || membership.role === "admin";
  const workspaceRead = await supabase
    .from("workspaces")
    .select(STAGE_GATE_BINDING_WORKSPACE_COLUMNS)
    .eq("id", workspaceId)
    .maybeSingle();
  const stageGateChoices = buildStageGateRebindChoices(workspaceRead.data, {
    readError: workspaceRead.error,
  });
  const workspaceGeography = parseWorkspaceHomeGeography(workspaceRead.data);
  const jurisdictionReadiness = buildJurisdictionReadinessPayload(
    {
      countryCode: workspaceGeography?.home_country_code ?? null,
      subdivisionCode: workspaceGeography?.home_subdivision_code ?? null,
      label: workspaceGeography?.home_geography_label ?? null,
    },
    jurisdictionReadinessRegistrySha256(),
  );
  const deploymentHealth = canManage
    ? evaluateDeploymentHealth({
        ...readDeploymentEnvFacts(),
        modelingWorker: await loadModelingWorkerFacts(
          supabase as unknown as Parameters<typeof loadModelingWorkerFacts>[0],
          workspaceId,
        ),
      })
    : null;
  const modelingWorkerHealth = canManage
    ? await loadModelingWorkerHealth(resolveModelingWorkerDeclaration())
    : null;

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">Workspace setup & health</div>
          <div className="module-intro-body">
            <div className="flex flex-wrap gap-2">
              <div className="module-record-chip">
                <span>Role</span>
                <strong>{membership.role}</strong>
              </div>
            </div>
            <h1 className="module-intro-title">{workspace.name || "Your workspace"}</h1>
            <p className="module-intro-description">
              Configure the facts and services every project shares. This page is also where an
              owner checks whether the deployment and both modeling workers can do their jobs.
            </p>
          </div>
        </article>
      </header>

      {deploymentHealth ? (
        <DeploymentHealthPanel health={deploymentHealth} workerHealth={modelingWorkerHealth} />
      ) : null}

      <WorkspaceGeographyPanel workspaceId={workspaceId} canManage={canManage} />

      <JurisdictionReadinessPanel
        reports={jurisdictionReadiness.reports}
        downloadHref={`/api/workspaces/jurisdiction-readiness?workspaceId=${encodeURIComponent(workspaceId)}&download=1`}
      />

      <WorkspaceStageGatePanel
        workspaceId={workspaceId}
        canManage={canManage}
        choices={stageGateChoices}
      />

      <div id="workspace-team">
        <WorkspaceTeamPanel workspaceId={workspaceId} canManage={canManage} />
      </div>

      <div id="workspace-integrations">
        <WorkspaceIntegrationKeysPanel workspaceId={workspaceId} canManage={canManage} />
      </div>

      <BuildIdentityLine />
    </section>
  );
}
