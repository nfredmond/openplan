# Local artifact filesystem containment

October 8, 2026. Base `6e53cd42`. The separate containment checkout does not
serve the active T3 preview.

A real temporary-filesystem probe against the base reads synthetic foreign-run
bytes through a symlink located inside the authorized run directory. The prior
resolver checks path text, but `readFile` follows the link. The download route
also performs its own direct read after the same lexical check. No user data
was accessed in the reproduction.

The shared reader now resolves the configured root, authorized run directory and
file target before reading bytes. A run directory must resolve to its expected
location beneath the configured root. A file target must stay inside that run.
Downloads use this reader too. The final read uses `O_NOFOLLOW` to refuse a
final-component link substituted after resolution. An explicitly configured
root alias remains supported, as do links whose targets stay in the same run.
Storage authorization and remote-URL behavior are unchanged.

Thirty-five focused tests pass. Four adjacent artifact, agreement, evidence-packet
and storage-reference suites pass another 56 tests. Six use actual temporary files and links for
ordinary reads, an internal alias, a foreign file link, a foreign directory
link, a redirected run directory, a configured root alias and an out-of-root
scope. The route test checks refusal before bytes are read. Its authentication
and storage dependencies remain mocked. Targeted ESLint passes.

Harmless-comment and restored controls pass. Removing target containment makes
foreign-file, nested-directory and route refusal cases fail. Removing run-root
identity admits a redirected run directory and fails that case. Bypassing the
shared reader in the download route returns 200 instead of the expected 404.
The results are retained in `controls.json`.

The first test invocation omitted the new filesystem test because its creation
used the wrong working directory. The two existing suites also exposed an
incomplete `realpath` mock. Both were corrected before the reported 35-test run.
No passing claim relies on the first invocation.

This evidence covers Linux filesystem reads and component/route behavior. It
does not establish browser acceptance, other operating systems, resistance to
concurrent hostile replacement of parent directories, worker write containment,
deployment/attempt filesystem ownership or scientific acceptance. Those remain
separate requirements. The configured worker root remains operator-controlled.

The first standalone TypeScript check reaches the default 4 GiB heap limit and
exits 134. A separate retry uses a 6 GiB heap under a 7 GiB service memory cap,
with two CPUs and core dumps disabled. It completes with exit 0 in 57.496 seconds, using 5.1 GiB peak memory and no
swap. Unit `openplan-local-containment-types-20261008.service`, invocation
`4fad2549346b477b874aeac8e96c385e`, identifies that completed check.

## Parent replacement correction

A controlled real-filesystem probe confirms that the first correction still
reads foreign synthetic bytes if a parent directory becomes a symlink after
canonical resolution. `O_NOFOLLOW` on the final file does not protect its parents.
The earlier statement that this boundary was unproved is superseded by that
reproduction and the correction below.

The production reader now opens the authorized run directory, verifies its
actual descriptor path, and holds directory handles while opening each child
through `/proc/self/fd`. Each child directory and final file refuse symlinks.
The final descriptor must name a regular file. Reads use that descriptor;
cleanup attempts to close every opened handle on success and failure. Ordinary
contained symlinks still work because canonical resolution precedes the handle
walk. Configured root aliases retain their existing behavior.

Forty-two focused tests pass, including seven new platform/race cases. The tests
perform real filesystem operations and pause the real production calls at
specific boundaries to replace ancestors, the run directory, a child directory
or the final file. They either retain original authorized bytes or refuse the
read, never returning the synthetic foreign bytes. Every case verifies handle
cleanup. Four adjacent suites pass another 56 tests; targeted ESLint passes.
A first invocation again used the wrong path for the new test file, so its
35-test output does not cover the later race cases. The corrected run does.

Harmless-comment and restored controls pass. Reopening the final file by its
pathname reads foreign bytes after child replacement. Allowing symlinks admits
parent/final-file redirection. Omitting opened-root identity admits ancestor
redirection. Each adverse variant fails its matching assertion. Results are in
`race-controls.json`.

Secure local reads require the documented Linux reference host and its proc
filesystem. Unsupported hosts fail explicitly; Storage-backed reads are
unchanged. This is a local-mode compatibility boundary, not a claim of broader
platform acceptance. The checks do not establish immutable bytes during an
in-place file write, hard-link provenance, worker write isolation, deployment or
attempt ownership, browser acceptance or scientific accuracy. Privileged host
administration remains outside this file-read boundary.

The production handle-walk tree passes standalone TypeScript under unit
`openplan-pinned-artifact-types-20261008.service`, invocation
`4f40b34f712645959dc639cd61094ba8`. It exits 0 in 56.596 seconds, with a
5.1 GiB peak and no swap under the 7 GiB cap.
