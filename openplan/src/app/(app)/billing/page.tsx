import { redirect } from "next/navigation";

/**
 * `/billing` no longer exists as a concept — OpenPlan is free and open source,
 * with no subscription, no plan, and no checkout. What used to live here that
 * was REAL is the LAPM grant-reimbursement invoice register, which is now
 * `/invoicing`.
 *
 * This redirect exists because "billing" was a nav entry and a bookmarkable
 * surface for a long time, and the invoice register carries deep links
 * (workspace, project, filters, a focused invoice row) that planners have
 * saved. Dropping the route would break those silently; forwarding the query
 * string keeps every one of them working.
 */
export default async function BillingRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = (await searchParams) ?? {};
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(resolved)) {
    // The dead checkout round-trip params are deliberately dropped rather than
    // forwarded — there is nothing left to return from.
    if (key === "checkout" || key === "plan") continue;
    if (typeof value === "string") search.set(key, value);
    else if (Array.isArray(value) && value[0]) search.set(key, value[0]);
  }

  const query = search.toString();
  redirect(query ? `/invoicing?${query}` : "/invoicing");
}
