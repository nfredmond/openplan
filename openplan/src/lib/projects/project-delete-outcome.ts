import {
  assessProjectDelete,
  PROJECT_DELETE_RELATIONS,
  type ProjectDeleteAssessment,
} from "@/lib/projects/project-delete-preconditions";
import { countConstrainedCostedPlacements, countReferences } from "@/lib/api/reference-counts";

/**
 * What deleting THIS project would cost, read without deleting anything.
 *
 * WHY THIS IS A SHARED FUNCTION RATHER THAN ROUTE CODE. Until now the only way
 * to learn whether a project could be deleted was to press Delete: the DELETE
 * route counted the references and answered 409 with the list. That is a fine
 * refusal and a poor question — a planner had to attempt the irreversible thing
 * to find out whether it was possible, and the confirmation dialog that ought to
 * NAME what is attached had nothing to name it from. The dialog now asks this
 * first.
 *
 * The counting lives here, in one place, precisely so the pre-flight answer and
 * the answer the DELETE route enforces cannot drift apart. A pre-flight that
 * said "nothing is attached" while the route refused would be worse than no
 * pre-flight at all.
 *
 * IT IS NOT AN AUTHORISATION. The DELETE route still counts again inside the
 * same call that deletes. This read is advisory — rows can be added between the
 * two — and the route, not the dialog, is what refuses.
 */
export type ProjectDeleteOutcome =
  | {
      /**
       * A relation that could not be read is not a relation that is empty.
       * Callers must treat this as "cannot say", never as deletable.
       */
      kind: "unreadable";
      tables: string[];
      messages: string[];
    }
  | { kind: "refused"; assessment: ProjectDeleteAssessment }
  | { kind: "deletable"; assessment: ProjectDeleteAssessment };

type CountingClient = Parameters<typeof countReferences>[0]["supabase"];

export async function readProjectDeleteOutcome({
  supabase,
  projectId,
  onDegradedCount,
}: {
  supabase: CountingClient;
  projectId: string;
  /** Called when the constrained-costed refinement could not be read, so the caller can audit it. */
  onDegradedCount?: (message: string) => void;
}): Promise<ProjectDeleteOutcome> {
  const { counts, unreadable } = await countReferences({
    supabase,
    targets: PROJECT_DELETE_RELATIONS,
    value: projectId,
  });

  if (unreadable.length > 0) {
    return {
      kind: "unreadable",
      tables: unreadable.map((entry) => entry.table),
      messages: unreadable.map((entry) => `${entry.table}: ${entry.message}`),
    };
  }

  // The filtered count the severity rule needs: placements that are CONSTRAINED
  // AND COSTED read as `blocking`. This refines the refusal's COPY; it is not
  // its gate, so a failed read degrades to the evidence wording rather than
  // silently changing whether the delete is allowed.
  let constrainedCostedPlacementCount: number | null = null;
  if ((counts["project_rtp_cycle_links"] ?? 0) > 0) {
    const constrainedCosted = await countConstrainedCostedPlacements({ supabase, projectId });
    if (constrainedCosted.error) {
      onDegradedCount?.(constrainedCosted.error.message);
    } else {
      constrainedCostedPlacementCount = constrainedCosted.count;
    }
  }

  const assessment = assessProjectDelete(counts, {
    projectId,
    constrainedCostedPlacementCount,
  });

  return assessment.deletable ? { kind: "deletable", assessment } : { kind: "refused", assessment };
}

/** The refusal body both the pre-flight and the DELETE route answer with, so they cannot diverge. */
export function projectDeleteRefusalBody(assessment: ProjectDeleteAssessment) {
  return {
    headline: assessment.headline,
    alternative: assessment.alternative,
    blockers: assessment.blockers.map((blocker) => ({
      table: blocker.table,
      label: blocker.label,
      count: blocker.count,
      severity: blocker.severity,
      behavior: blocker.behavior,
      reason: blocker.reason,
      href: blocker.href,
    })),
  };
}
