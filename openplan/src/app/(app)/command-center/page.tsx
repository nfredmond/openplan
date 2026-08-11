import { redirect } from "next/navigation";

/**
 * `/command-center` no longer exists as its own page — the Overview dashboard
 * absorbed it in the 2026-08-10 navigation overhaul. The two pages rendered
 * the same workspace command board over the same operations summary, and the
 * command center's one unique element — the recent-actions audit feed — now
 * lives on the dashboard. Its 13-row module jump list is retired outright: the
 * labeled navigation rail is that list, on every page.
 *
 * This redirect exists because "Command Center" was a nav entry and a
 * bookmarkable page for a long time. Dropping the route would break saved
 * links silently; forwarding the query string keeps every one of them working.
 */
export default async function CommandCenterRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = (await searchParams) ?? {};
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") search.set(key, value);
    else if (Array.isArray(value) && value[0]) search.set(key, value[0]);
  }

  const query = search.toString();
  redirect(query ? `/dashboard?${query}` : "/dashboard");
}
