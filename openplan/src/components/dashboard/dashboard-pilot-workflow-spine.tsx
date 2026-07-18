import { PilotWorkflowHandoff } from "@/components/operations/pilot-workflow-handoff";

export function DashboardPilotWorkflowSpine() {
  return (
    <PilotWorkflowHandoff
      title="Move one planning story from context to packet"
      description="The shortest complete path through OpenPlan — from context to a board-ready packet."
    />
  );
}
