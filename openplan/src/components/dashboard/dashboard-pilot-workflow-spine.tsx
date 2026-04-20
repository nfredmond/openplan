import { PilotWorkflowHandoff } from "@/components/operations/pilot-workflow-handoff";

export function DashboardPilotWorkflowSpine() {
  return (
    <PilotWorkflowHandoff
      title="Move one planning story from context to packet"
      description="This is the shortest complete path through OpenPlan for a supervised pilot walkthrough."
    />
  );
}
