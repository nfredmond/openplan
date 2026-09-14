# Translation integration guard repairs

September 13, 2026. Continues d84f01f1 in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`. The previous goal turn made progress by proving direct receipt privacy and passing all 484 isolated RLS tests. Its wider unit run exposed nine failures; documentation repairs closed two in that checkpoint. This increment addresses the remaining seven failures.

## Changes and evidence

The retired POST/DELETE route now calls the existing audit logger for its 410 refusal. It uses standard request metadata and constant status context; it never consumes the submitted body or adds query values, authorization headers or model/database work. The native route tests execute the real logger with a captured console sink, verify both methods and exact audit fields, and keep the old refusal, no-redirect, no-cache and no-effect cases. The caller inventory now names the old-client endpoint explicitly and executes both exported methods to ensure it remains a 410 retirement response.

The SQL-column register now identifies eight real generation custody readers: reservation/dispatch timestamps are checked by constraints, the immutable-field trigger and output delivery; retained output fields are consumed by exact retry comparison and the private request reader. The source scanner cannot see those SQL uses. Its obsolete response payload checksum entry was removed because another source now names payload_sha256. **This scanner matches identifiers globally: removing that entry does not establish a new reader for the separate response receipt table.** Its previous operator-only/usefulness boundary remains unproved by this scanner.

The installed isolated catalog has 261 application relations: 248 tables, 13 views, all 248 tables with RLS. The three additions are generation requests, fields and outputs from migration 13, with no client policies. Counts exclude extension-owned relations using pg_depend, not a guessed name list; the initial raw view count of 15 included two PostGIS views. Private catalog evidence is `translation-generation-installed-catalog.json` under the usual response-write probe directory.

The policy/grant guard now explicitly treats the three retired translation writer policies as command-only. It keeps their existing membership checks as a second boundary if a grant is restored, and independently requires authenticated and anonymous INSERT/UPDATE/DELETE to remain revoked, the exact three policy names to remain accounted for, and staff SELECT to remain available. Other policy promises retain the existing general check. No database policy, privilege or migration was changed by this decision. The actual installed command and direct-write refusals retain their separate live evidence.

The unassessed-language sentence now says: "Coverage is unassessed for this source language. Translations may still be available." This preserves unknown coverage without implying zero translations. The copy baseline was not increased. Copy and authoring suites passed 42 tests; new desktop/390px browser acceptance remains unfinished.

## Fault controls and limits

- Retired route controls: baseline plus two harmless edits survived; 14 targeted faults failed, including omitted audit and query leakage. The updated script refused an ambiguous status replacement before mutating files; the fault was narrowed to response status, leaving audit status intact.
- Integration controls: baseline plus five harmless edits survived; 13 targeted faults failed. These include a revived excused endpoint, missing caller/SQL-reader registrations, a stale checksum exception, an extra table and disabled output RLS. These are mechanical inventory controls, not SQL reader execution.
- Command-only controls: baseline plus two harmless edits survived; eight targeted faults failed. Six restore direct privileges for authenticated/anonymous clients, one denies staff SELECT, and one removes a named exception. All mutation SQL was parsed only, never applied to the database. All source files were restored.
- Identified dev HTTP on port 3260 returned 410 for POST and DELETE without reflecting synthetic submitted/query text. Identity and HTTP results are private `translation-retired-audit-identity.log` and `translation-retired-audit-http.json`. This is HTTP evidence, not a new browser journey or production build.

A scratch edit initially failed its exact-marker assertion before touching the column/inventory files; they were subsequently edited and checked. Do not confuse the initial failing guard log with the final restored-source control runs.

Full unit and TypeScript/lint terminal results are recorded below. No full QA gate, shuffled suite, worker rerun, production build, new full RLS rerun, main merge or release is claimed in this increment. The earlier RLS run covers the unchanged installed schema; new static guard faults never changed that database.

## Resume next

Adapt the old translation browser wrappers to require installed migration 17 and preserve its grants. They currently expect 331/12 and revoke command execution at exit; do not run them unchanged on the installed 336/17 stack. Confirm Setup navigation has completed before keyboard interaction. Complete the actual browser generation-to-local-worker-to-review-to-publication workflow at desktop and 390px, remaining editor recovery cases, and public comment generation durability/privacy. Then complete relevant full QA, shuffled, worker and populated upgrade checks; inspect final main CI before tagging. Preserve the full V1 contract and local/free constraints, without human-review release gates.

## Terminal checks

Full unit suite completed with exit 0:

```text
Test Files  1290 passed | 47 skipped (1337)
      Tests  14856 passed | 462 skipped (15318)
   Start at  19:06:30
   Duration  122.98s (transform 151.77s, setup 145.75s, import 557.49s, tests 818.30s, environment 942.84s)
```

TypeScript and focused ESLint completed with exit 0 and empty diagnostic logs. Diff check passed. Full QA and browser/worker acceptance remain incomplete as described above.
