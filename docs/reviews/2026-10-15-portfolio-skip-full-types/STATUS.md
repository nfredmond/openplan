# Full project TypeScript check passes after the import correction

The full unchanged project configuration passes with exit zero and an empty
compiler log. The check includes implementation and test roots. It does not
filter diagnostics or introduce exclusions. It emits no application build.
The corrected browser journey remains pending.

## Identified source and actual command

The checkout stays clean at
`f44251ef4da5345bb2d639ef55b8ad5d3e416e45` before and after compilation.
Its complete `openplan/` Git subtree matches the application binding at
`49e3fa2004c1336ffa36c134a8f21bcc2d72d327`. The intervening commit contains
the independent native-proof review only. Migration 17 and the focused tests
are included in this application subtree.

The parent runs the existing compiler wrapper without changing its bytes, in
the nested application directory. It invokes the installed TypeScript compiler
with the actual `tsconfig.json`, `--noEmit --incremental false --pretty false`.
The configuration SHA-256 remains
`cb3404493257250c77d7145c9825ed31f79246b640eb30a59b8069d39091bf29`.
Bubblewrap makes the checkout and dependency installation read-only, disables
network access, clears environment variables and keeps durable writes in the new
private proof directory, with an ephemeral `/tmp`. The shared lock prevents
overlapping expensive work.

The actual unit is `openplan-portfolio-skip-full-types-20261015-02.service`,
invocation `168d1d0aee3a4aa2912dc5f5b480df9d`. Compiler time is 206.312 seconds;
systemd reports 206.592 seconds for the service. Peak memory is 6,021,246,976
bytes under an 8 GiB cap. Node's heap limit is 6 GiB. Swap is zero, and every
recorded memory-event counter is zero. CPU quota is 50 percent.

The compiler log is empty, SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
The result receipt has SHA-256
`5530135a87cc7b7a6730220ec78044ccbc0ee7a9f097b025d9c94d85ddc464a0`.
[Evidence](evidence.json) preserves the actual receipt and parent readback.

## Generated declaration custody

The input inventory contains 445 generated-directory files: 444 TypeScript
files and one package metadata file. With `next-env.d.ts`, it covers 446 files.
The parent compares all bytes with the accepted actual `21510042e` build's
declaration output. Current route source has no diff from that producer to the
49e3 application binding. Relative imports in those declarations resolve against
the current checkout, including its implementation and test changes.

The earlier owned copies differ in 440 `// File:` path comments. Their remaining
bytes and relative imports match. The parent preserves those copies privately,
then copies the accepted build's exact declaration bytes into its own ignored
declaration directory. `next-env.d.ts` already matches. Every one of the 446
hashes still matches after compilation. No build cache is promoted or claimed
as output for the corrected application.

## Incomplete first attempt remains recorded

The first preparation incorrectly expects 446 files inside `.next/types`
alone and compares copies carrying older build-path comments. It fails after
creating the new private directory and copying the unchanged runner. The parent
mistakenly submits the dependent launch despite that refusal, then stops only
its newly requested unit, invocation
`7a9d44428ade4f8a81b7efdbf716ae5b`. It terminates with signal 15 after 20.347
seconds. There is no compiler result receipt or passing verdict for that attempt.
Its empty partial log does not establish a type-check pass.

The private first attempt remains intact. The parent corrects the declaration
accounting, preserves the earlier ignored inputs and validates the exact new
inputs before launching the separate second attempt. No other session or unit
is stopped. The successful second attempt uses the same full configuration
and unchanged compiler wrapper. The preparation correction changes no product
source, type assertion or acceptance condition.

## Scope and next step

This is a full static TypeScript check of the stated source and generated
declarations. The focused source/mock tests, native SQL proof and independent
readback have their own scopes. This check does not establish a production
build, runtime behavior, a corrected HTTP import, browser usability, scientific
validity or hosted readiness.

Private receipts, log, declaration manifest, old input copies and failed attempt
remain under `~/.local/state/openplan/portfolio-skip-full-types-20261015-01/`
and `portfolio-skip-full-types-20261015-02/`. The separate preview packet remains
preparation-only. Its reviewed setup, build, start and identified desktop/390px
journey are the next work; the current preview and retained native target stay
unchanged.
