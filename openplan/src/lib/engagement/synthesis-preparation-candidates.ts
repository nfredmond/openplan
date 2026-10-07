import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const id = z.string().uuid().transform(value => value.toLowerCase());
const row = z.discriminatedUnion("status", [
  z.object({ request_id: id, status: z.literal("queued"), lease_until: z.null() }).strict(),
  z.object({ request_id: id, status: z.literal("running"), lease_until: z.iso.datetime({ offset: true }) }).strict(),
]);

/** Read one bounded page from the explicit queue. The caller continues after
 * every nonempty page, including short pages, then wraps after an empty page.
 * Discovery is a hint: native claim rechecks status, expiry and requester access.
 */
export async function listSynthesisPreparationCandidates(args: {
  service: Pick<SupabaseClient, "from">;
  after: string | null;
  signal: AbortSignal;
  now?: Date;
}) {
  const after = args.after === null ? null : id.parse(args.after);
  const now = z.date().parse(args.now ?? new Date()).toISOString();
  args.signal.throwIfAborted();
  const bounded = AbortSignal.any([args.signal, AbortSignal.timeout(10_000)]);
  let query = args.service.from("engagement_synthesis_preparation_jobs")
    .select("request_id,status,lease_until")
    .or(`status.eq.queued,and(status.eq.running,lease_until.lte.${now})`)
    .order("request_id", { ascending: true }).limit(64);
  if (after !== null) query = query.gt("request_id", after);
  const response = await query.abortSignal(bounded);
  bounded.throwIfAborted();
  if (response.error) throw new Error("Preparation queue inventory unavailable");
  const page = z.array(row).max(64).parse(response.data);
  let previous = after;
  for (const candidate of page) {
    if ((previous !== null && candidate.request_id <= previous) ||
      (candidate.status === "running" && Date.parse(candidate.lease_until) > Date.parse(now))) {
      throw new Error("Preparation queue inventory differs");
    }
    previous = candidate.request_id;
  }
  return { requestIds: page.map(candidate => candidate.request_id), nextAfter: page.length ? previous : null };
}
