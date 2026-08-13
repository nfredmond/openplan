import type { ComponentProps } from "react";
import { PilotWorkflowHandoff } from "@/components/operations/pilot-workflow-handoff";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { ProjectIdentityEditor } from "@/components/projects/project-identity-editor";
import { ProjectStageGateBoard } from "@/components/projects/project-stage-gate-board";
import { ProjectPostureHeader } from "./project-posture-header";
import { ProjectPostureUnified } from "./project-posture-unified";
import { ProjectSpineBoard } from "./project-spine-board";

/**
 * The Overview tab of a project: where this project stands, what its linked
 * lanes look like, which gate it is at, and what to do next.
 *
 * Extracted from the page for the ordinary reason — `page.tsx` has a hard line
 * ceiling and panel markup is the wrong thing to compress — and it keeps the
 * two posture panels next to the spine board they are read with.
 *
 * THE TWO POSTURE PANELS ARE BOTH HERE ON PURPOSE. They look like a duplicate
 * pair and are not: `ProjectPostureHeader` is the project's identity, its
 * portfolio position and its reporting state, all computed on this request;
 * `ProjectPostureUnified` is the funding and aerial posture SAVED on the
 * project row by the last closeout or evidence package, which is a different
 * claim with a different age and says so. The two spine panels genuinely did
 * say the same thing twice, and are now one `ProjectSpineBoard`.
 */
export function ProjectOverviewTab({
  postureHeader,
  aerialCachedPosture,
  aerialCachedPostureUpdatedAt,
  spineSummary,
  spineRollup,
  operationsSummary,
  stageGateSummary,
  stageGateRunOptions,
  canRecordDecision,
  identity,
  canWriteIdentity,
  workspaceHomeGeographyLabel,
}: {
  postureHeader: ComponentProps<typeof ProjectPostureHeader>;
  aerialCachedPosture: ComponentProps<typeof ProjectPostureUnified>["aerialPosture"];
  aerialCachedPostureUpdatedAt: string | null;
  spineSummary: ComponentProps<typeof ProjectSpineBoard>["summary"];
  spineRollup: ComponentProps<typeof ProjectSpineBoard>["rollup"];
  operationsSummary: ComponentProps<typeof WorkspaceCommandBoard>["summary"];
  stageGateSummary: ComponentProps<typeof ProjectStageGateBoard>["stageGateSummary"];
  stageGateRunOptions: ComponentProps<typeof ProjectStageGateBoard>["runOptions"];
  canRecordDecision: boolean;
  identity: ComponentProps<typeof ProjectIdentityEditor>["project"];
  canWriteIdentity: boolean;
  workspaceHomeGeographyLabel: string;
}) {
  const project = postureHeader.project;

  return (
    <>
      <ProjectPostureHeader {...postureHeader} />

      <ProjectPostureUnified
        rtpPosture={project.rtp_posture}
        rtpPostureUpdatedAt={project.rtp_posture_updated_at}
        aerialPosture={aerialCachedPosture}
        aerialPostureUpdatedAt={aerialCachedPostureUpdatedAt}
      />

      <ProjectSpineBoard summary={spineSummary} rollup={spineRollup} />

      <PilotWorkflowHandoff
        currentStep="context"
        projectId={project.id}
        title="Continue this pilot story"
        description={`${project.name} is the context anchor. Move next into analysis evidence, engagement signal, packet assembly, and readiness proof without losing the project thread.`}
      />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <WorkspaceRuntimeCue summary={operationsSummary} />
          <WorkspaceCommandBoard
            summary={operationsSummary}
            label="Across your workspace"
            title="What needs attention next"
            description={`Workspace priorities — packet, funding-window, and setup pressure — stay visible while you work on ${project.name}. Use this board to keep the project aligned with the rest of the workspace.`}
          />
        </div>

        <ProjectStageGateBoard
          stageGateSummary={stageGateSummary}
          workspaceId={project.workspace_id}
          projectId={project.id}
          canRecordDecision={canRecordDecision}
          runOptions={stageGateRunOptions}
        />
      </div>

      <ProjectIdentityEditor
        project={identity}
        canWrite={canWriteIdentity}
        workspaceHomeLabel={workspaceHomeGeographyLabel}
      />
    </>
  );
}
