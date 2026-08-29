# v0.42 jurisdiction readiness proof

Release-source SHA: `5d934626e0e4130b7a9408a7f85760d7ae9441c1`  
App version: `0.42.0`  
Release evidence commit: `7b0576c3ea5ff14c52e619f7f03145112f210933`
Disposition: released as annotated tag `v0.42.0` after local and remote proof passed.

## Product proof

- A versioned registry now reports five planning jobs for California, Oregon, and Puerto Rico without substituting California rules or sources outside California. Unknown and multi-subdivision places remain explicitly unassessed.
- The workspace and project surfaces show the exact jurisdiction, status, limitations, authority, source member, and full SHA-256 evidence. Reports, assistant context, and frozen project evidence bundles carry the same five-cell payload.
- Registry SHA-256 `2a2fe3c38a86eb28daa2a8dbaa4e48f2ead5ffc7460dc6f37bd7a6132d52a7dc` is bound to downloads, report text, and project bundle evidence.
- Failed geography reads remain visibly unreadable rather than becoming an unassessed or zero state. The two download routes are caller-scoped and audited.
- First-week jobs 01 and 02 now exercise jurisdiction support through the existing project journey rather than adding a module or separate journey.

## Browser and custody proof

- The production build was opened through the signed-in landing page, then through Projects and `Example Corridor Improvements`, at 1440px and 390px.
- Oregon produced `partial, unavailable, partial, partial, unavailable`; Puerto Rico produced `partial, unavailable, partial, unavailable, unavailable`. Both exact JSON downloads carried all five jobs and the registry hash, with no California adapter or authority leakage.
- A real PDF packet and frozen project evidence bundle were generated through visible controls. Every bundle checksum passed; `project/jurisdiction-readiness.json` exactly matched the project download; the PDF contained the jurisdiction, place, and full registry hash.
- The frozen bundle SHA-256 was `5e7590a18b23e3c90f46d0d965df971a7696ec3b1c6c7fd133feae58093c9b56`.
- Desktop and mobile screenshots showed no horizontal overflow, including the full hash and download row. Browser console errors and failed HTTP responses were both empty.
- The local fixture's original unidentified place was restored after the proof, and its final download returned five unassessed records.

## Guard proof

- A harmless registry formatting mutation survived semantic hashing. Mutations to status, authority strength, registry expiry, source hashes, California fallback, evidence-bundle inclusion, report/assistant inclusion, and stale reviewed commits were killed by their focused guards.
- Reversing the opening-style equality check caused the focused Mapbox test to fail, proving the clean-console regression guard can detect a duplicate style request.
- The browser proof itself failed on stale accessible names, brittle URL timing, and a redundant post-sign-in dashboard reload. Each false assumption was removed; no product error was suppressed to obtain a clean console.
- Two independent implementation reviews found fail-open geography reads, incomplete assistant coverage, unhashed adapters, and status/authority/expiry guard gaps. All were repaired before release.

## Local release checks

- `qa:gate`: 1,147 test files passed with 12,750 tests passed and 97 skipped, followed by 16 live-RLS files with 127 tests, a zero-vulnerability production dependency audit, and a successful production build.
- `test:workers`: 49 worker suites passed across ActivitySim, AequilibraE, county on-ramp, OCR, and ODM workers.
- `product:direction:check` passed against the v0.42 review through 2026-09-28.
- The final signed-in production browser journey returned `outcomeReached: "yes"` with an empty console and failed-response list.

## Remote release proof

- CI run `33231018983` passed on reviewed commit `e6be853f`, including the QA gate, shuffled-order Vitest, modeling scripts, worker tests, and operations scripts.
- RLS Isolation run `33231019042` passed on the same reviewed commit.
- Upgrade Path run `33231367622` passed a populated `v0.41.0` to `e6be853f` in-place rehearsal with row and evidence-custody preservation.
- Modeling source-contract run `33231368867` passed the live FHWA HPMS schema probe.
- CI run `33231677830` and RLS Isolation run `33231677832` passed on release evidence commit `7b0576c3`.
- Annotated tag `v0.42.0` points to `7b0576c3ea5ff14c52e619f7f03145112f210933` and is pushed to origin.
