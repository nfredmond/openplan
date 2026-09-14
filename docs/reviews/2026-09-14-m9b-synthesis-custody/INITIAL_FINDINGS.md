# M9b synthesis source coverage and saved review

September 14, 2026, inspected at release candidate 291ce88a. Read-only investigation while v0.61.1 final CI runs. No synthesis implementation has started. The roadmap remains the queue and the complete V1 contract remains binding. Extend Engagement; do not create a new module or paid service.

## Reproduced finding

[Pure deterministic reproduction](cap-reproduction.json) supplied a different last category in 300 and 301 synthetic comments, by directly invoking the deterministic function; no model function was invoked and network traffic was not instrumented. At 300, the final source fact and its one-comment category survive. At 301, the final source fact and its category disappear, while item_count reports 301 and analyzed_item_count 300. The first source fact is present in both; the control proves the absence check can be true or false. This is not yet a route or browser reproduction.

## Source findings, not runtime claims

- `openplan/src/app/api/engagement/campaigns/[campaignId]/synthesis/route.ts` authorizes engagement.write, then reads only 300 approved items, oldest first. It passes that partial list to the generator. The query selects no total count or retained configuration identity; current category labels are looked up separately.
- `openplan/src/lib/engagement/ai-synthesis.ts` caps both source facts and deterministic category groups at 300 and prompt body text at 600 characters. Its header promises full deterministic counts and makes an unsupported competitor claim. The deterministic path assigns neutral sentiment without analyzing sentiment. Its cited aggregate sentences have faithfulness_checked:false; citation presence does not establish numeric/semantic support.
- The route writes one mutable ai_synthesis_json/ai_synthesized_at pair. If the update fails, it logs a warning and returns a success-shaped result. No retained review history or exact command identity is visible in this route. Reproduce this before changing recovery behavior.
- `engagement-synthesis-panel.tsx` introduces the analysis using the current approvedItemCount but does not display analyzed_item_count or a saved source selection. It offers Regenerate and shows sentiment/citation counts. Raw persisted synthesis is typed directly in the campaign page; inspect compatibility before introducing a stronger parser.
- `hotspots.ts` and the campaign page consume negative source IDs from synthesis. Any coverage, source or sentiment change must preserve unknown/unassessed states and check these downstream map/count filters.
- Existing tests in `engagement-ai-synthesis.test.ts` cover the model cap and citation guards. A prompt-size cap is deliberate; separating bounded model input from a complete source register is required, not deleting resource protection or raising an arbitrary threshold.

## Next engineering outcome to design and implement

A planner can retain a complete, explicit source selection, review source-linked themes and category counts, and recover the same draft after interruption. Later approved or changed contributions must not rewrite what an earlier draft used. Distinct/minority input must remain traceable after the 300th item. Free category grouping is not sentiment analysis; absent assessment must be explicit. AI-authored themes and responsible staff approval remain separate from public release and representative-support claims.

First read the current contract, roadmap, capability matrix and direction records, then the route/library/panel, source/configuration readers, response/decision history, job/lease and action-registry patterns. Reproduce the route truncation and save-failure behavior with harmless controls and targeted faults. Design retained full source/configuration bytes plus coverage, exact hashes and reviewed version history in the existing Engagement workflow. Preserve earlier mutable-format data as legacy/unknown rather than inventing prior source completeness. Source ownership, current-vs-retained definitions and private/public exposure need explicit tests.

Use resumable workers for work that can exceed 60 seconds. Keep model prompts bounded while processing a complete selected corpus, with durable interruption recovery. Make real free local operation useful; do not call a paid provider or change scientific/model defaults to get a pass. Do not settle for an honest first 300-only label as the full M9b outcome. Retained themes must connect to existing staff response/source/decision flows, and later exports must preserve the reviewed record. Human release review is not required; responsible agency review inside the product remains a distinct action.

Desktop/390px real navigation, keyboard, private-access, original/corrected artifacts, exact retries, live RLS and populated upgrade evidence will be needed for the eventual shipped workflow. M9b and all other early roadmap obligations remain open, including capital/RTP/provider/administration and separate nationwide AequilibraE/ActivitySim validation.
