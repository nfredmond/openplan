import type { ReadFailureLog } from "@/lib/ui/read-failures";
import { collectUnlessPending } from "./_read-lanes";

/**
 * Why a total summed from a count-checked read must be withheld, or null when
 * the read is whole (KI-2026-11-16-132). A failed read, or one whose length
 * differs from its exact count, is never summed: the Funding tab once summed
 * the six newest invoices as if they were all of them.
 */
export function countedReadWithheldReason(
  read: { error: unknown; count: number | null },
  loaded: number,
  words: { failed: string; withheld: string; records: string }
): string | null {
  if (read.error) return words.failed;
  if (read.count === loaded) return null;
  return `${words.withheld}: ${loaded} of ${read.count ?? "an unknown number of"} ${words.records} loaded.`;
}

type ObligationMilestoneClient = {
  from: (table: "project_milestones") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>;
      };
    };
  };
};

/**
 * Each award's completed obligation milestone date (KI-2026-11-16-140). A
 * completed obligation means the award's obligation is met, so the Funding
 * scan stops counting its due date. At most one obligation milestone per
 * award (unique index, 20260416000053). A failed read is logged and yields no
 * dates, which leaves the scan reading the due date as before.
 */
export async function loadObligationCompletedOnByAwardId(
  supabase: unknown,
  projectId: string,
  hasAwards: boolean,
  reads: ReadFailureLog
): Promise<Map<string, string>> {
  if (!hasAwards) return new Map();
  // Supabase clients here are untyped by convention; cast once where it enters.
  const result = await (supabase as ObligationMilestoneClient)
    .from("project_milestones")
    .select("funding_award_id, status, actual_date")
    .eq("project_id", projectId)
    .eq("milestone_type", "obligation");
  collectUnlessPending(reads, "obligation milestones for this project's awards", result);
  const rows = (result.error ? [] : result.data ?? []) as Array<{ funding_award_id: string | null; status: string | null; actual_date: string | null }>;
  return new Map(
    rows
      .filter((row) => row.funding_award_id && row.status === "complete" && row.actual_date)
      .map((row) => [row.funding_award_id as string, row.actual_date as string])
  );
}
