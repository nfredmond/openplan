# Generation editor usage-reset checkpoint

Saved on 2026-09-13 in response to Nathaniel's request to make resumption safe.
This is unfinished implementation on the work branch, not a release or a claim
of passing acceptance. The continuous objective remains the full V1 contract.

## Resume here

- Checkout: `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`.
- Package: `openplan/`; branch: `work/translation-command-workflow`.
- Previous verified checkpoint: `a92f5f54921c679c761d93e97087285ae46cd189`.
- Read this note, then `OUTLINE_HOVER_PROGRESS.md`, `PENDING_PUBLICATION_PROGRESS.md`
  and `PUBLICATION_COMMAND_PROGRESS.md` in this directory.
- Original checkout and demo belong to other work. Another Codex process was
  present at checkpoint time. Recheck ownership before editing or joining main.
- User authorizes direct verified main merges and releases, no PRs or human-review
  release gates. Keep operation free and local; preserve pending reminder work.

## Saved unfinished edits

`openplan/src/lib/engagement/translation-generation-editor.ts` adds frozen request
storage, scope-bound generation reads, archives, and publication preparation using
original saved revisions from retained history rather than the newest snapshot.

`openplan/src/components/engagement/translation-generation-panel.tsx` adds request
creation/retry, catalog discovery, retained output review, and separate publication.
Storage failure prevents dispatch; uncertain acknowledgements retain exact intent.
The panel uses explicit refresh rather than automatic polling. Unreadable requests
without a recoverable server record may still lack a complete self-service path.
Unmount cancellation and archive/download failure behavior need review.

`openplan/src/components/engagement/campaign-translations-panel.tsx` joins generation
and publication controls. The old controls that generated and published unseen
output were removed from this component. Legacy API producers still exist and must
be replaced or refused before enabling the protected command.

No focused tests, mutation controls, lint, full QA or browser acceptance have been
completed for these new editor changes. The first TypeScript log is empty and no
TypeScript process remained when checked; its exit status was lost during context
compaction, so do not count that as a pass. Rerun TypeScript explicitly.
`git diff --check` produced no diagnostics at checkpoint time, which establishes
only patch whitespace cleanliness.

## Next work

1. Review these three files, run TypeScript and lint, fix demonstrated issues.
2. Add behavior tests and harmless/targeted fault controls for frozen storage before
   dispatch, lost acknowledgements, scope/actor/field binding, catalog recovery after
   local storage or key loss, and original publication baselines from history.
3. Replace or refuse legacy staff suggest/publish-machine service DML producers.
   Assess public comment generation separately for privacy and usage accounting.
4. Safely join migrations 13 through 16 in the named isolated application stack,
   preserving older proof scripts' assumptions. Do not enable command execution
   before the producer join is safe.
5. Exercise the actual queue, worker, review and publication workflow through real
   navigation at desktop and 390px, with keyboard and console inspection. Use the
   existing worker proof's local synthetic provider interception, never a paid call.
6. Complete applicable QA, shuffled tests, RLS isolation, workers, upgrades and
   restore checks. Merge verified work directly to main, inspect final CI, then tag.
   Continue through the current roadmap toward the full V1 contract.

## Local services and evidence

- Owned dev URL was `http://127.0.0.1:3260`. Recheck with
  `bash openplan/scripts/ops/which-openplan.sh http://127.0.0.1:3260`.
  Processes, browser sessions and ports may not survive the usage gap.
- Isolated application DB container:
  `supabase_db_openplan-restore-target-2026091050`, API 29821, DB 29822.
  Last prior verified state: 331 migrations through `20261014000012`;
  migrations 13 through 16 not permanently applied and authenticated command
  execution revoked. Recheck before writes; this checkpoint made no DB changes.
- Separate proof databases live in
  `supabase_db_openplan-restore-target-2731143`:
  `openplan_translation_command_proof_20260913` and
  `openplan_translation_worker_proof_20260913`.
  Never attach a worker to the command proof database, which retains queued fixtures.
- Private logs and browser evidence:
  `/home/nathaniel/.local/state/openplan/response-write-probe-20260913`.
  Existing manual-editor and outline-hover evidence does not verify this new UI.
- No tests or worker jobs were started by this checkpoint. No processes were killed,
  migrations applied, command grants changed, tags created or main updates made.

The last recorded released version was v0.58.1. Refresh live main, tags and CI on
resumption rather than treating this historical value as the future current state.
