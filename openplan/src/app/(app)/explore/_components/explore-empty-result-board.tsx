import Link from "next/link";
import {
  CORRIDOR_ANALYSIS_ANSWERS,
  CORRIDOR_ANALYSIS_DOES_NOT_ANSWER,
  CORRIDOR_ANALYSIS_TRAFFIC_HREF,
} from "@/lib/analysis/what-this-answers";
import { withPlanningContext } from "@/lib/projects/planning-context";

export function ExploreEmptyResultBoard({ projectId = null }: { projectId?: string | null }) {
  return (
    <section className="analysis-studio-surface analysis-studio-surface--empty">
      <div className="analysis-studio-heading">
        <p className="analysis-studio-label">Result board</p>
        <h3 className="analysis-studio-title">No analysis selected</h3>
        <p className="analysis-studio-description">Run a corridor analysis or load a prior run to review metrics, narrative output, and comparisons.</p>
        {/*
          SAID BEFORE THE SETUP, not after the result. A tester spent three steps
          and a wait to discover this tool does not answer "how much traffic" —
          the question they had been sent to answer. It looks like the right tool
          right up until the result arrives, which is what made it expensive.
        */}
        <p className="analysis-studio-description">
          {CORRIDOR_ANALYSIS_ANSWERS} {CORRIDOR_ANALYSIS_DOES_NOT_ANSWER}{" "}
          <Link href={withPlanningContext(CORRIDOR_ANALYSIS_TRAFFIC_HREF, projectId)} className="underline underline-offset-2">
            Run a travel model
          </Link>
          .
        </p>
      </div>
      <div className="analysis-studio-inline-meta">
        <p className="analysis-studio-inline-meta-label">Next step</p>
        <p className="analysis-studio-inline-meta-value">Set the study area, enter the planning question, and run the study to populate this board.</p>
      </div>
    </section>
  );
}
