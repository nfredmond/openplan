# Engagement readiness test timing

GitHub CI run 37891504864 failed the shuffled suite at commit 553892275, seed
48963. The theme-choice test found the rendered complete status but immediately
observed the prior `onReadyChange(false)` call. The component delivers readiness
from a React effect; finding DOM text does not independently await that callback.

The test now waits for its existing last-call assertion. It still requires true
only after every contribution has a saved choice, no write requests, and false
on unmount. The component is unchanged.

The focused file passes all 30 tests with the CI seed before and after the fix;
the complete CI scheduling failure was not reproduced locally. A controlled
20 ms effect delay fails the old assertion and passes the corrected test.
A deliberately broken callback that always reports false still fails. Restored
production code passes. Source hashes and controls are retained in
`prototype/thematic-readiness-controls.json` with its executable verifier.

This addresses an unsupported test timing assumption. Full shuffled CI must
confirm the integration; focused tests are not a substitute for that result or
real browser acceptance. The earlier CI failure remains part of the record.
