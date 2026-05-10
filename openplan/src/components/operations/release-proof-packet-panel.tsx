import Link from "next/link";
import { ArrowRight, FileCheck2, ShieldAlert } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { releaseProofPosture, type ReleaseProofStatus } from "@/lib/operations/release-proof-packet";

function proofTone(status: ReleaseProofStatus) {
  switch (status) {
    case "pass":
      return "success" as const;
    case "next":
      return "info" as const;
    default:
      return "warning" as const;
  }
}

function proofLabel(status: ReleaseProofStatus) {
  switch (status) {
    case "pass":
      return "PASS";
    case "next":
      return "Next";
    default:
      return "Caveat";
  }
}

export function ReleaseProofPacketPanel() {
  return (
    <article className="module-section-surface" aria-labelledby="release-proof-packet-title">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">{releaseProofPosture.label}</p>
          <h2 id="release-proof-packet-title" className="module-section-title">
            {releaseProofPosture.title}
          </h2>
          <p className="module-section-description">{releaseProofPosture.summary}</p>
          <p className="mt-2 text-sm text-muted-foreground">{releaseProofPosture.wedge}</p>
        </div>
        <StatusBadge tone="warning">Supervised release</StatusBadge>
      </div>

      <div className="mt-5 module-record-list">
        {releaseProofPosture.proofItems.map((item) => (
          <div key={item.key} className="module-record-row">
            <div className="module-record-head">
              <div className="module-record-main">
                <div className="module-record-kicker">
                  <StatusBadge tone={proofTone(item.status)}>{proofLabel(item.status)}</StatusBadge>
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {item.label}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="module-record-title">{item.headline}</h3>
                  <p className="module-record-summary">{item.detail}</p>
                  <p className="font-mono text-[0.72rem] text-muted-foreground">{item.artifact}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="module-subpanel">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-800">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <div>
              <p className="module-summary-label">Required caveats</p>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                {releaseProofPosture.caveats.map((caveat) => (
                  <li key={caveat} className="flex gap-2">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-700/70" />
                    <span>{caveat}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="module-subpanel">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-600/25 bg-emerald-600/10 text-emerald-800">
              <FileCheck2 className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="module-summary-label">Operator path</p>
              <div className="mt-2 divide-y divide-border/60">
                {releaseProofPosture.actions.map((action) => (
                  <Link
                    key={action.href}
                    href={action.href}
                    className="flex items-start justify-between gap-3 py-2 text-sm transition hover:text-primary"
                  >
                    <span>
                      <span className="block font-semibold text-foreground">{action.label}</span>
                      <span className="block text-xs text-muted-foreground">{action.detail}</span>
                    </span>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
