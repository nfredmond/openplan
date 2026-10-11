# Full local archive proof and corrected-helper native checks

The full local archive drill passes on unchanged `c6687b5a`. The
[retained summary](full-archive-c668.json) identifies that older helper and source.
It restores 360 tables and one Storage object between two fresh disposable
Supabase projects. The target decrypts the synthetic Vault canary, signs in with
the restored account and independently reconstructs both overlapping OWP cycles.
All 103 live RLS files pass: 1,492 tests pass and 125 skip.

The local run takes 2,925.454 seconds. Its runner has a 1 GiB limit and swap
disabled. The final systemd summary reports a rounded 854.6M peak. The last
observed exact peak is 896,159,744 bytes; this is an observation, not a recovered
final counter. All 12 source and target services have verified 1 GiB limits,
swap disabled and one CPU each. They are stopped after successful verification;
their containers, volumes, snapshots and files remain retained.

Earlier attempt01 fails before capture because the new checkout lacks installed
dependencies. The first dependency install reaches its 1 GiB cgroup limit. A
2 GiB retry succeeds with the locked Supabase CLI. Attempt02 fails because the
long proof-directory path exceeds the Node Unix socket path limit. Attempt03
uses a short private temporary directory. Those failed attempts and their stopped
owned services remain retained. None receives acceptance credit.

## The corrected helper has separate native evidence

The mounted-byte follow-up uses helper SHA-256
`48b93757069dd5d43cee9ef3c331db763b58debf9bb9c70d44518201d2951797`
at `d7e2dd8c`. It does not rewrite the older full archive result.

- [Current native controls](native-controls-current.json) pass baseline, harmless
  and restored decryption. Missing replacement and tampered payload leave actual
  SQLSTATE 22000. Missing restart leaves the owned target stopped. In-place
  replacement decrypts but fails the actual atomic-file identity assertion.
- [Current interrupted recovery](interrupted-recovery-current.json) stops after
  atomic replacement and before restart. A fresh Python process prepares from the
  saved intent while the target is stopped, restarts that target and decrypts the
  original record. It retains the old target key and unchanged source key.
- [Current recovery CLI](native-cli-current.json) uses the actual isolated Python
  entry point in the second retained owned synthetic cluster. Interrupted restart,
  harmless and restored controls pass. Tampered payload, omitted replacement and
  omitted restart cause actual CLI refusals. No rows or volumes change.
- [Serial preflight controls](serial-preflight-controls.json) protect source
  identity and job ordering. The private mocked harness has three baseline,
  harmless or restored passes, seven protected refusals and seven deliberate
  failures when their guards are removed. It launches no real jobs.

The first fresh-process script fails before invoking the helper because cleanup
indents its embedded child program. Its failed log and driver remain retained.
The corrected child compiles before retry. The target key step is restored in
`finally`, and the corrected fresh-process and CLI checks then pass.
[Driver hashes](native-current-driver-hashes.json) preserve both scripts.

The two synthetic native containers are stopped after successful checks. Their
records, volumes, keys and earlier proofs remain private and retained. The
original shared source container, source key, demo and hosted services stay
unchanged. Tests run serially after the full local drill.

## Independent review and CI proof step

The [GitHub review](https://github.com/nfredmond/openplan/pull/197#discussion_r4240453431)
independently identifies missing automatic key mutation execution at `7abec2d3`.
The correction adds explicit key paths and the runner command. The actual
[restore job](https://github.com/nfredmond/openplan/actions/runs/38119158316)
at `d7e2dd8c` completes its combined restoration proof step successfully at
06:49:01 UTC on October 11. The review thread is resolved after that check.
The full archive command and other current CI checks remain in progress.

## Remaining acceptance

Current candidate GitHub QA, shuffle, live RLS and full restore remain separate
checks. The older stable-bind full result does not establish the newer guard's
full archive acceptance. Current native checks establish the bounded key step
in retained synthetic fixtures. They do not establish complete installation,
protected service configuration, external worker journals, hosted or physical
replacement-host recovery. The full restore command still refuses existing capture and recovery
databases. Whole-workflow resumption remains open. V1 independent operation and recovery remain open.
