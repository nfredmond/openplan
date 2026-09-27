# Complete synthesis sources in response links

September 27, 2026. Unreleased implementation after v0.63.0. This advances M9b within Engagement. It does not complete source-to-response-to-decision traceability, M9b or V1.

## Retained context reader

`openplan/src/lib/engagement/synthesis-response-context-server.ts` reads a private, versioned context that binds a complete retained source packet, deterministic preparation, exact reviewed content, a specific staff approval event, a selected review group and an exact response history version. It preserves original text and hashes rather than translating survey answers into comment IDs or truncating groups to the legacy response writer's 300-item limit. The complete review retains overlap and unassigned input alongside the selected group. Preserve the returned original packet bytes; do not reserialize enriched parsed fields against the old hash. Existing decision context schema 1 remains unchanged.

The reader reuses the existing source, preparation, review-content and approval verifiers. It verifies the response history bytes and their campaign/response identity. It rejects a withdrawal event as the approval for a new context and rejects a removed response history event as the original link target. Later withdrawal, correction or removal must leave previously retained contexts readable and visibly historical.

This is a protocol reader, not an authorization mechanism. Hashes bind bytes, not authority. It does not establish that the supplied approval is current or that the response still exists. The future authenticated loader and native writer must verify complete saved review lineage, current membership, both current version heads and exact retry identity. Context readers must not substitute for those transaction checks. No new route, writer, migration, browser control or public export uses this reader yet.

## Verification so far

The focused suite has 30 checks. It covers 301 comments plus a survey answer, answer-only groups, original historical question definitions, long Unicode wording, overlap and unassigned input, rehashed source metadata/definition faults, invalid Unicode, wrong scope, changed bytes, different approval versions and a removed target history event.

[Mutation evidence](context-mutations.json) records 33 expected outcomes: baseline and harmless comment controls pass; 31 targeted faults fail at the named checks. Faults include truncating membership or wording, dropping answers, bypassing the source/approval verifier calls and removing checksum, scope or revision comparisons. Some scope checks overlap. The tests establish protocol behavior, not live authorization or a public disclosure boundary. The harness restores the source after each case and on exit.

The first test run used an unsupported `toEndWith` matcher. Replacing it with a supported regular-expression assertion yields the expected passing baseline. A standalone type check exhausts Node's default heap; the implementation passes with the repository's 6144 MB build allowance. The final full QA run exits successfully with 15,651 passing and 628 explicitly skipped tests in 1,331 passing and 59 skipped files. Lint, the configured dead-code check, provider connector checks, dependency audit and production build pass. Existing unused export/type warnings remain visible. The final build also checks the refined test fixtures. [Check evidence](checks.json) retains private log hashes. No database or worker implementation changes here; live isolation and worker execution were not rerun for this protocol-only checkpoint. Native-write and browser acceptance remain required when those paths are implemented.

## Survey change and public-copy boundary

Source inspection finds one definition of `review_engagement_survey`, in `20260908000006_engagement_survey_receipts.sql`. It locks a survey session, compares its version, changes answer text/JSON for reviewed redactions, changes session status and retains before/after history. It does not acquire the response campaign lock or call `withdraw_engagement_source_responses`. The current withdrawal helper selects legacy comment IDs and reply parents. These are existing independent workflows; a new survey-derived response link must join them before becoming publishable.

Current public report selection in `20261014000023_engagement_public_copy_privacy.sql` permits approved survey sessions and their selected answers, strips session contact/moderation fields for public output, and filters response sources through the legacy item list. An empty legacy list must not let a new answer-derived response bypass its actual source checks. Review and approval reasons and original private context stay outside public response payloads.

## Next implementation boundary

1. Add authenticated context loading from complete saved review/approval and response histories. Preserve actual stored response text instead of reserializing it against an old hash.
2. Add immutable link events and complete normalized source dependencies for comments, replies and answers. Enforce current staff scope, exact old retry, current approval/review/response heads and a consistent transaction lock order. Keep historical contexts readable after changes.
3. Join source changes, survey review/redaction, response edits, link withdrawal and public eligibility. Test both commit orders and genuine concurrent requests. Trace every existing public portal/report/export reader before enabling publication.
4. Extend response-to-decision context with independently verified synthesis provenance while keeping original schema 1 bytes readable.
5. Connect the existing Analysis, response and decision controls. Exercise original/corrected history, current access loss, interrupted retries, public/private artifacts and desktop/390px keyboard navigation on an identified build.
6. Complete reviewed synthesis exports and optional complete resumable generation under the existing roadmap. Neither this protocol nor the eventual link alone completes M9b.

No software-release human review gate applies. The full all-state/DC, California, territory/tribal/overlapping-authority and separate model-validation requirements remain intact.
