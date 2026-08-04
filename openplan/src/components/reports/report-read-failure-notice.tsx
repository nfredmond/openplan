import { StateBlock } from "@/components/ui/state-block";
import type { ReadFailureLog } from "@/lib/ui/read-failures";

/**
 * What the report detail page could not read, said as a failed read rather than
 * as an answer.
 *
 * THE DEFECT THIS EXISTS FOR. A page that destructures only the data half of a
 * Supabase read gets `null` for both "there is nothing here" and "this query
 * failed", so it renders the second case using copy written for the first.
 * (Spelled out in prose rather than as the literal code shape, so this comment
 * cannot match the ratchet guard that scans for that shape.) On a
 * report packet that reads as "No packet — generate the first packet", or as a
 * drift row reporting an outage as records deleted since generation, in a
 * document an agency sends to a funder.
 *
 * Both surfaces live here rather than inline because the page has two return
 * paths (RTP and standard) plus an early failure return, and a disclosure that
 * exists on only some of them is the seam defect this repo keeps shipping.
 *
 * INTERNAL PAGE, so the database's own message is shown: the reader is the
 * person who can act on it. On a PUBLIC surface the same disclosure must state
 * THAT a read failed and never the database's message.
 */
export function ReportReadFailureDisclosure({ reads }: { reads: ReadFailureLog }) {
  if (!reads.any) {
    return null;
  }

  return (
    <StateBlock
      className="mb-4"
      tone="danger"
      title="Part of this report could not be read"
      description={`${reads.describe()} ${reads.messages().join(" · ")}`}
    />
  );
}

/**
 * The whole-page state for a report row that could not be READ.
 *
 * `if (!data) notFound()` is the same defect wearing a different face: it tells
 * a planner the report does not exist when the truth is that it could not be
 * read. A genuine absence still 404s; this is for the other case.
 */
export function ReportUnreadableShell({ message }: { message?: string | null }) {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Report</p>
        <h1 className="text-3xl font-semibold tracking-tight">This report could not be opened</h1>
      </header>
      <StateBlock
        tone="danger"
        title="The report record could not be read"
        description={`Nothing on this page could be loaded, because everything below is scoped to this report. This is a failed read, not a finding that the report was deleted or that it never existed. Reload, and if it persists give an operator this message: ${
          message ?? "no message reported"
        }`}
      />
    </section>
  );
}
