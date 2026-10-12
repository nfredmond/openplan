# Hosted review fixes, October 12, 2026

The independent review of the hosted relaunch (written outside the repository
at `$HOME/.local/state/openplan/hosted-relaunch-audit-20261010/OPUS_REVIEW.md`)
found one blocker and five high findings. This record states what changed for
each and what was observed. Evidence values are in `evidence.json`.

## Fixed in code (this branch)

- **B-1, open redirect after sign-in or sign-up.** `safeNextPath` refused only
  `//` and `/\` prefixes. `/\t/evil.example` passed and resolved off site in
  `router.push`. It now refuses control characters and backslashes and checks
  the parsed origin. Reverting the check fails five new cases.
- **H-1, confirmation email in spam.** The sign-up notice now says to check
  spam and offers "Send the link again." The sign-up and landing pages no
  longer say the workspace is ready immediately.
- **H-2, shared paid AI key.** A production build shares `ANTHROPIC_API_KEY`
  with keyless workspaces only when `OPENPLAN_SHARED_AI_KEY=allow`. All four
  readers go through one rule, and each fails its own mutation.
- **H-5, agent guidance.** AGENTS.md now states that main is production, who
  applies hosted migrations and in what order, and where the hold lives.

## Fixed in production (outside a deploy)

- **H-4, PostGIS write guard.** A disposable PostgREST 14.15 stack showed
  anonymous insert, update and delete on `spatial_ref_sys` through
  `/spatial%5Fref%5Fsys`. On the hosted project, an encoded GraphQL request
  passed the old guard (HTTP 200). The hardened guard was applied to project
  `lolckycpdjsgeejsmuzl` on October 12 at about 00:20 UTC with the repository
  script, and the extended verify script passed there. Encoded paths now return
  401; ordinary reads still return 200. Production `spatial_ref_sys` matches a
  fresh PostGIS 3.3.7 install (8,500 rows, same content hash), so no tampering
  is evident.
- **H-3, offsite backup.** Nathaniel chose an offsite copy over an evaluation
  label. See `workers/hosted-backup/DEPLOY.md` and the hosted recovery guide.
  The first capture was decrypted, every object hash checked, and the archive
  restored into a disposable database that matches production's counts.

## Still open

- Nathaniel must store the offsite private key and passphrase somewhere other
  than this workstation.
- Medium and low review findings remain follow-up work.
- Captures are not atomic and do not include worker volumes.
