#!/usr/bin/env bash
#
# Refresh the always-on local OpenPlan instance (the one behind
# `openplan-web.service` on :3000) to current origin/main.
#
# WHY A SEPARATE CHECKOUT EXISTS
#   The walkthrough instance is deliberately NOT the canonical repo. `next dev`
#   in the canonical checkout and `next start` here would fight over the same
#   `.next` directory, so the instance lives in its own clone and is refreshed
#   by this script instead of being edited in place.
#
# WHAT THIS REFUSES TO DO
#   It will not discard work. A dirty tree or a branch that is not a
#   fast-forward of origin/main aborts the run — refreshing a demo box is never
#   worth losing an uncommitted change.
#
# ENV VARS ARE NOT COPIED. The instance keeps its own .env.local. This script
# only reports, BY NAME, variables the canonical checkout defines that the
# instance does not — because a missing one degrades the instance silently
# (e.g. without OPENPLAN_INTEGRATION_KEY_SECRET the integration-keys panel
# reports storage unavailable, and stored workspace keys cannot be decrypted
# even though both point at the same database). Values are never printed.
#
# Usage:  scripts/ops/refresh-walkthrough-instance.sh [instance-dir]
# Default instance-dir: $HOME/apps/openplan

set -euo pipefail

INSTANCE_ROOT="${1:-$HOME/apps/openplan}"
APP_DIR="$INSTANCE_ROOT/openplan"
SERVICE="openplan-web.service"
CANONICAL_ENV="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.env.local"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mrefresh aborted: %s\033[0m\n' "$1" >&2; exit 1; }

[ -d "$APP_DIR" ] || fail "no app directory at $APP_DIR"

step "Checking the instance checkout is safe to move"
cd "$INSTANCE_ROOT"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  fail "the instance checkout has uncommitted changes — resolve them first"
fi

step "Fetching origin"
git fetch --quiet origin

BEHIND="$(git rev-list --count HEAD..origin/main)"
AHEAD="$(git rev-list --count origin/main..HEAD)"
if [ "$AHEAD" -ne 0 ]; then
  fail "the instance is $AHEAD commit(s) ahead of origin/main — it holds work that is not pushed"
fi

if [ "$BEHIND" -eq 0 ]; then
  echo "Already current with origin/main ($(git rev-parse --short HEAD))."
else
  step "Fast-forwarding $BEHIND commit(s) to origin/main"
  git merge --ff-only origin/main
fi

step "Comparing env var NAMES against the canonical checkout"
if [ -f "$CANONICAL_ENV" ] && [ -f "$APP_DIR/.env.local" ]; then
  missing="$(comm -23 \
    <(grep -oE '^[A-Z_][A-Z0-9_]*=' "$CANONICAL_ENV" | tr -d '=' | sort -u) \
    <(grep -oE '^[A-Z_][A-Z0-9_]*=' "$APP_DIR/.env.local" | tr -d '=' | sort -u))"
  if [ -n "$missing" ]; then
    printf 'Defined in the canonical .env.local but MISSING here:\n'
    printf '  %s\n' $missing
    printf 'The instance will run, but each of those features degrades. Add them by hand if the\nwalkthrough needs them.\n'
  else
    echo "No missing variables."
  fi
else
  echo "Skipped (one of the .env.local files is absent)."
fi

step "Stamping the commit this instance is being built from"
# WHY. `appCommitSha()` reads OPENPLAN_COMMIT_SHA, /api/health reports it, and
# the dashboard prints it — but nothing ever SET it, so every self-hosted
# instance answered "commit unrecorded". That is how this box sat 174 commits
# behind main on 2026-08-08 with nothing able to say so, and how a testing pass
# mistook it for the working tree. `next start` reads .env.local at runtime, so
# stamping it here makes the running instance able to name itself.
INSTANCE_SHA="$(git -C "$INSTANCE_ROOT" rev-parse HEAD)"
touch "$APP_DIR/.env.local"
if grep -q '^OPENPLAN_COMMIT_SHA=' "$APP_DIR/.env.local"; then
  sed -i "s|^OPENPLAN_COMMIT_SHA=.*|OPENPLAN_COMMIT_SHA=$INSTANCE_SHA|" "$APP_DIR/.env.local"
else
  printf '\n# Set by scripts/ops/refresh-walkthrough-instance.sh so /api/health can name this build.\nOPENPLAN_COMMIT_SHA=%s\n' "$INSTANCE_SHA" >> "$APP_DIR/.env.local"
fi
echo "OPENPLAN_COMMIT_SHA=$(git -C "$INSTANCE_ROOT" rev-parse --short HEAD)"

step "Installing dependencies"
cd "$APP_DIR"
npm ci

step "Building"
npm run build

step "Restarting $SERVICE"
systemctl --user restart "$SERVICE"
sleep 3
systemctl --user is-active --quiet "$SERVICE" || fail "$SERVICE did not come back up — check: journalctl --user -u $SERVICE -n 50"

step "Confirming the instance reports the build it is actually running"
# The check that closes the loop: ask the running service which commit it is,
# rather than trusting that the restart picked up the new build.
REPORTED="$(curl -fsS --max-time 10 http://localhost:3000/api/health 2>/dev/null \
  | grep -oE '"commit":"[^"]*"' | cut -d'"' -f4 || true)"
EXPECTED_SHORT="$(git -C "$INSTANCE_ROOT" rev-parse HEAD | cut -c1-12)"
if [ "$REPORTED" = "$EXPECTED_SHORT" ]; then
  echo "/api/health reports $REPORTED — matches the checkout."
else
  printf '\033[31mWARNING: /api/health reports "%s" but the checkout is at "%s".\033[0m\n' \
    "${REPORTED:-<no answer>}" "$EXPECTED_SHORT" >&2
  echo "The service may still be serving an older build. Check: journalctl --user -u $SERVICE -n 50" >&2
fi

step "Done"
echo "Instance now serves $(git -C "$INSTANCE_ROOT" rev-parse --short HEAD) on http://localhost:3000"
echo "Verify at any time with: scripts/ops/which-openplan.sh http://localhost:3000"
