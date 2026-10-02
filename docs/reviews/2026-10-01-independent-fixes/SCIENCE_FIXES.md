# Worker security, cancellation and directional evidence fixes

October 1, 2026. Implementation starts from `891a0d89a848133d44b9e4f314a76a922cd71ace` in the isolated `fix/independent-review-20261001` worktree. This agent owns the listed worker/modeling changes, focused verification, this report and `evidence/science-*`. Other application changes belong to the integrating agents. No commits or refs were changed by this agent.

## Changes

SCI-01 is corrected at the HTTP boundary. Every ActivitySim execution endpoint requires a configured bearer token, including loopback requests. Authentication precedes payload parsing and runtime setup. Operators configure existing bundle and output roots; requested bundle paths and symlinks must resolve under the bundle root. HTTP requests accept only a bundle or manifest and optional label. Execution commands, configuration and container settings come from operator environment variables. Each request gets a UUID output directory with replacement disabled. The local CLI remains available for explicit operator options. The Docker startup command and `--serve` validate configuration before listening. Deployment instructions now require the token and owned directories.

SCI-02 is corrected for the worker's owned POSIX process tree. Each bootstrap starts a new session. Cancellation signals that group, retains its unreaped leader during the grace interval to avoid PID reuse, then kills remaining group members and waits with a bound. A descendant that closes its pipes still receives the final signal. A detached pipe holder that cannot be stopped results in a failure instead of a success claim or an unbounded wait. Unsupported non-POSIX execution fails before launch.

SCI-03 now refuses unsupported directional comparisons. Matcher `openplan.pre-volume-observation-matcher.v2.1-directional-refusal` leaves directional observations on bidirectional links ambiguous. Combined-direction and proven one-way controls remain supported. The v5 evaluator refuses legacy one-direction selections unless the retained candidates prove selected links are one-way. This is a fail-closed custody check; it does not recalculate frozen metrics or introduce acceptance criteria. Old frozen study registries retain their original matcher version and cannot silently run this successor matcher. A future study needs its own reviewed protocol.

## Verification

`evidence/science-focused.json` records these six successful focused scripts:

- ActivitySim HTTP security, six tests.
- Existing ActivitySim runtime, 14 tests.
- Existing county worker, 10 tests.
- New county process cancellation, two tests with three real child-process cases.
- Existing validation-instrument v2 script.
- New directional refusal, three tests covering both directions, reversed/perpendicular geometry, combined and one-way controls, and unsupported legacy candidates.

The process tests use synthetic owned Python parent/child processes. They test a normal child, a child ignoring SIGTERM, and one ignoring SIGTERM after closing inherited pipes. They verify no delayed child output, bounded return, a subsequent command, and survival of an unrelated control process. The orchestration test separately checks that the real job launcher requests a new session. The existing queue test still checks callback order with a fake process; it does not substitute for the real descendant cases.

`workers/science_regression_mutations.py` copies the exact relevant source and tests into a temporary tree. No running checkout is mutated. It first executes all three new suites normally, then requires a harmless comment mutation to survive before each targeted fault. Nine faults fail for named reasons: HTTP authentication, request execution options, bundle-root escape, replacement mode, startup credential check, new-session ownership, process-group escalation, directional matching and legacy-audit refusal. `evidence/science-mutations.json` retains the failures. Nonzero exits alone do not count; each result must contain the expected test or controlled failure reason.

The new `.github/workflows/worker-security-regression.yml` runs these six scripts and mutation proof on pushes to main and pull requests. It closes the reviewed discovery gap for these paths without modifying the shared existing CI workflow. The workflow has not yet run remotely. Local tests use an isolated prior-review Python 3.12 interpreter with Flask, Requests, python-dotenv and Shapely. CI specifies Python 3.11. Local diff whitespace checks pass for the modified tracked implementation paths.

## Files

Implementation and deployment:

- `workers/activitysim_worker/main.py`, `Dockerfile`, `DEPLOY.md`
- `workers/county_onramp_worker/main.py`, `DEPLOY.md`
- `scripts/modeling/validation_instrument_v2.py`
- `workers/aequilibrae_worker/model_validation_core_v5.py`

Verification:

- `workers/activitysim_worker/test_http_security.py`
- `workers/county_onramp_worker/tests/test_main.py`
- `workers/county_onramp_worker/tests/test_process_cancellation.py`
- `scripts/modeling/tests/test_validation_instrument_v2.py`
- `scripts/modeling/tests/test_directional_refusal.py`
- `workers/science_regression_mutations.py`
- `.github/workflows/worker-security-regression.yml`

## Remaining evidence boundaries

No model, calibration or holdout ran. Frozen observations, studies and preregistrations remain untouched. AequilibraE and ActivitySim stay separate and scientific outcomes remain inconclusive. The directional correction is an explicit refusal, not implemented AB/BA extraction or scientific validation.

The HTTP tests execute actual Flask routes and actual preflight setup with synthetic files. They do not build the Docker image or establish external-network commissioning. Operator-owned roots and credentials remain trusted configuration; the HTTP token is not a substitute for workspace authorization in the application.

Cancellation proof covers processes in the owned POSIX session. A detached daemon or container managed outside that session needs separate engine identity and termination evidence. Neither Docker-daemon cancellation nor physical power-loss recovery is established here. The change fixes the demonstrated inherited-pipe child failure and bounded-wait defect; it does not claim whole-system worker recovery.

No database, live worker, browser, existing modeling directory or other agent's checkout was used as a test target. Full application QA, independent integration review, remote CI, commit and PR work remain with the lead agent.

## Independent review of finance, dashboard and export corrections

This agent separately read the integrating agent's changes to allocation arithmetic, work-program reporting and preparation, the workspace dashboard query, generated project exports, and their changed tests. `evidence/science-root-crossreview-hashes.json` identifies the exact source reviewed. Application files remained read-only, and no tests or mutations ran during the concurrent QA and native database checks. No blocking regression was found in this bounded source review. This conclusion does not independently repeat those integration results.

The recipient correction retains the original signed `roundingResidual`, applies negative adjustments only up to each current share, flags every recipient actually adjusted, and preserves the existing distributed-total invariant. The formula amounts are captured after rounding placement and before floor redistribution, consistent with their existing definition. The new tiny-pool test pins the two adjusted recipients and amounts; it could additionally pin the signed residual and formula amounts. Positive residual policy remains unchanged.

The reporting reader and preparation loops advance by returned rows and require an empty terminal page. Errors and page ceilings refuse a complete result. History remains bounded by the captured revision. Its order is unique because migration `20260906000001_program_work_program_preparation.sql` defines `UNIQUE (program_id, revision)`. Source and extraction rows append their unique IDs. This review does not establish consistency across concurrent source insertions or permission changes.

Generated-export array reads append stable unique keys after their existing chronology. The dataset-link exception is correct: migration `20260313000014_data_hub_module.sql` defines `PRIMARY KEY (dataset_id, project_id)`, and the query fixes `project_id`, so `dataset_id` completes its total order. Modeling custody tables use primary-key IDs. A failed subsequent page is propagated before files are returned. The new test parses generated JSON bytes, verifies all modeled record arrays and linked data across a three-row cap, and checks final ordering keys and offsets. Its transport mock ignores actual filter and projection execution. Corridors and crash ingests are empty fixtures, so their queries execute only empty first pages; the dependent `safety_crashes` query does not execute. Native query semantics, nonempty GIS pagination, concurrent snapshot consistency and very large related-ID query limits remain outside this test. These limits qualify coverage, not a demonstrated defect in the correction.

The dashboard now scopes `project_submittals` through its real `project_id` foreign key with `projects!inner(workspace_id)` and the joined workspace filter. The source migration confirms that the former direct `workspace_id` column does not exist. The changed unit stub asserts both projection and filter, which prevents the reviewed regression. It does not execute a native PostgREST join or prove foreign-workspace exclusion; those remain the separate native suite's responsibility.
