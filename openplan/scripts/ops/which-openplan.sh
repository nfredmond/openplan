#!/usr/bin/env bash
#
# WHICH OPENPLAN IS THIS? — ask a running instance which build it is serving,
# and say plainly whether that matches the checkout you are working in.
#
# RUN THIS BEFORE TRUSTING ANYTHING A BROWSER SHOWS YOU.
#
# WHY IT EXISTS
#   More than one OpenPlan runs on this machine. The canonical checkout is
#   edited and served by `next dev`; the always-on walkthrough instance is a
#   SEPARATE clone served by `openplan-web.service` on :3000, because `next dev`
#   and `next start` would otherwise fight over the same `.next` directory (see
#   refresh-walkthrough-instance.sh). Both answer on localhost. Neither says
#   which one it is unless you ask.
#
#   On 2026-08-08 a browser-testing pass spent half an hour diagnosing a place-
#   search bug on :3000 — an instance 174 commits behind main — and the bug had
#   already been fixed in the tree being edited. Every conclusion drawn from
#   that session was about code nobody was working on. The same class of error
#   is on record from 2026-07-30: a test reported as proving something while it
#   inspected the wrong filesystem.
#
#   A port is not an identity. This makes the identity one command.
#
# Usage:
#   scripts/ops/which-openplan.sh [url]            # default http://localhost:3000
#   scripts/ops/which-openplan.sh http://localhost:3210
#
# Exit status: 0 when the instance matches this checkout's HEAD, 1 otherwise —
# so it can gate a script, not just inform a person.

set -uo pipefail

URL="${1:-http://localhost:3000}"
HEALTH="${URL%/}/api/health"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && git rev-parse --show-toplevel 2>/dev/null)"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }

BODY="$(curl -fsS --max-time 10 "$HEALTH" 2>/dev/null)" || {
  red "No answer from $HEALTH"
  echo "Nothing is serving that URL, or it is not an OpenPlan instance."
  exit 1
}

json_field() { printf '%s' "$BODY" | grep -oE "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

REPORTED_COMMIT="$(json_field commit)"
REPORTED_VERSION="$(json_field version)"

echo "Instance:  $URL"
echo "Version:   ${REPORTED_VERSION:-<not reported>}"
echo "Commit:    ${REPORTED_COMMIT:-<not reported>}"

if [ -z "$REPO_ROOT" ]; then
  yellow "Not inside a git checkout, so there is nothing to compare against."
  exit 1
fi

LOCAL_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
LOCAL_SHORT="$(printf '%s' "$LOCAL_SHA" | cut -c1-12)"
echo "Checkout:  $REPO_ROOT @ $(git -C "$REPO_ROOT" rev-parse --short HEAD)"
echo

# A LOCAL PORT CAN BE ASKED DIRECTLY WHICH DIRECTORY IT IS SERVING.
#
# This is the most literal answer available and it beats every heuristic: the
# kernel knows the working directory of the process holding the socket. It also
# covers the case a commit stamp cannot — `next dev`, which compiles from source
# and therefore has no build to stamp, and whose commit would go stale within
# minutes of being written down.
serving_dir_for_local_port() {
  local port="$1" pid
  pid="$(ss -ltnp 2>/dev/null | grep -E "[:.]${port}[[:space:]]" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)"
  [ -n "$pid" ] || return 1
  readlink "/proc/$pid/cwd" 2>/dev/null
}

PORT="$(printf '%s' "$URL" | grep -oE ':[0-9]+' | head -1 | tr -d ':')"
SERVING_DIR=""
case "$URL" in
  *localhost*|*127.0.0.1*) [ -n "$PORT" ] && SERVING_DIR="$(serving_dir_for_local_port "$PORT" || true)" ;;
esac

# A DIFFERENT CHECKOUT IS NOT BY ITSELF A PROBLEM.
#
# The walkthrough instance is SUPPOSED to be a separate tree — that is the whole
# reason it exists (see refresh-walkthrough-instance.sh). What matters is which
# COMMIT it is serving. Until 2026-08-12 this branch shouted "DIFFERENT
# CHECKOUT" in red and exited before the commit was ever compared, so the
# healthiest possible state — a freshly refreshed demo sitting on exactly your
# HEAD — reported as an alarming failure. Read from the control panel by someone
# who does not read code, that is worse than saying nothing: it teaches them to
# ignore the one line that would tell them the demo had gone stale.
#
# So: compare the commit first, and only call it a mismatch when it IS one.
if [ -n "$SERVING_DIR" ]; then
  echo "Serving from: $SERVING_DIR"
  SERVING_REPO="$(git -C "$SERVING_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$SERVING_REPO" ] && [ -n "$REPO_ROOT" ] && [ "$SERVING_REPO" != "$REPO_ROOT" ]; then
    echo
    if [ -n "$REPORTED_COMMIT" ] && [ "$REPORTED_COMMIT" != "unknown" ] \
       && [ "$REPORTED_COMMIT" = "$LOCAL_SHORT" ]; then
      green "UP TO DATE — a separate copy, serving the same commit as your checkout."
      echo "That copy is $SERVING_REPO, which is expected: the always-on instance"
      echo "is deliberately its own clone. It is on the code you are working on."
      exit 0
    fi
    red "DIFFERENT CHECKOUT AND A DIFFERENT BUILD — served out of $SERVING_REPO"
    echo "You are working in $REPO_ROOT. These are two different trees, and that"
    echo "one is NOT on your commit, so nothing you see there reflects your work."
    if [ -n "$REPORTED_COMMIT" ] && [ "$REPORTED_COMMIT" != "unknown" ] \
       && git -C "$REPO_ROOT" cat-file -e "${REPORTED_COMMIT}^{commit}" 2>/dev/null; then
      echo "It is $(git -C "$REPO_ROOT" rev-list --count "${REPORTED_COMMIT}..HEAD" 2>/dev/null || echo '?') commit(s) behind your HEAD."
    fi
    echo "To bring it up to date: scripts/ops/refresh-walkthrough-instance.sh"
    exit 1
  fi
fi

# "unknown" is the honest answer from an instance whose operator never stamped
# OPENPLAN_COMMIT_SHA. It is not a match, and it must not be reported as one.
if [ -z "$REPORTED_COMMIT" ] || [ "$REPORTED_COMMIT" = "unknown" ]; then
  if [ -n "$SERVING_DIR" ] && [ "${SERVING_REPO:-}" = "$REPO_ROOT" ]; then
    green "Serving your checkout live (a dev server compiles from source)."
    echo "No commit is reported, and none should be: a dev server has no build to stamp,"
    echo "and a stamped SHA would be stale the moment you commit. The directory above is"
    echo "the identity that matters here, and it is yours."
    exit 0
  fi
  red "This instance does not report a commit, so it CANNOT be identified."
  echo "It may be any build at all — do not use it to verify a code change."
  echo "If it is a built instance, stamp OPENPLAN_COMMIT_SHA (the refresh script does this)."
  echo "If it is a dev server on another machine, check its working directory by hand."
  exit 1
fi

if [ "$REPORTED_COMMIT" = "$LOCAL_SHORT" ]; then
  green "MATCH — this instance is serving the checkout you are working in."
  exit 0
fi

red "MISMATCH — this instance is NOT serving your checkout."
if git -C "$REPO_ROOT" cat-file -e "${REPORTED_COMMIT}^{commit}" 2>/dev/null; then
  BEHIND="$(git -C "$REPO_ROOT" rev-list --count "${REPORTED_COMMIT}..HEAD" 2>/dev/null || echo '?')"
  AHEAD="$(git -C "$REPO_ROOT" rev-list --count "HEAD..${REPORTED_COMMIT}" 2>/dev/null || echo '?')"
  echo "It is $BEHIND commit(s) behind and $AHEAD ahead of your HEAD."
  git -C "$REPO_ROOT" log -1 --format='Serving: %h %ad %s' --date=short "$REPORTED_COMMIT" 2>/dev/null
else
  echo "Its commit is not in this repository at all — a different fork or an unfetched branch."
fi
echo
echo "Anything you observe here is about that build, not your working tree."
echo "To refresh the walkthrough instance: scripts/ops/refresh-walkthrough-instance.sh"
exit 1
