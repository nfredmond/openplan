# Current candidate checks and resource boundaries

Application source `f6394f05ef03011679ee34e1c11dd9f0a242cb6e` remains an unreleased candidate. [GitHub full QA](https://github.com/nfredmond/openplan/actions/runs/38107225444/job/114375181379) and [shuffled order](https://github.com/nfredmond/openplan/actions/runs/38107225444/job/114375181395) each pass 21,405 tests, with 1,595 skipped. The 1,657-file inventory includes 1,561 passing and 96 skipped files. [The summary](ci-f639-full-suite-summary.json) retains exact source, counts and log hashes. The shuffled seed is 323150.

The full QA command also passes lint, deadcode, native connector tests, dependency audit and the webpack build. Its configured RLS gate does not establish a live database result. The independent current live RLS and complete archive restore workflows remain pending at this checkpoint. Worker-security, operations, modeling-script and lightweight Python-worker GitHub jobs pass separately. These are engineering checks, not scientific accuracy or practitioner acceptance.

## Local failures stay visible

The local full inventory does not finish. [Its disposition](local-full-checks-disposition.json) records 623 completed files, 7,659 passing tests, 1,230 skipped tests and zero failed assertions. The duplicate run stops after both complete GitHub suites pass. This partial local result is not described as a complete suite. Interrupted in-flight files receive no acceptance credit.

The retained [768 MiB batch failure](full-candidate-corrected-batch-heap-failure.json) and [1,024 MiB batch failure](full-candidate-resumed-batch-heap-failure.json) record V8 heap exhaustion within the owned services. [The five-file process](full-candidate-small-batch-interruption.json) stops before another exhaustion. [The isolated-file transition](single-file-run-transition.json) preserves completed files and repeats interrupted work. A later isolated thematic authority file also exceeds 1,024 MiB; the checked fatal observer stops its owned process group. Its subsequent 2,048 MiB heap run passes all 82 tests within a 3 GiB service limit, peaking at 2,404,225,024 bytes. No application or unrelated service is stopped. These observations do not diagnose an unrelated desktop crash.

[Process-bound controls](candidate-process-bound-controls.json) retain three benign completions and two intended fatal/deadline refusals. The helper stops the process group it creates. It does not establish host OOM handling or application recovery. Original failed and partial logs remain in the private proof base. Earlier whole-suite resource failures remain recorded in the preceding reports.

## Native and deployment evidence remain distinct

[The native source map](native-evidence-source-map.json) compares recorded file hashes with this source. Intake, human decisions and cancellation reports match their listed files. Earlier queue and submission-poll observer files have since changed, so their reports remain historical. The GTFS backend, parser CLI and candidate migration tree remain unchanged from parser build `3aa44ff8015509fa81a6e83e526b9b4d036a8034`. Hash comparison is not a repeat of native SQL or Storage checks.

[The deployment inventory](hosted-schema-join-candidate.json) records all four candidate SQL hashes. Migrations 28 through 31 must precede this app even when managed admission is disabled, because the existing reaper calls a new database function. The separately owned hosted supervisor supports seven queues and does not include this GTFS queue. No cloud schema, service or deployment is changed by these checks. Current hosted commissioning and exact final-main acceptance remain separate.

## Installed Python worker checks

The first complete worker pass records [187 passing suites and one fixture failure](candidate-current-worker-checks.json). The corrected [rerun passes all 188 discovered suites](candidate-current-worker-recheck.json), with zero failures and none not run, in 121.046 seconds. Its owned service has a 2 GiB memory limit, no swap, and a rounded 247M peak from systemd. It runs against base `f6394f05` plus the exact recorded [fixture correction](SCREENING_HANDOFF_FIXTURE.md). The worker implementation stays unchanged. These engineering checks do not establish model accuracy or hosted commissioning.
