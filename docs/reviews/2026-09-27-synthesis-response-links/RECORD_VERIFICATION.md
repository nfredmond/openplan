# Verified synthesis response records

September 27, 2026. Continues the concurrency checkpoint at `52973a70`. This server-side protocol reads native candidate records. Application routes, staff controls and migration activation remain unfinished.

## Retained event and history behavior

The event reader verifies original event text and its SHA-256, the exact campaign/workspace/review/response/group scope, supported private purpose and version, command identity and context digest. It then calls the existing complete context verifier. That verifier checks the retained source, deterministic preparation, reviewed content, exact approval and response history. All selected members remain available, including survey answers and groups above the legacy 300-comment limit.

The history reader requires the declared count, consecutive event numbers, distinct request IDs, exact predecessor IDs and hashes, and a matching final head. An explicitly empty history differs from an incomplete one. Withdrawal retains the preceding context bytes and cannot follow another withdrawal. A refresh after withdrawal may restore the same context; a refresh of an active link must change its meaning rather than only its outer JSON formatting.

All contexts in one review history retain the same source and preparation identity. Review, response and approval versions cannot move backward. The same version number cannot identify different records. A map across the full chain also prevents an immutable record ID from reappearing with different contents or a higher version number. The receipt reader compares the complete expected command, including actor, reason and request ID. A valid old receipt establishes an exact acknowledgement, not current publication eligibility.

These readers do not authorize access or prove that supplied records exist in the database. Authenticated native reads, route identity and transactional writers must retain those duties. The application must preserve the returned original packet bytes; serializing parsed objects again does not preserve the retained hash.

## Evidence and corrections

The unit fixtures use the existing source and review preparation functions. They cover original link, correction, withdrawal, renewed link, exact old acknowledgement, complete selected membership, empty history, invalid text, changed or rehashed data, scoped identity, predecessor/count/order/head changes and Unicode reasons. A 2,000-character supplementary-Unicode reason verifies character counting separately from UTF-16 length.

The first fixture uses `updated` as a response-history event. The existing protocol correctly rejects it; the fixture now uses the supported `corrected` event. An initial review-identity fault survives because the approval-identity assertion catches the same input. Revised fixtures advance unrelated versions so each required identity check can fail independently. Source identity and event ordering receive the same separation where another check could otherwise mask the intended failure.

Three tests then demonstrate a separate defect in the new reader: an immutable review, response-history or approval ID can appear at a higher version. All three promises resolve before the new record map. The map rejects those histories without changing valid withdrawal and renewed-link behavior.

Native integration runs the real candidate writer and authenticated history reader in a rollback transaction. The application verifies their link, withdrawal and renewed-link receipts, the complete three-event history, and recovery of the first request after later events. It compares the application result directly with PostgreSQL's original event text and checks all 302 selected members. A deliberately reserialized event and a truncated membership list each fail the native integration assertion. The baseline and harmless comment pass.

The focused unit suite passes 49 tests. Mutation proof has two surviving controls and 39 detected faults. Native proof has two surviving controls and two detected faults. Some invalid-text rejection checks overlap with nested parsers and protect error classification as well as denial. [Check evidence](record-checks.json) records source and private log hashes.

Full QA passes lint, dead-code checks, 15,759 tests, provider connector checks, a zero-vulnerability audit and production build. Shuffled testing passes the same 15,759 tests with seed 266644. Both ordinary runs skip 752 opt-in cases. This QA invocation does not run live RLS; the parent main commit has a separately passing RLS workflow, and the focused native reader integration runs on the named isolated stack. No candidate objects or disposable probe databases remain, and the installed migration count stays 347. Workers and populated upgrade are not rerun for this reader-only increment.

## Remaining integration

Add authenticated request and history loaders, service-write recovery bound to route-authenticated identity, and durable client intent. Connect the existing Analysis, response and decision controls; extend decision provenance without rewriting schema 1 history. Promote the candidate with populated-upgrade and installed-schema evidence. Complete identified desktop/390px navigation, keyboard, console and artifact verification before a release claim. These record readers do not complete M9b, reviewed exports, resumable generation or V1.

The [authenticated write-service checkpoint](WRITE_VERIFICATION.md) continues request recovery and transactional integration.
