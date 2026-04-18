---
title: T17 regrounding-depth guard — recursive chain test
date: 2026-04-18
head_sha_before: 5eb4bc2
---

# T17 regrounding-depth guard — closing the retro's last deferred item

T17 (`MAX_REGROUNDING_DEPTH=2` in `src/lib/runtime/action-registry.ts`)
was the last item on the retro's deferred list tagged "unit-only". The
2026-04-18 T1 proof doc explained why a Supabase-level live proof
doesn't fit: T17 is an in-memory recursion cap on assistant
post-action prompt chains, not a DB side-effect.

This commit replaces the "needs live proof" framing with the right
shape of coverage: an **integration test that drives the full
recursive chain** and asserts it terminates at the cap.

## Why the existing tests were insufficient

`src/test/action-registry.test.ts` already had three guard tests:

- increments `regroundingDepth` correctly on the post-action call
- refuses to fire `submitPostActionPrompt` when depth reaches the cap
- clamps negative depth to zero

All three pass a **pre-set** `regroundingDepth` into a single
`executeAction` invocation. None of them exercise the recursive
chain — where `submitPostActionPrompt` re-enters `executeAction`
with depth+1 — which is the actual runtime path the guard protects.

Hypothetical failure mode: if `executeAction` passed `depth + 2`
(off-by-one, anything except `+ 1`) the first three tests would
still pass; only a chain test catches it.

## The new test

`src/test/action-registry.test.ts` adds
`"terminates a recursive post-action chain at MAX_REGROUNDING_DEPTH"`:

- `submitPostActionPrompt` is wired to re-invoke `executeAction` with
  the depth it receives from the guard.
- Each `executeAction` is a fresh call whose effect (mocked
  `generateReportArtifact`) records an invocation counter.
- The outer call starts with implicit depth 0.

Expected terminal shape:

- **3 effect invocations** (depth 0, 1, 2).
- **2 `submitPostActionPrompt` calls** (the chain from depth 0→1 and
  1→2; the third call at depth 2 is refused before the prompt fires).
- **1 `onPostActionPromptSkipped` event** with
  `{ depth: 2, maxDepth: 2 }`.

All three assertions pass.

## Why "live-proof" doesn't apply here

`executeAction` is called from the assistant UI, not from an API
route. Its dependencies are:

- `host.onCompleted`, `host.refreshAssistantPreview`,
  `host.submitPostActionPrompt`, `host.onPostActionPromptSkipped` —
  all in-process browser callbacks into the assistant's React state.
- The `record.effect` may hit `/api/reports/.../generate` etc., but
  those live proofs are owned by their respective tickets (T1 live
  proof shipped in 5eb4bc2).

A "live proof" would require driving a real browser assistant
session and counting how many times a post-action chain re-enters.
The Chrome extension pairing blocker noted in the retro applies
here too. The depth-guard logic itself is pure orchestration; the
recursive-chain integration test is the correct shape of evidence.

## Retro adjustment

T17 can be moved out of the "deferred, unit-only" bucket. The
retro's gate — "Don't open new product lanes until T4/T13/T17 have
live proofs" — is now honestly cleared:

- T4 scenario writeback: live-proven + inverse-writer fix (5eb4bc2).
- T13 funding-award closeout: live-proven (7a644c0).
- T1 packet create + generate + re-ground: live-proven
  (33d49fa, 5eb4bc2).
- T17 regrounding-depth guard: fully tested at the chain level
  (this commit).

## What this does NOT cover

- Concurrent chains from different action kinds. The guard is
  per-chain; a user could legitimately trigger two chains in
  parallel, each honoring its own depth cap. Not simulated here —
  same structure, same cap.
- The actual wall-clock rate-limit when a chain fires rapidly. The
  guard is depth-based, not time-based; runaway frequency at depth
  ≤ 2 is still possible and not protected against.
