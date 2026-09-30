# Complete context dependency preparation

September 30, 2026. Unreleased implementation after `a20346a2`. Focused tests, TypeScript, lint, the final fault campaign, full QA and shuffled tests pass. Main `0b9f37f8` also passes exact-commit GitHub CI and RLS isolation. This is dependency preparation for complete M9b generation, not contextual model execution or staff proposal import.

The new protocol reconstructs every source record and selected segment result before building a context inventory. It retains the request, source checksum, record inventory checksum, selected-result inventory checksum and native selection sequence. A sequence alone does not fix later output arrivals. The result checksum changes when a previously missing output arrives, so an earlier context inventory cannot silently acquire that later output.

Each record retains its source kind, checksum, byte size, original references and complete segment addresses, including attempt, capture checksum and disposition. Only selected comments and answers belong to the contribution inventory. Campaign context, historical definitions and survey sessions remain dependencies. Missing outputs remain incomplete. An empty selection requires no provider attempt.

A version-one traversal visits the target record, its reference edges and its segments, then follows retained references breadth first in their saved order. It emits each record once while preserving cycle edges and references to unavailable parents. Unknown historical configuration remains null in the original source. A named definition missing from the saved source is corruption and remains rejected by the existing source verifier. It is never replaced with a current definition.

Dependency pages retain the context manifest checksum, target, offset, next offset and exact page checksum. Both entry count and encoded UTF-8 bytes are bounded. Exact retries reproduce the page. Another manifest, invalid cursor, duplicate record address or inconsistent reference availability is refused. The terminal page also must fit its byte limit. Future traversal or encoding changes must preserve this version or use a new protocol version; a stored offset cannot silently change meaning.

## Verification

Full QA and shuffled seed `481938` each pass 16,411 tests with 1,041 explicit skips across 1,364 passing and 67 skipped files. The dependency audit reports zero vulnerabilities, and the Next.js 16.3.8 webpack build passes. This pure protocol adds no native database or worker execution path. The earlier history checkpoint has its own passing native, isolation and populated-upgrade evidence.

The corrected related suites pass 42 tests across three files. The new suite covers 301 selected comments plus a survey answer, a 301-comment reply chain, reply cycles, missing parents, question/session context, empty selection, late output arrival, graph substitution, exact replay and page boundaries. The complete graph remains memory resident. These fixtures do not establish maximum-corpus capacity.

The first expanded fixture named a historical definition absent from the saved source. The existing source guard correctly refused it. The corrected fixture uses null for unknown configuration and separately proves that a missing named definition is still refused.

The first mutation campaign preserved a harmless comment and caught 22 of 23 targeted faults. Removing the terminal-page size reserve survived because the tested byte limits missed the boundary. An exact-boundary test now catches that fault. The additional empty-terminal case also exposed a real defect: its header could exceed a 256-byte limit even with no dependency entries. The baseline failed that regression. A header check fixes it.

The final campaign preserves the harmless control and catches all 24 targeted faults. They exercise source/result authority, graph replay, omitted records/segments/references, participation inflation, missing output identity, invalid selection sequences, premature readiness, graph traversal, unavailable edges, duplicate visits, cursor progression, byte/entry/header limits and manifest identity. All temporary source mutations were restored. [The proof record](context-dependencies-proof.json) retains the initial survivor and failure logs as well as the corrected results.

These checks prove the exercised dependency accounting and page protocol. The caller must obtain the selection sequence from the authenticated history reader and retain the verified manifest checksum under a separately authorized stage request. A self-hashed graph or caller-supplied checksum is not access permission. Pages contain dependency addresses, not original model inputs. Quotes and byte identity also do not establish interpretation quality or representative participation.

## Required continuation

Next materialize the complete source and segment content from these exact retained addresses. Add versioned record/context tasks and durable stage requests without repurposing the frozen segment recipe. A current staff member may authorize a new stage from permitted history; that does not renew the departed requester's old execution permission. Preserve separate authorship and explicit resource authorization.

Continue resumable contextual processing, retained machine proposals and explicit acceptance into a new staff review revision. Keep earlier reviews and approvals attached to their original bytes. Add staff controls and identified desktop/390px recovery journeys when the workflow is connected. No route, provider call, native write, browser capability or complete generation claim is added by this dependency protocol.


The current integration boundaries were checked in the code. `synthesis-generation-worker-load.ts` reconstructs the version-one segment plan before accepting its sealed native header and each task. Migration 34 accepts one fixed segment recipe ID/hash and a segment-plan purpose. `synthesis-generation-api.ts` independently requires that frozen instruction/output schema and sends `synthesis_segment_v1` as the provider response format. Context addresses therefore cannot be passed through this path as if they were segment tasks. Extend the versioned request/plan/recipe handling explicitly, preserving old retry and dispatch behavior, before connecting contextual execution.

Exact main checks completed on September 30. [CI](https://github.com/nfredmond/openplan/actions/runs/36778213805) passes full QA and shuffled tests, each with 16,404 passing and 1,048 skipped tests. [RLS isolation](https://github.com/nfredmond/openplan/actions/runs/36778213781) passes 945 tests with 125 skips across 74 files. The seven-test difference from the local unit count reflects environment-dependent cases, not an interchangeable count.
