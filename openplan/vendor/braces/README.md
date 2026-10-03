# Local braces depth-limit patch

This directory contains an OpenPlan backport for
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
`3.0.4-openplan.1` is a local package identifier, not an upstream release.
The upstream proposal remains open as checked October 2, 2026.

The base is the published MIT-licensed `braces@3.0.3` npm archive. Its original
license remains inside both archives. `manifest.json` records its registry
SHA-512 integrity, both archive hashes, the patch hash and all installed file
hashes. The original archive is retained so rebuilding needs no network access.

`depth-limit.patch` backports the README and runtime depth changes from
[upstream PR 72](https://github.com/micromatch/braces/pull/72), immutable commit
`d0d575e55e74a4e0218e5248fafb79efc3e54ebb`. It applies those changes to the npm
release, then adds the local version and provenance metadata. It excludes
unreleased upstream quote parsing, comma handling and badge changes. The patch
retains the proposal's parent propagation in `stringify`; the published release's
764 compatibility tests pass with these bytes.

The patch caps combined brace/parenthesis nesting at 100. A caller may lower
the cap but cannot raise it. Compile, expand and stringify also check depth
when callers supply syntax trees directly. Existing character and range limits
remain. This does not establish a bound on every expansion, malformed object,
cyclic parent pointer or other resource-exhaustion path.

The direct development dependency and npm `$braces` override install the same
local archive throughout the tree. A bare relative file override resolves from
transitive package directories with the project's npm version and fails to
install. The direct dependency supplies the root resolution. No absolute local
path is stored in the lockfile.

Run from `openplan/`:

```sh
npm ci
npm run vendor:braces:rebuild
npm run audit:dependencies
```

The rebuild uses Python 3 and `patch`, works in temporary storage, and compares
the resulting archive to the committed bytes. It never updates expected hashes.
The dependency audit first runs corruption and regression tests, then verifies
the installed package and runs the unchanged full `npm audit --audit-level=low`.
The installed guard checks the lock, actual nested npm package directories,
file hashes and public API behavior. A changed version label cannot satisfy it.

Registry audit results describe known advisories matched to package metadata.
They do not independently validate this local patch. Reviewed provenance,
compatibility, mutation tests and the installed guard provide separate evidence.
The guard cannot detect coordinated malicious changes to both code and expected
hashes. Review remains necessary. It inventories npm package directories, not
arbitrary bundled copies inside another package's source.

When upstream publishes a reviewed fix, replace the local dependency and override,
verify all installed copies, repeat compatibility and nesting checks, and remove
this temporary backport through a normal reviewed change.
