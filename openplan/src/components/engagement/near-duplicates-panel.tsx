import type { NearDuplicateAnalysis } from "@/lib/engagement/near-duplicates";

type ItemSnippet = { snippet: string; status: string };

const MAX_SNIPPETS_PER_GROUP = 8;

export function NearDuplicatesPanel({
  analysis,
  snippetById,
}: {
  analysis: NearDuplicateAnalysis;
  snippetById: Map<string, ItemSnippet>;
}) {
  if (analysis.groupCount === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No near-duplicate groups at the current similarity threshold ({Math.round(analysis.threshold * 100)}%).
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {analysis.groupCount} near-duplicate group{analysis.groupCount === 1 ? "" : "s"} · {analysis.itemCount}{" "}
        comments (trigram similarity ≥ {Math.round(analysis.threshold * 100)}%).
        {analysis.truncated ? " Large campaign — showing a bounded scan of the closest matches." : ""}
      </p>

      <div className="space-y-3">
        {analysis.groups.map((group, index) => {
          const shown = group.itemIds.slice(0, MAX_SNIPPETS_PER_GROUP);
          const hidden = group.itemIds.length - shown.length;
          return (
            <div key={group.itemIds.join(":")} className="border-l-2 border-border/60 pl-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-foreground">
                  Group {index + 1} · {group.itemIds.length} comment{group.itemIds.length === 1 ? "" : "s"}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">≈{Math.round(group.maxSimilarity * 100)}% similar</p>
              </div>
              <ul className="mt-1 space-y-0.5">
                {shown.map((id) => {
                  const item = snippetById.get(id);
                  if (!item) return null;
                  return (
                    <li key={id} className="text-xs leading-relaxed text-muted-foreground">
                      “{item.snippet}” <span className="text-[0.68rem]">· {item.status}</span>
                    </li>
                  );
                })}
              </ul>
              {hidden > 0 ? <p className="mt-0.5 text-[0.68rem] text-muted-foreground">+{hidden} more similar comment{hidden === 1 ? "" : "s"}</p> : null}
            </div>
          );
        })}
      </div>

      <p className="text-[0.7rem] leading-relaxed text-muted-foreground">{analysis.caveat}</p>
    </div>
  );
}
