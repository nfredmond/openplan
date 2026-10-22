# The first current-app build fails full TypeScript checking

The actual single v2 build fails with npm exit 1. Webpack reports successful compilation in about 3.5 minutes, then full TypeScript checking reports seven diagnostics in two source paths. No accepted build result, complete build inventory manifest or `BUILD_ID` exists. The parent does not start or attest the app.

The failure belongs to exact application `67828c17c4c270529468eef1edd144e4a52b693a`, unit `openplan-current-project-preview-app-678-v1-build.service`, invocation `c24248dcd7ba45c4959c78cc280ca97f`. Parent session81770 returns wrapper/controller exit 1 and `REFUSED build: build-exit`. Its systemd runtime is 431.434 seconds; the npm subprocess reports 420.710 seconds. Peak build-cgroup memory is 7,319,392,256 bytes under the 10 GiB limit. Swap and every recorded memory-event counter remain zero. This is a type-check failure, not an OOM.

## Concrete diagnostics

- The project page passes `project.jurisdiction_context` at line 1337. Its SELECT already includes that column, but the imported `ProjectRow` declaration omits the field. The row boundary must model the raw saved JSON without presenting it as a validated declaration.
- The report-generation test at lines 4314, 4315 and 4328 reads optional `metadata_json` and unknown `sourceContext` without narrowing. These account for six diagnostics. The correction must preserve the actual canonical-payload, actor-privacy, clock, report/bundle and GeoPackage assertions.

The earlier scoped TypeScript checks missed both paths. The parent should have run full-project TypeScript before this build. Two isolated Sol-high children now own the separate repairs. Their scoped compiler controls must reproduce the original errors and retain harmless survivors. The parent will join reviewed corrections and run the full project compiler before another production build. No test is excluded or compiler rule relaxed to make this pass.

## Retained state and limits

The failed v2 packet, app checkout, partial `.next`, intents, logs and receipts are frozen. Nothing is deleted, reset or retried. The completed original REST recovery remains intact. Candidate HEAD, invocation, intent bindings and actual active-receipt hash match the expected identities. The read-only observer ends without starting another job or touching the parent session.

[Failure evidence](failed-build-evidence.json) retains the actual resource record, filtered diagnostics, missing-result checks and evidence hashes. Raw files remain in the v2 execution directory and the observer's new private proof directory. The earlier [build admission](STATUS.md) remains historical; this dated result supersedes its pending state.

Webpack compilation alone is not a passing production build. No app startup, process attestation, desktop/390px journey, browser download, native spreadsheet or human acceptance is claimed. Frozen06a full QA, the native migration proofs and exact-main ced6 delivery remain separate. No hosted configuration, migration, provider, main merge or release changes.
