# Retired staff translation route

2026-09-13. Continues `GENERATION_EDITOR_PROGRESS.md` at `5dd61c0a` in
`/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`,
branch `work/translation-command-workflow`. Prior turn was progress: the editor
integration and fault evidence were committed and pushed.

## Change and caller review

The old staff `POST/DELETE /api/engagement/campaigns/[campaignId]/translations`
route now returns HTTP 410 with `kind: retired`, a private/no-store header, and
instructions to keep unsaved words before reopening the editor. It does not read
request bodies, authentication, campaign records, model keys or the database.
It does not redirect an old request or manufacture its original saved version.
The response describes only this refused request, not an earlier uncertain attempt.

The current production editor already calls `/generation` and `/commands`.
Searches across application source, scripts and QA found no remaining production
caller on the old staff endpoint. The remaining application reference to
`engagement_content_translations` through `.from()` is a read in
`loadCampaignTranslations`; the retired route's direct save, accept, withdrawal
and inline model generation implementations were removed.

No generation, authoring, acceptance or withdrawal capability was removed from
the current editor. The replacement commands keep original source/version,
request identity, correction reason and exact receipt checks. The old body lacks
those facts and cannot be converted safely by rereading the newest snapshot.

## Evidence

- Seven native/React suites passed, 213 tests: retired route, command routes,
  command/receipt and storage helpers, retained publication API, generation API,
  full editor generation/publication join, and campaign authoring.
- TypeScript exit 0 and full application ESLint exit 0.
- Dead-code check exit 0. Its configured warning categories still report unused
  exports/types and duplicate exports; this is not a claim of zero warnings.
- `prove-retired-translation-route.py` and the adjacent JSON report bind source
  and test hashes. Baseline and two harmless source edits survived. Twelve
  targeted changes failed their named assertions: false success, caching,
  redirect, losing recovery instructions, claiming a write, reflecting words,
  reading the old body, opening user/service clients, calling the model, and
  raising/lowering the current command acceptance limit.
- `which-openplan.sh http://127.0.0.1:3260` identified this checkout's live Next dev
  process. Real local HTTP POST and DELETE returned 410/retired with private,
  no-store caching. This was an HTTP probe, not browser navigation acceptance.
- Mutation sources were restored and the final diff check reported no whitespace
  problems. No migration, grant, worker, main branch or tag was changed.

Private logs are in
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913`:
`translation-retired-route-tests.log`, `retired-translation-route-controls.log`,
and `translation-retired-deadcode.log`. The first TypeScript invocation mistakenly
ran from the repository root through npm --prefix and printed help with exit 1;
it did not check the package. The subsequent explicit package-root invocation
completed with exit 0. Do not use the first attempt as evidence.

## Test replacement and retained protections

The old `accepting-a-machine-translation-makes-it-the-agencys-own.test.ts` tested
successful legacy direct writes and inline generation. It is superseded by
`engagement-translation-retired-route.test.ts`, which verifies refusal without
side effects or request disclosure. Git history at `5dd61c0a` preserves the old
route and test. Their former success expectations are intentionally obsolete.

Current authorization, version/scope binding, operator provenance, unchanged
machine words on acceptance, exact withdrawal and failure distinctions are
covered by `engagement-translation-command-routes.test.ts`,
`engagement-translation-write.test.ts`, and their separate SQL fault/race evidence.
Generation identity, scope, credential/retry and retained-output requirements
have generation route, worker and SQL evidence. Machine publication comes from
retained output and is verified in `translation-publication-command.test.ts`.
These suites ran with the new refusal tests; their invariants were not deleted.

The authoring test formerly searched the old route's schema text for the accept
cap. It now executes the current command schema at exactly the editor's cap and
one entry beyond it, using distinct valid addresses. It still checks that the
page supplies the same editor cap. Faults changing the command limit to 199 and
201 both fail this test.

## Remaining work

The staff producer join is now in source, but protected command activation and
browser-worker acceptance remain unfinished. Add an additive activation migration
that grants the checked command and removes ordinary authenticated direct DML
on saved translations. Test that legitimate command writes succeed and direct
writes fail, without disrupting the service fixture/upgrade paths. Read the actual
SQL ownership/grants and current RLS fixtures before choosing exact changes.

The named isolated application stack was last permanently through migration12;
13 through16 still need a safe application/upgrade path. Earlier proof scripts
assume that baseline. Do not reset the demo or blindly retarget those proofs.
Use the named disposable stacks recorded in the generation-editor reset note.

Public comment translation is a separate remaining producer at
`openplan/src/app/api/engage/[shareToken]/items/[itemId]/translate/route.ts`.
It uses `translateEngagementText`, caches through
`engagement_cache_reviewed_translation`, rechecks public visibility/source after
fresh generation, and uses a separate public allowance. Its uncached calls still
lack durable reservation/dispatch/output recovery and use fire-and-forget metering.
The staff changes do not close that gap. Preserve public privacy and original
comment custody while extending durable generation there; do not claim public
spend accounting or interrupted retries are solved by retiring the staff route.

Also complete generation editor archive/readback/unreadable-request recovery and
its live worker/publication journey at desktop and 390px with keyboard/console
inspection, then applicable full QA, shuffled tests, isolated RLS, worker and
upgrade checks. Continue toward the full V1 contract. No human-review release
gate is required; this is an engineering checkpoint, not a released capability.
