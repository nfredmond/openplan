import { GuidedComparisonSaveButton } from "@/components/scenarios/guided-comparison-save";
import { StatusBadge } from "@/components/ui/status-badge";

export function GuidedComparisonSavePanel({
  scenarioSetId,
  baseline,
  candidate,
  alreadySaved,
}: {
  scenarioSetId: string;
  baseline: { id: string; label: string };
  candidate: { id: string; label: string };
  alreadySaved: boolean;
}) {
  return (
    <div className="mt-5 rounded-[0.5rem] border border-sky-300 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <p className="text-sm font-semibold tracking-tight">Exact four-run comparison</p>
          <p className="text-sm text-muted-foreground">
            This guided path verifies the current AequilibraE and ActivitySim baseline and build files, identical
            network custody, and each run&apos;s own validation decision. The methods stay separate; this does not use
            the single-run Analysis Studio attachment above.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {alreadySaved ? <StatusBadge tone="success">Exact guided comparison is on file</StatusBadge> : null}
          <GuidedComparisonSaveButton
            scenarioSetId={scenarioSetId}
            baselineEntryId={baseline.id}
            baselineEntryLabel={baseline.label}
            candidateEntryId={candidate.id}
            candidateEntryLabel={candidate.label}
            refresh={alreadySaved}
          />
        </div>
      </div>
    </div>
  );
}
