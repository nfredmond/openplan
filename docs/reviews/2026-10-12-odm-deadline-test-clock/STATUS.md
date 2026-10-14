# Observe the pipeline clock in the deadline test

GitHub ODM run [38202690119](https://github.com/nfredmond/openplan/actions/runs/38202690119/job/114659317561) fails the positive URL-to-draft control on PR #256 at `05748d29d55ab2deff13ba9ef8b289c3a2e95355`. Its test captures the start time before entering runtime ownership and creating the fixture. Setup exceeds the five-millisecond allowance by 0.849 milliseconds. That timestamp does not identify the pipeline's actual deadline start.

The test now observes the pipeline module's actual monotonic readings. It compares the external transport deadline directly against that first reading plus one second. The previous five-millisecond allowance is removed. Production code and its deadline stay unchanged.

The existing URL-to-draft [control runner](../2026-10-11-odm-url-draft-pipeline/verify_controls.py) passes all 20 tests and 32 cases under Python 3.14 and 3.11. Harmless comments survive. Extending the source budget and removing the transport deadline clamp fail their intended assertions. Eight failure-oracle controls pass under each interpreter. The runners restore all source bytes exactly; the owned unit stops after its resource record is captured.

The evidence folder preserves each interpreter's controls, oracle results and source bindings. These are local test and controller checks. Exact-commit GitHub CI remains separate; no native engine, full recovery, browser, practitioner or scientific acceptance follows from this correction.
