# Cloud package verification

October 24, 2026. The scope is portable, modeled-only execution and artifact
custody. It does not establish full-population completion, cloud-provider
acceptance, observation accuracy or permission to open outcomes.

## Source and instrument checks

The final image passes 17 package tests: eight archive-custody tests, six
controller tests and three telemetry tests. The retained exact/choice comparator
suites pass 14 tests. Total: 31 passed, zero failed, zero skipped. These are
scoped Python tests; no Next.js build, Vitest, application release gate or hosted
operation runs. `product:direction:check` passes with its existing dated review
reminders. The review dates remain unchanged.

Fifteen accepted source mutation controls comprise three harmless comment
survivors and 12 intended assertion failures. The member-hash mutation triggers
two assertions, so assertion totals and control totals differ. Tests also accept
harmless archive-member ordering. The controllers compile isolated mutation
namespaces and verify original source bytes remain unchanged.

- Archive controls remove outer-hash, member-hash, size, census or duplicate
  guards. Their blind category is real engine behavior and S3 transport.
- Controller controls remove the process-count or required-variable guard,
  leak the parent environment into the model child, or misname the terminal
  object. Their blind category is a real hosted provider and abrupt host loss.
- Monitor controls overwrite a named model step with a generic chunk message,
  remove the memory headroom stop, or ignore a child exit failure. Their blind
  category is full-scale transient peaks and container-wide SIGKILL.

The final-image native proof and its precise counts, resources and hashes are
recorded in `LOCAL_PROOF.json`. `PRIVATE_CUSTODY.json` binds the retained local
logs, raw telemetry, model artifacts, S3 retrieval and build receipts. Raw model
rows and archives do not enter Git or the image.

## Earlier failures remain distinct

1. The requested branch is already checked out in `t3-11910f11`. This worktree
   uses detached `6c4cf58de9e2befd6ef9100e7ab054c1e7deac67` and pushes its new
   descendant to the same remote branch. No other checkout changes.
2. BuildKit refuses because Buildx is unavailable. The legacy builder succeeds
   under a 6 GiB memory/swap-equal cap. The first image is superseded by the
   telemetry-label correction and is not the delivered proof image.
3. Quay returns HTTP 401 for the MinIO image. Docker Hub denies its pull.
   The owned local proof uses Moto 5.1.13 instead.
4. The first source mutation for duplicate members reaches an incidental
   `FileExistsError`, because the duplicate also collides with an extracted
   file. The revised fixture repeats the embedded inventory, isolating the
   duplicate guard. That incidental error is excluded from accepted controls.
5. An initial controller test reaches a test-instrument `TypeError` while
   JSON-serializing bytes in its credential-leak assertion. The assertion now
   inspects the event representation. The initial five passes/one error remain
   in `runner-tests.log`; the final six tests pass.
6. The first native harness stops before any model because Docker's default
   address pools are exhausted. An explicit unused subnet resolves that setup
   failure without changing another network.
7. The next setup attempt cannot resolve a host-relative fixture symlink inside
   the mounted proof directory. A hard link supplies the same pinned bytes.
   No model runs in this failed attempt.
8. In proof round 3, both model stages for the current arm finish; SEMCOG reaches
   its suffix, and the runner proceeds to upload only after both arms finish.
   The local S3 endpoint then becomes unreachable during artifact upload.
   The runner exits one and cannot upload its terminal status. The helper also
   cannot retrieve the bucket. The exact server failure cause is unavailable;
   its 1 GiB cap is not itself proof of OOM. Cleanup removes this first run's
   unmounted `/work`, so its numerical outputs are unavailable for parity and
   do not count as a successful proof. Its wrapper logs and Docker exit receipts
   remain retained. The final harness binds `/work`, records server state/logs
   before cleanup and gives the owned emulator a 6 GiB/zero-swap cap. It retains
   final outputs even if transport fails. The model container remains capped
   at 9 GiB with equal memory-swap.
9. Initial telemetry allows generic chunk messages to replace model labels.
   The final filter retains named steps; targeted mutations prove the behavior.

10. An early comparison invocation runs while S3 retrieval is still active. It
    refuses because no retrieved parity terminal exists yet. It reaches no
    numerical comparison; `comparison.initial-not-ready.log` retains that
    orchestration failure. The accepted comparison waits for retrieval and
    cleanup to finish.

No earlier failed attempt is relabeled as passing. Historical branch evidence,
117 frozen study records, the split, consumed holdouts, model coefficients and
installed host engine sources remain unchanged.

## Main merge boundary

The read-only `git merge-tree --write-tree HEAD origin/main` preview reports a
content conflict in `CHANGELOG.md`, a file outside this package's ownership.
The preview uses main `2cb3ca929aa2e4ad9b972de3bdcfba61e8fd5f78`. No conflicted
merge is applied. The lead owns that join; draft PR #384 remains draft.
