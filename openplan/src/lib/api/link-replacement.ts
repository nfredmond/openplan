import { createClient } from "@/lib/supabase/server";

type SupabaseClientLike = Awaited<ReturnType<typeof createClient>>;

type SupabaseErrorLike = {
  message: string;
  code?: string | null;
};

export type StoredLinkSnapshot = {
  link_type: string;
  linked_id: string;
  label: string | null;
};

export type RestoreLinkSetResult = {
  ok: boolean;
  deleteError: SupabaseErrorLike | null;
  insertError: SupabaseErrorLike | null;
};

export type ReplaceLinkSetResult =
  | {
      ok: true;
      previousLinks: StoredLinkSnapshot[];
    }
  | {
      ok: false;
      stage: "snapshot" | "delete" | "insert";
      error: SupabaseErrorLike;
      previousLinks: StoredLinkSnapshot[];
      rollback?: RestoreLinkSetResult;
    };

function buildInsertRows(
  ownerColumn: string,
  ownerId: string,
  createdBy: string,
  links: ReadonlyArray<StoredLinkSnapshot>
): Array<Record<string, string | null>> {
  return links.map((link) => ({
    [ownerColumn]: ownerId,
    link_type: link.link_type,
    linked_id: link.linked_id,
    label: link.label,
    created_by: createdBy,
  }));
}

export async function restoreLinkSet(options: {
  supabase: SupabaseClientLike;
  table: string;
  ownerColumn: string;
  ownerId: string;
  createdBy: string;
  links: ReadonlyArray<StoredLinkSnapshot>;
}): Promise<RestoreLinkSetResult> {
  const { supabase, table, ownerColumn, ownerId, createdBy, links } = options;

  const { error: deleteError } = await supabase.from(table).delete().eq(ownerColumn, ownerId);
  if (deleteError) {
    return {
      ok: false,
      deleteError,
      insertError: null,
    };
  }

  if (links.length === 0) {
    return {
      ok: true,
      deleteError: null,
      insertError: null,
    };
  }

  const { error: insertError } = await supabase.from(table).insert(buildInsertRows(ownerColumn, ownerId, createdBy, links));

  return {
    ok: !insertError,
    deleteError: null,
    insertError,
  };
}

export async function replaceLinkSet(options: {
  supabase: SupabaseClientLike;
  table: string;
  ownerColumn: string;
  ownerId: string;
  createdBy: string;
  nextLinks: ReadonlyArray<StoredLinkSnapshot>;
}): Promise<ReplaceLinkSetResult> {
  const { supabase, table, ownerColumn, ownerId, createdBy, nextLinks } = options;

  const { data: existingLinks, error: snapshotError } = await supabase
    .from(table)
    .select("link_type, linked_id, label")
    .eq(ownerColumn, ownerId);

  if (snapshotError) {
    return {
      ok: false,
      stage: "snapshot",
      error: snapshotError,
      previousLinks: [],
    };
  }

  const previousLinks = (existingLinks ?? []) as StoredLinkSnapshot[];

  const { error: deleteError } = await supabase.from(table).delete().eq(ownerColumn, ownerId);
  if (deleteError) {
    return {
      ok: false,
      stage: "delete",
      error: deleteError,
      previousLinks,
    };
  }

  if (nextLinks.length === 0) {
    return {
      ok: true,
      previousLinks,
    };
  }

  const { error: insertError } = await supabase.from(table).insert(buildInsertRows(ownerColumn, ownerId, createdBy, nextLinks));
  if (insertError) {
    const rollback = await restoreLinkSet({
      supabase,
      table,
      ownerColumn,
      ownerId,
      createdBy,
      links: previousLinks,
    });

    return {
      ok: false,
      stage: "insert",
      error: insertError,
      previousLinks,
      rollback,
    };
  }

  return {
    ok: true,
    previousLinks,
  };
}
