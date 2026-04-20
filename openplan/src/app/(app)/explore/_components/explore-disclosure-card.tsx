"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DisclosureItem } from "./explore-results-types";

type ExploreDisclosureCardProps = {
  disclosureItems: DisclosureItem[];
};

export function ExploreDisclosureCard({ disclosureItems }: ExploreDisclosureCardProps) {
  return (
    <Card className="analysis-explore-surface analysis-explore-surface-warning">
      <CardHeader className="gap-3 border-b border-white/8 px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warning">Release guardrail</StatusBadge>
          <StatusBadge tone="neutral">Client-safe disclosure</StatusBadge>
          <StatusBadge tone="info">Human approval required</StatusBadge>
        </div>
        <div className="space-y-2">
          <CardTitle className="text-[1.02rem] font-semibold tracking-[-0.02em] text-white">Methods, Assumptions &amp; AI Disclosure</CardTitle>
          <CardDescription className="max-w-xl text-sm leading-6 text-slate-300/78">
            Audit notes that should travel with this result before it becomes a client memo, grant attachment, or public-facing narrative.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-6 py-5">
        <div className="rounded-[0.5rem] border border-amber-400/18 bg-amber-400/8 p-4">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-amber-200/80">Operator release note</p>
          <p className="mt-3 text-sm leading-6 text-slate-100/88">
            Treat the cards above as working analysis surfaces, not self-certifying deliverables. Before external use, verify citations, source posture, and equity implications.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {disclosureItems.map((item) => (
            <div key={item.title} className="rounded-[0.5rem] border border-white/8 bg-black/18 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-white">{item.title}</p>
                <StatusBadge tone={item.tone}>{item.tone === "warning" ? "Review" : item.tone === "info" ? "Disclosure" : "Assumption"}</StatusBadge>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-300/74">{item.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
