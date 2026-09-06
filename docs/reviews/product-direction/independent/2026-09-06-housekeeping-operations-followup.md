# Independent follow-up on selective demo promotion

Reviewed September 6, 2026. This follows `REPORT.md` and preserves its original f563d40c findings. It reviews the lead's working-tree remedy, not a committed release or installed service.

The selective promotion resolves the reproduced artifact-displacement case within the tested configuration. Two defects found in the first remedy snapshot were also corrected and independently checked. I found no further concrete source defect in this bounded follow-up. Power-loss durability, actual runtime database identity, accepted-release selection and the installed desktop/Next workflow remain unproved.

## Exact reviewed sources

I froze both reviewed snapshots under this report directory because the lead was editing concurrently.

- First remedy updater SHA-256: `062f5fc65513b9de71f6da772d79d23ae364aeebba62fbab114e755ebe9929d5`, saved in `followup-snapshot/ops/safe-refresh-walkthrough.py`.
- Corrected updater SHA-256: `194cc05b53eff5557b713db9e1ba97f8ad1a5b56d7612704ba62d9bbca0f503e`, saved in `followup-corrected/ops/safe-refresh-walkthrough.py`.
- Corrected fixture snapshot SHA-256: `5140daa7706166f1babc1cf77c507bffd663c8be0f43de1182ff17218196856c`.
- Shell builder snapshot SHA-256: `9663547c0cdd4e22ec51924db1182da4ae43961d4d2966a1e702f15276b10a2b`.

The lead owns all repository changes. I wrote only in operations-review, used fixture service management and disposable local HTTP servers, and did not touch installed services or existing processes. Git status showed the lead's expected changes to the updater, shell builder and recovery test. This review must not be attributed to a later hash without checking the difference.

## D1 disposition

The new coordinator retains the instance root and updates only the transaction's changed tracked paths, `.env.local`, `.next` and `node_modules`. It snapshots source/settings bytes, stops the verified service, installs source/runtime paths, updates Git metadata, verifies installed source and then restarts. Ordinary local artifacts remain at their existing paths through promotion and recovery.

The regression writes a local artifact after candidate copy, verifies identical active bytes and instance inode after promotion, changes the artifact again, and verifies those newer bytes after manual recovery. It passes on the corrected snapshot. Running that same regression against the original f563d40c source fails at the root-replacement assertion. The original independent probe separately showed the resulting missing active artifact. This is evidence that the correction addresses the demonstrated mechanism, not merely that its happy-path update works.

The new-source collision check includes ignored files that candidate Git operations may overwrite. Snapshot refuses an incoming tracked path with an existing local file if it was absent from the previous tracked tree. Parent symlinks/non-directories and directory/file collisions also refuse in the source-path/fingerprint helpers. The captured suite tests an ignored `openplan/added.txt` collision and preserves its original bytes without restarting. I did not exhaust every possible Git path transformation. File-to-directory conversions and existing tracked symlinks may be refused during preparation, which is safer than silently overwriting local data; support for those transitions is not established here.

## Defects found and corrected during this follow-up

### F1. Recovery accepted modified retained source

On the first remedy hash, I changed retained `openplan/version.txt` after successful promotion and called recovery. It finished with `phase=recovered`, restored the modified content and left tracked source dirty. The backup Git HEAD still matched, and the fixture health endpoint reported that HEAD. This reproduced the gap between a Git identifier and actual retained file bytes.

The corrected source compares every retained source/settings path against its recorded `before` fingerprint before stopping or modifying the active instance. It also verifies installed transaction paths and clean tracked source before restart. The new corruption regression passes on the corrected snapshot; it fails against the first remedy because the expected refusal is absent. Log: `followup-regression-proof.log`. Raw initial reproduction: `followup-probes.log`.

This fix protects recorded source/settings bytes. It does not establish that a reported commit cryptographically identifies every `.next` bundle or dependency byte. Real restart/route acceptance remains separate.

### F2. Managed environment symlink silently became a regular file

On the first remedy hash, `.env.local` could be a symlink to a separate managed settings file. Update completed, but promotion replaced that link with the candidate's copied regular file. Future managed settings changes would no longer reach the active service.

The corrected source refuses an existing `.env.local` symlink before preparation. Its regression confirms the link still points at the managed file and no restart occurs. The test passes on the corrected snapshot and fails against the first remedy because the expected refusal is absent. This is explicit unsupported-configuration handling; managed settings updates have not been implemented or accepted.

A newer ordinary `.env.local` edit after promotion is also preserved: recovery refuses before stopping when its fingerprint matches neither recorded version. The captured suite verifies the newer content remains intact and the candidate fixture stays answering.

## Interruption checks

I independently interrupted recovery after each of its five actual rename operations in the fixture: removing the newly introduced tracked path, then displacing/restoring each runtime directory. I raised an interruption immediately after the real rename, left the persisted journal in place and called recovery again.

All five resumed on both reviewed remedy snapshots. On the corrected hash, every case finished recovered with predecessor source text, clean tracked Git state, and the original runtime markers present. See `followup-corrected-interruptions.log` and `followup-corrected/probe_recovery_interruptions.py`. The original fixture's runtime-byte assertions separately confirm normal recovery restores its predecessor markers with their original contents.

These probes exercise process interruption at the selected rename boundaries. They do not simulate power failure, interruption during a filesystem write, every Git metadata transition, or a real systemd/Next restart. Source `copy_file` writes a temporary file, fsyncs it and replaces the target; promotion/recovery still lack explicit fsync of all changed parent directories. The original report's computer-crash durability limit therefore remains open. Do not describe these results as power-loss proof.

## Verification

The frozen corrected suite ran 15 tests and returned success. See `followup-corrected-suite.log`. It covers the original recovery cases plus concurrent local artifacts, ignored-file collision, changed settings, retained-source corruption and managed-settings refusal. The lead was adding further tests concurrently; this report counts only its frozen snapshot.

An independent three-case regression check first ran a harmless comment change and observed all three tests survive. It then ran the original D1 code and the first remedy code against the relevant corrected regressions. Each failed with the expected assertion: active root replaced, retained-source refusal missing, or managed-settings refusal missing. See `followup-regression-proof.log` and `followup-corrected/verify_review_cases.py`.

The tests use real Git, file operations and local HTTP but fake npm and systemctl. They cannot establish actual build integrity, database compatibility, permissions across a real agency deployment, or GUI accessibility. I did not run or claim a full application acceptance campaign.

## Recommendation

Accept the corrected source as a bounded repair of D1, F1 and F2, subject to the lead's remaining exact-source tests and mutation checks. Keep the existing pre-release and operational evidence limits visible. Preserve mutable storage outside future replaceable releases as the long-term installation rule. Do not use this follow-up as authorization to operate an installed demo or as proof of a complete M3a outcome.
