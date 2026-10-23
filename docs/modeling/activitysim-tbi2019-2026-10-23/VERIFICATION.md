# Verification and limits

This attempt verifies outcome-free partitioning and the inherited synthetic
native instrument. It does not verify a full Census-to-TBI observation pipeline.
Historical input admission fails before development or held-out choices open.

## Executed checks

| Check | Result | Blind category |
|---|---|---|
| Product direction | Pass with existing age/version reminders | Does not renew reviews or close science gaps |
| Split unit/integration suite | 13 pass, zero fail, zero skip | Mocked HTTP cannot prove publisher uptime or atomic snapshots |
| Harmless source comment | All 13 pass | Does not cover every harmless source transformation |
| Reordered household roster | Identical assignment | Does not prove geographic independence |
| Targeted source mutations | 17 intended assertion failures | Does not exhaust filesystem/network threats |
| Exact source restoration | SHA-256 equal, all 13 pass | Does not verify unrelated code |
| Public roster acquisition | 7,516 unique households; before/after count agrees | Equal counts alone cannot prove service transaction isolation |
| Native input probe | 2019 refused; 2022/2023 supported; transit classified zero | Profile/skim-source evidence, not a historical network build |
| Inherited synthetic sealed run | Four native stages exit zero; 284 tours | No real survey, Census fit, historical LOS or tour mapping |
| Synthetic custody and conservation | Receipt, aggregate, source/config hashes held; replay identical | Not behavioral accuracy or a full native-binary hash inventory |

The [mutation record](evidence/split-mutations.json) binds test names, intended
assertions, output hashes and the original/restored source hash. All 17 failures
are assertion failures, with no import or orchestration errors. The mutation
harness restores the exact file in `finally`. It changes only the owned new
split source. The harmless comment survives. The first scoped test run and
synthetic native attempt succeed; there is no concealed failed native retry.

Two exploratory metadata requests return service error 404, `Layer not found`,
for nonexistent 2019 tables 9 and 10. [Source custody](SOURCE.md) preserves
both response hashes. These are metadata misses, not model or test failures.

## Exact execution records

Checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-d0ced982`.
Base: `1a99efd966af00ac5d6e3c71a00e9857b3333cfb`.
Split specification commit: `9b86edcf1`.
Split implementation commit: `16ebea618`.
Admission/design commit before native execution: `9e8363805`.

```bash
git fetch origin
git checkout -B work/s2-activitysim-tbi2019 origin/work/s2-activitysim-coefficients
```

From `openplan/`, `npm run product:direction:check` passes. From repository root:

```bash
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B -m unittest discover -s scripts/modeling/tests -p test_tbi2019_development_split.py -v
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B scripts/modeling/tbi2019_development_split.py --run /tmp/openplan-tbi2019-20261023/roster
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B docs/modeling/activitysim-tbi2019-2026-10-23/evidence/mutate-split.py
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B docs/modeling/activitysim-tbi2019-2026-10-23/evidence/probe-inputs.py
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B scripts/modeling/prepare_activitysim_walk_transfer.py synthetic --run /tmp/openplan-tbi2019-20261023/native-synthetic-a --stock /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 /home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python -B scripts/research/sealed_study.py run /tmp/openplan-tbi2019-20261023/native-synthetic-a/lock.json
```

These are execution records, not instructions to rerun consumed locks.
The synthetic native entry points and all child commands are in its retained
[lock](evidence/native-synthetic/lock.json). CPython 3.11.15 and NumPy 1.25.2
are recorded in [environment.json](evidence/native-synthetic/environment.json).
The separate [input probe](evidence/input-probe.json) hashes the unchanged
Census adapter, profiles, bundle builder, skim adapter, coefficient instrument,
accepted registry and candidate overlay.

## Unexecuted work

The full preparation path requested by the task remains incomplete. No 2019
Census population/network bundle is built, no TBI trip-to-tour adapter executes,
no survey-weighted shares/variance/effective sizes are computed, and neither
arm runs on the real development partition. Those are **unexecuted stages**, not
unit-test skips, behavioral rejections or numerical zero results.

This study changes no Vitest file. The coefficient lane subsequently adds two
CI import-guard commits through `7e9387985f7834e81199889b109e80facb3f8607`;
this branch inherits those unchanged. They alter no frozen scientific source,
coefficient, input or native closure. Vitest, full worker matrix, app suite, QA gate, build,
browser journey, RLS, hosted systems and deployments are unexecuted. No Docker
stack, production service, secret or reserved NHTS record is touched. No
coefficient, worker default, accepted registry or historical study record changes.
The PR includes the unchanged coefficient-lane commits from draft PR #376.
GitHub checks are reported separately from these local results. No merge occurs.
