# September 12 release correction

The final QA run on 4e9de713 failed after the session paused. No v0.54.0 tag or
GitHub release was created. The seven failing catalog tests returned
`native_process_unavailable` before exercising their intended cases. Their
synthetic executable hardcoded `/usr/bin/node`; the runner uses its installed
Node runtime elsewhere. The fixture now uses `process.execPath`. Production
catalog handling and assertions are unchanged.

A read-only mount namespace ran the suite through `/tmp/node-runtime` while
masking `/usr/bin/node` with a non-executable file. The original fixture reproduced
all seven process-unavailable failures. The corrected fixture and a harmless
comment edit each passed all 11 tests; restoring the fixed path failed those
same seven tests. No host binary was modified. This proves portability across an
unavailable fixed Node path, not every possible runtime installation.
See [the receipt](catalog-node-path-checks.json).

The older Codex launcher also lacked reciprocal containment and scratch-root
checks already present in the newer adapters. Two focused tests demonstrated
that it accepted a credential profile inside scratch, directly or through a
symlink. The corrected launcher refuses both, and refuses filesystem-root
scratch before creating profile masks. The public connector always creates fresh
scratch children with `mkdtemp`; no public-path exploit was demonstrated.

Eight focused path tests passed without skips, preserving a valid sibling layout,
profile bytes and private-history masks. The mutation run retained one harmless
survivor and rejected eight targeted removals: reverse containment, scratch root,
profile root, equality, forward containment, each realpath resolution and private
history masking. Removing the scratch-root check reached an OS permission error
instead of the required explicit refusal. Root tests intentionally require an
unprivileged user. The test never changes the host root. These checks do not prove
protection against a hostile same-UID owner concurrently moving paths.
See [the mutation receipt](codex-overlap-mutations.json).

The full connector suite passed 382 tests with four native opt-in skips after
both corrections. Actual Codex 0.154.0 separately passed the two existing native
isolation/account-mode cases using synthetic credentials and a local scripted
endpoint. No real provider call or spend occurred. The unit path fixture does not
itself prove native isolation; the separate native run covers that boundary.

OpenCode desktop and 390px browser evidence remains bound to 1b5ba8be. No app or
OpenCode production change followed that acceptance. The Codex guard changes
only refused directory layouts; the valid native path was exercised separately.
All original failed CI and local logs remain in the private dated evidence
directory. Final CI must pass on the corrected release commit before tagging.

All final checks subsequently passed on 33a5fb0c; see the [publication receipt](publication.json).
