# Lead review of the T3 Code research

October 15, 2026 UTC. Codex technical and product review of the [Opus report](REPORT.md). These are recommendations, not changes to the roadmap or acceptance claims.

## Useful next applications

The report identifies 15 candidates and maps them to existing OpenPlan capabilities. I would start with these five when their current roadmap work comes forward:

1. **Maintain tested CLI compatibility.** Keep a dated set of accepted provider versions, recorded protocol fixtures and visible usage-limit states. Preserve refusal for versions that have not passed the required checks.
2. **Make assignments recoverable and their waits visible.** Show whether work is queued, running, stopped or awaiting a person's decision. Connect this to existing worker journals and the unfinished worker-observation candidate. A process heartbeat does not establish job completion.
3. **Guide review of changed plans and documents.** Code identifies every changed section; optional AI explains the changes. Mark the explanation stale when either source version changes. This fits RTP predecessor updates, OWP successors and document revisions.
4. **Watch source changes.** Detect changes to grant deadlines, feed versions and rule sources, then create a review item. Keep source bytes, retrieval details and unresolved results visible.
5. **Make independent operation easier.** Add dependency notices, readable diagnostic records and upgrade preflight checks to the existing installation and recovery work. Their operating cost and acceptance remain unmeasured here.

Tool authority declarations remain an important prerequisite for the already-planned MCP surface. The existing approval registry, original actor, workspace binding and exact payload custody must carry through that interface.

## A narrower offline pattern deserves consideration

Opus groups native apps and offline caches among the items it would not prioritize. I would keep a smaller web recovery pattern in the research candidates. [CORE-INCLUSIVE-01](https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/docs/product/CORE_REQUIREMENTS_LEDGER.md#L56) requires low-bandwidth workflows and interrupted connections. [ORG-01](https://github.com/nfredmond/openplan/blob/1b2fefe0f0e98f99700fc77e99146fe697b43ee7/docs/product/CORE_REQUIREMENTS_LEDGER.md#L133) requires evidence from a small or rural office with limited connectivity.

The transferable idea is preserving unsent drafts and clearly distinguishing pending, accepted and failed writes in existing web workflows. T3's [offline mobile proposal](https://github.com/pingdotgg/t3code/pull/18351) is a source to investigate for recovery patterns. This does not require choosing native mobile apps. Any eventual design must revalidate the actor, workspace and permission when reconnecting, retain exact command identity, and distinguish a local draft from a submission the server accepted. Tribal data controls require their own case and authorization.

This is a product-fit disagreement with the broad offline deferral, not a new queued module or a completed design. The Opus conclusion remains visible in its report.

## What the evidence establishes

The study inventories 13,199 all-state PRs through PR19702, screens their metadata, inspects 72 selected proposals and examines pinned source paths. Opus reports reading the 117 first-party documentation files; its coverage script establishes retrieval. The full-body keyword supplement covers every captured PR body but does not establish semantic review of every PR. No patch audit, live T3 test, provider acceptance, planner observation or scientific validation occurred.

The report identifies existing OpenPlan work and explicitly separates the unmerged PR327 and PR328 candidates. The original research package and private tool transcript remain outside the repository. No application code, production configuration or roadmap queue changed for this study. Independent second-host installation and restore acceptance remain open.
