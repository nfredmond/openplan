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

step "Installing dependencies"
cd "$APP_DIR"
npm ci

step "Building"
npm run build

step "Restarting $SERVICE"
systemctl --user restart "$SERVICE"
sleep 3
systemctl --user is-active --quiet "$SERVICE" || fail "$SERVICE did not come back up — check: journalctl --user -u $SERVICE -n 50"

step "Done"
echo "Instance now serves $(git -C "$INSTANCE_ROOT" rev-parse --short HEAD) on http://localhost:3000"
