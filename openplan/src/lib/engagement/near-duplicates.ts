/**
 * E9 (near-duplicates) — group the fuzzy near-duplicate PAIRS from the
 * `engagement_near_duplicate_pairs` RPC (pg_trgm trigram similarity) into
 * connected clusters a moderator can collapse. Lexical SCREENING aid, NOT a
 * semantic/embedding model and NOT an automatic merge. Pure grouping (union-find)
 * so it is unit-testable; the loader takes an injected client.
 */

import { readEveryPageAsResult } from "@/lib/supabase/paged-read";

export const NEAR_DUPLICATE_DEFAULT_THRESHOLD = 0.55;
/** Server-side pair cap in the RPC (LIMIT). If the RPC returns this many, the
 * scan was truncated (e.g. a huge form-letter clique) and the app says so. */
export const NEAR_DUPLICATE_MAX_PAIRS = 2000;

export const NEAR_DUPLICATE_CAVEAT =
  "Near-duplicates are lexical (trigram) look-alikes over comment text — a screening aid to help collapse paraphrased or re-posted submissions. It is NOT a semantic/embedding match and never merges anything automatically; a moderator decides.";

export type NearDuplicatePair = {
  item_a: string;
  item_b: string;
  similarity: number | string;
};

export type NearDuplicateGroup = {
  itemIds: string[];
  /** Highest pairwise similarity within the group (0–1). */
  maxSimilarity: number;
};

export type NearDuplicateAnalysis = {
  groups: NearDuplicateGroup[];
  groupCount: number;
  /** Total items across all near-duplicate groups. */
  itemCount: number;
  threshold: number;
  /** True when the RPC hit its pair cap — grouping may be partial. */
  truncated: boolean;
  caveat: string;
};

/** Cluster near-duplicate pairs into connected components (union-find). Each
 * group carries its highest pairwise similarity. Groups are sorted by size then
 * similarity, and item ids within a group are sorted for determinism. */
export function groupNearDuplicates(pairs: NearDuplicatePair[]): NearDuplicateGroup[] {
  const parent = new Map<string, string>();

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root) as string;
    }
    // path compression
    let cur = x;
    while (parent.get(cur) !== undefined && parent.get(cur) !== cur) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (a: string, b: string): void => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const maxSimByRoot = new Map<string, number>();
  for (const pair of pairs) {
    union(pair.item_a, pair.item_b);
  }
  for (const pair of pairs) {
    const root = find(pair.item_a);
    const sim = typeof pair.similarity === "number" ? pair.similarity : Number(pair.similarity);
    if (Number.isFinite(sim)) {
      maxSimByRoot.set(root, Math.max(maxSimByRoot.get(root) ?? 0, sim));
    }
  }

  const membersByRoot = new Map<string, Set<string>>();
  for (const id of parent.keys()) {
    const root = find(id);
    const set = membersByRoot.get(root) ?? new Set<string>();
    set.add(id);
    membersByRoot.set(root, set);
  }

  const groups: NearDuplicateGroup[] = [];
  for (const [root, members] of membersByRoot) {
    if (members.size < 2) continue; // a group needs at least 2 items
    groups.push({
      itemIds: [...members].sort(),
      maxSimilarity: Math.round((maxSimByRoot.get(root) ?? 0) * 1000) / 1000,
    });
  }
  groups.sort((a, b) => b.itemIds.length - a.itemIds.length || b.maxSimilarity - a.maxSimilarity);
  return groups;
}

function classify(pairs: NearDuplicatePair[], threshold: number): NearDuplicateAnalysis {
  const groups = groupNearDuplicates(pairs);
  return {
    groups,
    groupCount: groups.length,
    itemCount: groups.reduce((sum, g) => sum + g.itemIds.length, 0),
    threshold,
    truncated: pairs.length >= NEAR_DUPLICATE_MAX_PAIRS,
    caveat: NEAR_DUPLICATE_CAVEAT,
  };
}

type RpcPageBuilder = {
  order: (column: string, options: { ascending: boolean }) => RpcPageBuilder;
  range: (
    from: number,
    toInclusive: number
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

type RpcClientLike = {
  rpc: (fn: string, params: Record<string, unknown>) => RpcPageBuilder;
};

/** Call `engagement_near_duplicate_pairs` (SECURITY INVOKER → caller RLS) and
 * group the pairs. Injected client → unit-testable; empty analysis on error.
 *
 * PAGED. The function may return up to `NEAR_DUPLICATE_MAX_PAIRS` (2,000) pairs,
 * but PostgREST stops a function result at `max_rows` (1,000 here) with no
 * error. A single read therefore never reached 2,000, so `truncated` could not
 * fire and half the pairs went missing unannounced. Similarity, then the pair
 * of ids, is a total order. */
export async function loadNearDuplicates(
  supabase: unknown,
  params: { workspaceId: string; campaignId?: string | null; threshold?: number }
): Promise<{ analysis: NearDuplicateAnalysis; error: string | null }> {
  const threshold = Math.min(0.95, Math.max(0.3, params.threshold ?? NEAR_DUPLICATE_DEFAULT_THRESHOLD));
  const client = supabase as RpcClientLike;
  const { data, error } = await readEveryPageAsResult<NearDuplicatePair>(
    (from, toInclusive) =>
      client
        .rpc("engagement_near_duplicate_pairs", {
          p_workspace_id: params.workspaceId,
          p_campaign_id: params.campaignId ?? null,
          p_threshold: threshold,
        })
        .order("similarity", { ascending: false })
        .order("item_a", { ascending: true })
        .order("item_b", { ascending: true })
        .range(from, toInclusive) as PromiseLike<{ data: NearDuplicatePair[] | null; error: { message: string } | null }>,
    "the near-duplicate pairs could not be read in full"
  );
  if (error) {
    return { analysis: classify([], threshold), error: error.message };
  }
  const pairs = data ?? [];
  return { analysis: classify(pairs, threshold), error: null };
}
