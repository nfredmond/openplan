---
title: OpenPlan env-file hygiene — `.env.local` no longer points at production
date: 2026-04-16
head_sha_before: fa3e884c34093f61aaeae1bf4a14da304bcba568
---

# OpenPlan env-file hygiene

## Problem discovered

During the 2026-04-16 reconciliation pass, the local `.env.local` at
`openplan/openplan/.env.local` was found to contain **production** Supabase
credentials (`https://aggphdqkanxsfzzoxlbk.supabase.co`, matching prod
service-role + anon JWTs). The file had been populated by an earlier
`vercel env pull`, which is convenient but dangerous: Next.js loads
`.env.local` in both dev and prod, so a `pnpm dev` against a default
checkout would have exercised write paths (RLS enforced, but still real
data mutations) against the production database.

A secondary symptom: the same file had `MAPBOX_ACCESS_TOKEN=""sk.eyJ…""`
(doubled quotes from a `vercel env pull` quirk). The Next.js runtime
parses this correctly, but the Supabase CLI's env parser trips on
`unexpected character '\' in variable name`, which is why every
`pnpm supabase` command this session needed a `mv .env.local .env.local.bak`
move-aside workaround.

## Fix

Three-file layout that follows Next.js's documented env precedence
(`.env.development.local` > `.env.local` > `.env.development` > `.env`
in dev; `.env.production.local` > `.env.local` > `.env.production` > `.env`
in prod start):

- `.env.local` — **local-safe only**. Local Supabase (127.0.0.1:54321) +
  Mapbox + Anthropic + OpenAI + Census. Loaded in both dev and prod, so
  it must never contain production overrides.
- `.env.production.local` — production overrides. Loaded **only** by
  `next start` / `next build`, never by `pnpm dev`. This is where the
  production Supabase URL, service-role key, Stripe live secrets, webhook
  signing keys, TURBO/Vercel build tokens, and MCP keys live.
- `.env.local.backup-2026-04-16` — safety copy of the pre-fix state, kept
  on disk during the transition. Not committed (`.env*` is gitignored).

The doubled-quote bug is gone because the new `.env.local` was written
with single-layer quoting. `pnpm supabase status` now runs without the
move-aside workaround.

## How to regenerate the local file

If the local `.env.local` is ever lost or stale:

```bash
cd openplan/openplan
pnpm supabase start                                # boots local stack
pnpm supabase status -o env > /tmp/supabase.env   # extracts anon + service-role JWTs
# Copy the two JWT values into .env.local under
#   NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
# then re-add Mapbox/Anthropic/OpenAI/Census from .env.production.local or a password manager.
```

The local Supabase anon/service-role JWTs are **deterministic per local
stack** (baked into the supabase-demo project fixture). They are not
sensitive in any real sense — a public GitHub search finds thousands of
them — but keeping them in `.env.local` means `pnpm dev` never has to
touch the production stack.

## How to run against production locally (when needed)

Operators sometimes want to reproduce a prod bug with a local dev
server. The safe pattern:

```bash
cp .env.production.local .env.development.local    # prod creds override in dev only
pnpm dev                                           # dev server hits prod Supabase
# When done:
rm .env.development.local
```

`.env.development.local` has higher precedence than `.env.local` in dev
mode, so this cleanly swaps in prod creds for a single session without
mutating `.env.local`.

## Why not commit `.env.example` with these names?

`openplan/openplan/.env.example` already lists the required keys. This
doc describes **operational layout** (which file is loaded when), not
which keys exist. The example file is the key catalog; this doc is the
file-layout contract.

## Residual

- `.env.local.backup-2026-04-16` can be deleted once the new layout has
  been exercised for a week without issue. Leaving it on disk during the
  transition is a cheap safety net.
- Any teammate who checked out `openplan` before 2026-04-17 and ran
  `pnpm dev` may have exercised write paths against prod. RLS limits the
  blast radius to the operator's own workspace, but a spot-audit of
  recent `workspaces.updated_at` / `projects.updated_at` would close
  the loop.

## Verification

```
$ ls -la openplan/openplan/.env*
.env.example                      (tracked, keys only)
.env.local                        (local Supabase + dev secrets)
.env.local.backup-2026-04-16      (pre-fix safety copy)
.env.production.local             (production overrides, next start only)

$ pnpm dev
▲ Next.js 16.1.6 (Turbopack)
- Local:         http://localhost:3000
- Environments: .env.local          ← ONLY this file, as expected
✓ Ready in 916ms
$ curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/
200

$ pnpm supabase status
supabase local development setup is running.
(no parse error; move-aside workaround no longer needed)
```
