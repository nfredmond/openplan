# Bounded source approval for installer guidance

October 16, 2026. Independent review finds no P1 or P2 defect in candidate
`e41f3cb75ae61feabf8ce89b5bc8ed8fcdec600c`. Approval covers the six-file source
increment and its synthetic fixture evidence. It does not close T1 or establish
installed-provider, browser, hosted or release acceptance.

The sole parent is `bbbcfcc56e293cbf5fad105d0bfaf3ce94da1ffc`, the previously
source-reviewed registry. The assigned clean worktree starts at
`05dd3e8da4a4572437f06e771b0a2477873e681f` and advances locally by fast-forward
only. Review ownership covers this new directory and private state at
`/home/nathaniel/.local/state/openplan/a0-installer-guidance-independent-20261016`.
No fetch, push, nested delegation or shared-root write occurs. The separate
usage-limit and bootstrap lanes remain outside this review.

## The command binds the declared installation and reviewed version

Review reads all six candidate files in full: STATUS, controls, mutation driver,
helper, command entry point and focused tests. It also reads the unchanged
registry implementation and manifest. [Source pins](source-pins.json) record
SHA256 hashes for these eight files. The principal source hashes are:

- Helper: `737cd7d0ed6ffe2a093b14b59f8fa479f4d6402da2b519ab6b1ec4f765d2e688`.
- Command: `8aea6c6242132643097f4cbf4279c72f6ca2deb1df509b89cfb63a8836e5a0ef`.
- Tests: `1512b34781a4640371d82ea131410522aaeda9ffc41813381822db46a35e0284`.
- Original driver: `26477776394737be6d8857a73a1fc685ee342ba8f207d14037b11c9093d9bbf9`.
- Registry manifest: `0a32b6136c2bdef170223f43e6806aa2bc002a6d33b641cf37612ddee2931d3b`.

The helper requires an explicit npm declaration and absolute paths on Linux.
It resolves the global root, requires the supported `prefix/lib/node_modules`
layout, and derives the command's exact prefix from that inspected root. The
command is inert structured data. Its arguments include `--prefix` and the
provider's pinned registry version. There is no `latest`, version fallback or
automatic execution. Canonicalizing a declared root can change its spelling;
the returned prefix identifies the resolved installation.

The package name must match the selected provider. Package directories cannot
be symlinks or resolve through a linked scope. Metadata opens read-only with
`O_NOFOLLOW` and `O_NONBLOCK`; regular-file and 65,536-byte bounds precede a
bounded read. Size, modification-time and change-time checks surround that read.
Invalid JSON, mismatched names and invalid version strings refuse. Absolute,
parent-traversing and escaping binary entries refuse. The resolved selected
binary must equal the resolved package entry and be a regular file. An internal
entry symlink can resolve within the package; an external binary symlink can
identify that same entry.

The result says `operator_declared_entry_verified`. Matching metadata does not
authenticate npm ownership. Undeclared installations and other declared
installers receive no command; other platforms refuse. The helper cannot
identify a true standalone installation if an operator incorrectly declares
npm and supplies matching metadata. Package version metadata does not establish
a native version or native compatibility. All three provider package identities
have synthetic npm/Linux coverage only.

The command parser requires complete, unique, recognized flags. Unknown
providers refuse through the registry. Filesystem failures return fixed reason
codes; the executable entry point catches rejected calls and emits fixed error
text. Raw exception text and supplied paths do not enter that error text.
Successful command arguments intentionally contain the inspected prefix.
The helper imports filesystem reads, path operations and the pinned registry;
its unmodified source contains no process execution or filesystem write.

## The private replay reproduces the reported controls

The original driver hardcodes its owner's private output directory and mutates
its repository-relative subject. Review does not run that copy in either source
checkout. It copies the subject, tests, registry and driver into a new private
tree. The driver's only adaptation changes its output directory to this
reviewer's private controls directory. [Adaptation](driver-adaptation.json)
records the exact replacement and both driver hashes. Exact source bytes restore
in `finally`; final hashes match the assigned, unchanged candidate.

The replay runs serially under the shared compiler flock. The systemd invocation
sets 1 GiB maximum memory, zero swap and 50 percent CPU. Node uses a 256 MiB heap;
temporary files and cache use private directories. The campaign exits zero in
4.237 seconds; its manager reports 42.8 MiB peak memory and zero swap.

Baseline and restored runs each pass all eight named tests with zero failures
and zero skips. Both harmless comment mutations survive. Thirteen fault trials
fail their intended named test through `ERR_ASSERTION`. Review checks every
retained log, not just the campaign's success summary. [Controls](controls.json)
and [audit](review-audit.json) retain hashes, selected test names and assertion
details. The campaign log SHA256 is
`222513ec781eee3f3b3f996f3a3bb1275110144da418f063fba83a344cadbd91`.

The behavior faults cover version pinning, prefix binding, npm layout, explicit
installer, Linux platform, exact binary entry, entry containment, provider
metadata, metadata symlinks, duplicate flags, unknown flags and binary execution.
The execution fault runs only the temporary fixture shell, which writes its
marker. The inventory assertion catches that added file. No actual provider
binary runs.

The thirteenth fault removes the first metadata-size guard. The secondary read
check still refuses the oversized metadata. Its reason changes from
`package_metadata_invalid` to `package_metadata_changed`, causing the intended
assertion failure. This proves diagnostic sensitivity, not an acceptance bypass.
The controls therefore establish 12 selected behavior faults and one diagnostic
fault. They do not establish 13 independent guard bypasses.

## Retained history and claim limits agree

[Original evidence audit](original-evidence-audit.json) verifies all 17 original
trial-log hashes, the original campaign-log hash, the driver hash and restoration
pins against the committed controls. It also records hashes for the first
successful campaign and retained pre-prefix sources. The original first
working-directory failure remains present and says the test file could not be
found. Earlier successful controls do not prove the final prefix binding.
The candidate's report preserves this distinction and the later prefix repair.

The helper's read-only behavior has source and synthetic evidence. The fixture
inventory checks regular-file contents and added marker files. It does not
observe every possible mutation, file mode, symlink or external filesystem
effect. Selected mutation controls do not cover every guard independently.
Hostile concurrent filesystem replacement and restoration after forced process
termination remain unproved. The CLI's final-process error handler receives
source review; the focused tests call its exported parser rather than exercising
every subprocess exit path.

No installed CLI, npm command, update, model, account, network request, database,
browser, full suite or build runs in this review. The explicitly prohibited npm
direction check is not run. This review selects no new product lane or milestone
scope. No external package documentation refresh occurs, so official-link prose
is not treated as current installer verification.

The runtime guide tells operators to confirm the owning installer and stop
affected sessions before running a returned command. It does not claim metadata
authenticates ownership or compatibility. The main connector and planner panel
do not consume this helper yet. Current native acceptance, recorded-frame
provenance, provider access and desktop/390px usefulness remain open. Those
limits support bounded source approval and prevent a T1 closure claim.
