import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

/**
 * Browser-tab titles for the signed-in app.
 *
 * Why this is a module rather than thirty hand-written `metadata` blocks:
 * 28 of the 32 signed-in pages declared no title at all, so every tab read
 * "OpenPlan | Free, open-source planning software" — the root layout's default.
 * Planners do not work in one tab. A project, the grant that funds it, the
 * report being drafted about it, and the RTP cycle it belongs to are open at
 * once, and every one of those tabs looked identical.
 *
 * The root layout declares `template: "%s · OpenPlan"`, so everything here
 * returns only the part BEFORE that suffix and never restates it. One place
 * spells the product name in a tab, and it is the layout.
 *
 * Ordering is deliberate: the most distinguishing words come first, because a
 * browser truncates a tab from the right. "Main St Bridge · Projects · OpenPlan"
 * still reads as "Main St Bridge…" in a narrow tab; "OpenPlan · Projects · Main
 * St Bridge" would not.
 */

/** A module landing page: `/projects` → "Projects · OpenPlan". */
export function moduleMetadata(moduleName: string, description?: string): Metadata {
  return description ? { title: moduleName, description } : { title: moduleName };
}

type RecordMetadataInput = {
  /** The table holding the record this page is about. */
  table: string;
  /** The column carrying the human name — `name` on projects, `title` on most others. */
  nameColumn: string;
  /** The record id from the route params. */
  id: string;
  /** Shown after the record name, and used ALONE when the record cannot be read. */
  moduleName: string;
  /** Appended for a sub-page of a record, e.g. "Edit" or "Draft document". */
  section?: string;
};

/**
 * A record detail page: `/projects/<id>` → "Main St Bridge · Projects · OpenPlan".
 *
 * The lookup uses the same cookie-scoped Supabase client the page body uses, so
 * row-level security applies exactly as it does to the page itself — every one
 * of these tables restricts SELECT to the viewer's workspace memberships. This
 * cannot expose a name the page would not already render in full.
 *
 * It never throws. `generateMetadata` runs before the page, so an exception here
 * would take down a page that would otherwise have rendered — over a tab title.
 * A record that cannot be read (deleted, not yours, database unreachable, env
 * unset) falls back to the module name, which is accurate and discloses nothing.
 */
export async function recordMetadata({
  table,
  nameColumn,
  id,
  moduleName,
  section,
}: RecordMetadataInput): Promise<Metadata> {
  const fallback = section ? `${section} · ${moduleName}` : moduleName;

  let recordName: string | null = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from(table)
      .select(nameColumn)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      /*
       * A tab title has nowhere to show a read failure, and inventing one is
       * not an option — so the fallback below is the honest answer either way.
       * What is NOT acceptable is discarding the failure: an operator staring
       * at thirty tabs that all say "Projects" needs a thread to pull, and
       * without this line there is none. This is the one place in the app where
       * "log it and carry on" is the whole correct response, because the caller
       * is Next.js and it has no surface to render an error into.
       */
      console.warn(
        `[page-title] could not read ${table}.${nameColumn} for id ${id}: ${error.message}`
      );
    } else {
      const value = (data as Record<string, unknown> | null)?.[nameColumn];
      recordName = typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    }
  } catch (thrown) {
    // createClient throws when its environment variables are unset, and cookie
    // access can throw during rendering. Same reasoning as above.
    console.warn(`[page-title] could not read ${table} for id ${id}: ${String(thrown)}`);
    recordName = null;
  }

  if (!recordName) {
    return { title: fallback };
  }

  const parts = section ? [recordName, section, moduleName] : [recordName, moduleName];
  return { title: parts.join(" · ") };
}
