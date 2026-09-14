# Next implementation boundary: complete retained synthesis review

September 14, 2026. Engineering design following the controlled omissions and unconfirmed-save reproduction. This is not implemented or release evidence. M9b and the whole V1 contract remain open.

## Existing homes and seams

Extend Engagement and its current campaign Record/review flow. The present POST handler, ai-synthesis.ts and engagement-synthesis-panel.tsx own the mutable synthesis. Keep old ai_synthesis_json readable as legacy, with unknown source completeness, rather than fabricate a snapshot or silently replace its provenance.

The existing report snapshot implementation in migration 20261014000024 already captures full selected items, survey sessions/answers and retained configuration definitions, with a public/internal boundary and exact text hash. It also creates a report/job and includes unrelated whole-campaign decision history. Do not call queue_engagement_report as a hidden way to capture synthesis sources, because that creates an unintended report. Extract or reuse the relevant capture semantics in a narrowly scoped transaction, with regression checks preserving existing report/public-copy behavior. The shared data is the same contributions and configuration versions; a second mutable source registry would lose that relationship.

The translation-generation request/field/output tables and claim/dispatch/retain functions demonstrate durable request identity, worker fencing, retained outputs and explicit unresolved dispatch. Reuse those transaction and worker conventions for synthesis. Their rows remain translation-owned; do not reinterpret translation records as synthesis jobs. Review/export workers already retain exact inputs, checksums and files on retry. Reuse the common worker process and operating instructions where appropriate.

## Required first connected outcome

A planner selects the actual contribution scope, retains it, sees complete counts and category/question definitions, and can reopen the same source-linked draft after interruption. The saved scope must account for map comments/replies and survey answers, or explicitly disclose a planner-chosen exclusion before creation. Approved-only, dates, categories and internal/public-copy meaning are source selection choices, not implied completeness. Existing pending/private material stays private.

Capture the selected source bytes, identifiers, source versions, historical definitions, selection/counts and source hash in one consistent database snapshot. Keep source kind explicit, including item versus survey answer, and preserve original text/values without the 600-character prompt truncation. Configuration identity and captured label are distinct. Legacy contributions with no retained definition keep that missing history explicit. The request returns a durable ID only after persistence succeeds; an ambiguous response is recovered by the same request identity, not a fresh generation.

Default free local preparation computes complete category/question counts and source membership without an LLM. It does not assign neutral sentiment. Preserve not assessed separately from positive/mixed/neutral/negative. Category counting is not semantic clustering, meaningful staff interpretation or representative support; the UI and exports must say what was actually assessed.

Optional model work uses bounded batches derived from the retained full corpus, with an explicit coverage ledger and no dropped tail or silent text truncation. Long processing belongs in a resumable worker. Capture model/provider/prompt and exact source assignment per batch, persist results before advancing, and distinguish complete, failed, not processed and unresolved dispatch. Cost and private-source disclosure follow the existing exact approval/provider controls; never call a paid provider merely to verify this workflow. Unknown billing after an interrupted dispatch must not cause an automatic duplicate paid request.

Keep complete source membership separate from narrative citation samples. Model-proposed themes cannot inflate counts with duplicate fact IDs or hide unassigned sources. Staff can inspect source text and definitions, correct theme membership/wording with reasons, retain earlier results and approve the exact revised output. A new source capture or later contribution edit cannot rewrite a previous review. Staff review inside the product is part of accountable agency work, not a software-release approval gate.

Join reviewed themes to the existing response and decision records, preserving exact review/source identity. Public release is separate and uses the actual permitted public copies; staff access to an internal synthesis does not authorize publication of its source wording. Retained PDF/XLSX/open records must reconcile full included membership and reviewed counts, preserve originals after corrections, and remain independently usable. An unconnected source-builder library would not complete this outcome.

## Checks that must cover the joins

- Source and definition capture: 0, 300, 301 and multiple batches; a distinct final concern; same timestamp ordering; renamed/deleted current categories; legacy missing definition; survey choices and free text; replies; redacted and private originals; explicit scope exclusions.
- Custody and recovery: exact same request retry, changed payload conflict, interrupted creation/generation/result save, lease replacement, source edits during capture, later edits after capture, stale reviews, original/corrected hashes and missing result reads. Confirm native database behavior on a named disposable stack.
- Interpretation: complete deterministic counts, no invented sentiment, duplicate/unknown/unassigned model references, source text beyond the prompt segment, partial batch failure and retained minority input. Mocked model output tests do not measure model quality.
- Access: permitted staff reads, revoked membership, another workspace, anonymous/public endpoints, corrected public copies and stored/exported private content. Any agent write uses the registry and route-local exact approval, or an executable refusal.
- User outcome: enter from real navigation at desktop and 390px, keyboard review, source inspection, correction and same-request recovery; inspect consoles and exported artifacts. Do not use the old campaign header count as proof of the retained selection.
- Landing: focused harmless/targeted mutation evidence, applicable full QA/shuffle/RLS/worker and populated upgrade checks, then exact release-commit CI before a tag. No paid service, reset or human software-release gate is introduced.

The first delivered increment must remain coherent with this full outcome. A larger arbitrary cap, success-shaped unsaved response, uncited category label rewrite, or a first-300-only disclosure is not completion of M9b.
