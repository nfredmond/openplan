# Local model launcher dependency preflight

Source and controlled-launcher checks only. This correction does not run a
worker, a model, a graph probe, count ingestion or calibration.

## Candidate and scope

- Owned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-4fb8a43d`.
- Branch: `t3/aequilibrae-launcher-dependency-preflight`.
- Fast-forward base: `dfe86e70af12015613626aaf036d40408f506d12`.
- No browser, database, existing execution environment, running worker,
  scientific artifact or other checkout changes.
- The product-direction command is not run because the task excludes Node.
  Product direction, modeling status, validation requirements and worker
  requirements inform this bounded change. No milestone or claim tier changes.

## Behavior

Both local AequilibraE launchers call `check_local_dependencies.py` with the
candidate interpreter. The helper reads the checkout's worker requirements,
uses `packaging` to compare installed AequilibraE, NumPy and pandas metadata
versions, and imports those packages after version checks succeed. Missing or
invalid versions, missing constraints and ambiguous numerical requirement forms
fail closed. The worker requirements now explicitly include the parser package;
the numerical constraints remain unchanged.

`OPENPLAN_AEQUILIBRAE_PYTHON` binds an absolute external interpreter path. Quotes
preserve spaces. An empty, relative, missing, nonexecutable or incompatible
explicit selection stops before either worker enters, without trying another
interpreter. Automatic selection retains `.venv311`, then `.venv`, with visible
rejection messages and preflight for each candidate.

ActivitySim selection and the launch/shutdown tail remain byte-identical to the
base. Existing execution selection, preflight-only fallback, CLI environment
semantics and the explicit `--calibrate` option remain unchanged. No ActivitySim
external-interpreter option is added.

## Checks and falsification

Run from the repository root with Python 3.14.4 and packaging 26.0:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -B workers/aequilibrae_worker/test_local_launchers.py
PYTHONDONTWRITEBYTECODE=1 python3 -B workers/aequilibrae_worker/test_dependency_pins.py
bash -n scripts/run-local-modeling.sh
bash -n workers/aequilibrae_worker/run.sh
git diff --check
```

All 16 new unittest methods and four existing dependency-pin checks pass. Shell
tests execute copies of the real launchers. Controlled interpreter fixtures run
the real helper against inert numerical modules and distribution metadata,
then record worker entry instead of executing a poller. Their environment
contains no database credentials. Cases cover external paths with spaces,
automatic selection, each numerical dependency's wrong version, explicit-invalid
selection without fallback, failed imports, missing packaging and live reading
of the fixture requirements file. Pure tests cover compound, compatible,
wildcard, exclusion, epoch, prerelease and postrelease specifiers, plus
missing/invalid versions and refused requirement forms.

A comment-only mutation survives the complete suite. All 25 targeted faults
fail for named assertions: bypassed numerical checks; admitted missing or unknown
versions; ignored missing, duplicate, conditional, unbounded or malformed
requirements; hardcoded requirements; bypassed imports; a missing parser that
exits successfully; and, separately for each launcher, ignored explicit selection,
bypassed automatic or explicit preflight, and unquoted external paths. Further
faults reverse automatic priority, disable ActivitySim execution, require
ActivitySim during its fallback, erase fallback CLI configuration, enable
calibration by default, ignore calibration opt-in, or accept an unknown option.
Each launcher also rejects an intentionally malformed shell copy under `bash -n`.

Mutations run in private copies with `-B` and bytecode writes disabled. A final
full test run succeeds; hashes confirm that every original helper, launcher,
requirements and test file retains its pre-mutation bytes. Private small logs,
mutation definitions and hashes remain in the ignored, mode-0700 checkout-local
`.tmp/local-launcher-preflight-20261018/` directory. The first mutation-runner
attempt incorrectly classified an application `ERROR:` line as a unittest error.
That attempt remains preserved under `attempt1/`; the corrected classifier
requires a unittest test-error header and the subsequent complete run succeeds.

## Blind categories and remaining work

- Distribution metadata and imports establish numerical dependency adherence.
  They cannot establish compiled ABI safety, routing/assignment behavior,
  reproducibility, other worker dependencies or scientific validity. A forged
  or inconsistent environment can misreport metadata.
- Inert shell fixtures establish selection, refusal and environment propagation.
  They cannot establish real interpreter packages, worker entry behavior,
  ActivitySim CLI execution, polling, shutdown/recovery, credentials or database
  integration. Existing worker lifecycle behavior is outside this correction.
- Text-based dependency-pin checks establish requirement and Dockerfile wiring,
  not installed images. Shell syntax checks cannot establish runtime behavior.
- No actual model defect is reproduced here. The reported small graph probe's
  success under both pandas versions does not prove supported numerical behavior.
- Root independently reviews this checkpoint before integration. Real environment
  preflight, worker operation and numerical/model acceptance remain separate work.

## PR340 fallback and lightweight CI correction

This follow-up starts from `239a152a1195ca86dc50fc89aa284556974d43fc` in the
clean T3 checkout `/home/nathaniel/.t3/worktrees/openplan/t3-b89018cf`, branch
`t3/fix-launcher-preflight-fallback-ci-packaging`. Root retains integration ownership.

The preflight-only ActivitySim search now considers the admitted `AEQ_PY` after
the existing `.venv311` and system candidates. Full-path lookup preserves spaces.
The `.venv-exec` execution branch still takes priority. An external interpreter
with helper dependencies does not establish installed ActivitySim. AequilibraE
admission, explicit-selection refusal, CLI configuration and calibration opt-in
remain unchanged.

The worker job in `.github/workflows/ci.yml` now explicitly installs `packaging`.
The launcher test imports the actual requirements helper, so the five previously
declared lightweight dependencies are insufficient. This addresses the reported
failure in job `117778371287`, run `39162380694`. Other workflow discovery paths
do not include this suite; the security workflow uses explicit suite names.
No heavy engine install or test exclusion is added.

All 17 launcher tests, including the new isolated external-only helper case,
and four dependency-pin checks pass. Both shell syntax checks pass. Tests run
serially under a 768 MiB address-space limit with numeric thread counts set to
one. A private copy of the existing lightweight environment uses Python 3.11.15
and adds only cached `packaging==26.0` offline. Neither engine is installed there.

The harmless launcher/YAML comments survive. Removing the new fallback or
restoring truncated path lookup fails both absent-local and unusable-local
scenarios. Removing the new CI dependency selects the matching existing
lightweight environment without packaging and reproduces the helper's exact
missing-parser refusal. Source bytes are restored after each fault. This local
declaration-driven check does not execute GitHub's installer or establish CI
success. The first whitespace check cannot create Git's preload thread under
the resource limit; disabling index preloading passes. Private logs and hashes
remain in the ignored, mode-0700 `.tmp/launcher-pr340-correction/` directory.

The fixture, pin and syntax blind categories above still apply. No workers,
models, skims, assignment, network, database, browser or scientific artifacts run
or change. GitHub CI for this follow-up has not run.
