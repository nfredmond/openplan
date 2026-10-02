# Storage authorization corrections

This implementation starts from `891a0d89a848133d44b9e4f314a76a922cd71ace` in the shared isolated fix worktree. The security owner changes only the shared Storage path guard, its resolver, the additive Storage-role migration, two regression suites, and this report with security evidence. The root agent owns integration, release records and Git operations.

## SEC-01. Preserve the authorized object identity through URL handling

The shared `storageRefAllowed` guard now requires canonical raw object names. It refuses percent encodings, URL query/fragment delimiters, backslashes, control characters, empty segments, dot segments and segment-edge whitespace. It also validates the bucket and requires a complete parent prefix ending in `/`. It accepts ordinary filenames, nested directories, interior spaces, Unicode names and consecutive periods within a filename.

The generic resolver no longer trims a stored object reference into a different object name. These references identify stored records; invalid syntax returns an unavailable result rather than authorizing an altered path. Knowledge Base filenames already use a stricter sanitized basename. Existing reviewed app/worker paths use bucket identifiers and workspace/document/run prefixes compatible with the guard.

The change protects both privileged byte reads and signed downloads that call the shared helper. No application source file was left mutated after verification. No attempt was made to retrieve another workspace's bytes.

## SEC-02. Enforce write roles in the Storage schema

Migration `20261015000002_security_artifact_storage_writes.sql` adds a restrictive authenticated INSERT policy on `storage.objects`. For `report-artifacts` and `grant-application-exports`, it requires owner, admin or member status in the workspace named by the first path segment. Existing permissive policies continue to check workspace membership and bucket identity. The new restriction does not grant access to any bucket.

Viewer reads remain available under existing read policies. Members retain uploads, including the grant application export route that uploads with the caller's Supabase client. Service-role worker writes continue through their existing database privileges. Existing objects and references are unchanged. This migration does not add UPDATE or DELETE access.

## Verification

The focused unit command was run from `openplan/`:

```sh
node node_modules/vitest/vitest.mjs run \
  src/test/storage-reference-canonicalization.test.ts \
  src/test/model-run-volumes-artifact-source.test.ts \
  src/test/model-run-artifact-download-route.test.ts \
  src/test/report-artifact-download-route.test.ts \
  src/test/kb-document-download-route.test.ts \
  src/test/aerial-artifact-download-route.test.ts \
  src/test/retained-artifact-download.test.ts \
  src/test/artifact-storage-writes-rls.test.ts --reporter=dot
```

Observed result was 105 passing tests across seven files. The four native policy tests were explicitly skipped in this non-native invocation, then executed separately against the new disposable fix stack.

`storage-reference-canonicalization.test.ts` uses the installed Storage SDK and a synthetic fetch adapter. It checks native `Request` URL handling for approved names and proves rejected names never reach the privileged fetch boundary. The new suite contains 25 assertions covering legitimate names, encoded and literal traversal, URL delimiters, control characters, exact bucket identity and complete prefixes.

The native command used only the disposable fix stack:

```sh
OPENPLAN_RLS_LIVE_TEST=1 \
OPENPLAN_SUPABASE_WORKDIR=/home/nathaniel/.local/state/openplan/independent-fixes-runtime-20261001 \
node node_modules/vitest/vitest.mjs run \
  src/test/artifact-storage-writes-rls.test.ts --reporter=dot
```

Observed result was four passing native tests on the stack named `independent-fixes-20261001`, with API port 29981 and PostgreSQL port 29982. The suite selects the actual database container through the configured port and refuses unapproved test-stack names. The root agent applied the additive migration before this run.

Each native probe begins a transaction, seeds unique synthetic users/workspaces and Storage metadata rows, and rolls back. It exercises installed PostgreSQL policies under authenticated and service roles. It establishes viewer read access, viewer INSERT refusal in both buckets, member INSERT success, wrong-workspace refusal, revoked-user refusal, and service-worker INSERT success. It also confirms the unrelated service-only GTFS bucket remains closed. It does not upload file bytes or leave fixtures behind.

Focused ESLint completed with no reported errors for the two changed libraries and two new test files. The root integration run remains responsible for repository-wide type checking, tests and QA.

## Mutation evidence and limits

`evidence/security-path-mutations.py` writes temporary variants only to the owned library files, records Vitest's assertion results and restores their original bytes in a `finally` block. It recognizes a killed mutation only when failed test assertions name the intended path refusal. A runner startup error cannot count as a killed mutation.

| Check | Harmless control | Targeted defective behavior | Observed result |
|---|---|---|---|
| Canonical path validation | Added source comment | Removed the call validating the raw object path | Comment survives with 25 passes. Removing the call causes 20 exact path-refusal failures. |
| Stored-reference identity | Same passing harness control | Restored resolver trimming | The trailing-whitespace refusal fails, identifying silent object-name alteration. |
| Report Storage writer role | Policy comment inside transaction | Exempted only `report-artifacts` from the new role gate | Test fails with `Viewer report upload was allowed`. |
| Grant Storage writer role | Same passing policy-comment control | Exempted only `grant-application-exports` from the new role gate | Test fails with `Viewer grant upload was allowed`. |

Path mutation results are retained in `evidence/security-path-mutations.json` and per-case JSON reports. Native mutation cases are part of the regression suite and restore policy state through rollback on both success and failure.

The SDK test does not establish native Storage authorization, MIME handling, network delivery or a browser download. The native suite establishes PostgreSQL policy behavior with synthetic metadata; it does not establish Storage HTTP endpoint behavior or byte transport. Earlier automatic safety review blocked offensive native confirmation of the reported traversal, and this implementation does not retry that test. The defensive regression verifies refusal before a privileged request and preserves legitimate SDK targets.

No practitioner, scientific or whole-product acceptance claim follows from these results. Neither correction depends on the unfinished context-history prototype. No historical finding is marked retrospectively disproved; the corrected behavior is supported by the new regression evidence above.


## Restore drill guard integration

The first PR restore drill reaches the new native suites but their duplicated test-only stack checks refuse `openplan-restore-target-<positive integer>`. Four Storage and ten financial migration checks therefore fail before their SQL probes; those failures are not accepted as successful mutation detection. Both suites now invoke the existing `requireContractVerificationStack` helper. Its allowlist is unchanged.

`native-review-probe-stack-identity.test.ts` executes each actual native probe with the real shared guard in a VM. It intercepts only container discovery, Docker transport and native suite registration. Eighteen cases prove approved restore IDs reach the exact Docker target and transaction payload, and that demo, unknown, malformed restore and non-CI default targets are refused before dispatch. Together with the 13 shared-guard cases, 31 focused tests pass. Scoped lint passes.

The baseline and harmless comment each pass all 18 probe cases. Removing the Storage guard fails five named refusal assertions; restoring its erroneous restore rejection fails two approved-target assertions. The financial probe produces the same intended five and two failures. Every source mutation is restored. Results are in `evidence/security-restore-identity-mutations.json`; the executable harness is beside it. These checks prove identity/dispatch integration, not SQL enforcement or a successful restore. Native database and restore CI retain those separate responsibilities.
