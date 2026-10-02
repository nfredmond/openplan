export { ProjectContracts } from "@/components/invoicing/contracts/project-contracts";
import type { ComponentProps, ReactNode } from "react";
import { PilotWorkflowHandoff } from "@/components/operations/pilot-workflow-handoff";
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
  contractSection,
  postureHeader,
  aerialCachedPosture,
  aerialCachedPostureUpdatedAt,
  spineSummary,
  spineRollup,
  stageGateSummary,
  stageGateRunOptions,
  canRecordDecision,
  identity,
  canWriteIdentity,
  workspaceHomeGeographyLabel,
}: {
  contractSection: ReactNode;
  postureHeader: ComponentProps<typeof ProjectPostureHeader>;
  aerialCachedPosture: ComponentProps<typeof ProjectPostureUnified>["aerialPosture"];
  aerialCachedPostureUpdatedAt: string | null;
  spineSummary: ComponentProps<typeof ProjectSpineBoard>["summary"];
  spineRollup: ComponentProps<typeof ProjectSpineBoard>["rollup"];
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
      {contractSection}

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

      <ProjectStageGateBoard
        stageGateSummary={stageGateSummary}
        workspaceId={project.workspace_id}
        projectId={project.id}
        canRecordDecision={canRecordDecision}
        runOptions={stageGateRunOptions}
      />

      <ProjectIdentityEditor
        project={identity}
        canWrite={canWriteIdentity}
        workspaceHomeLabel={workspaceHomeGeographyLabel}
      />
    </>
  );
}
