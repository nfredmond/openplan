#!/usr/bin/env bash
# Build the kit image from committed files only and print its tag.
#   scripts/ops/hosted-install/image/build.sh
# The tag is openplan-hosted-install:<12-character commit>. A tree with changes
# under the kit or the backup worker is refused, so the tag names the bytes.
set -euo pipefail
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo"
if [ -n "$(git status --porcelain -- scripts/ops/hosted-install workers/hosted-backup)" ]; then
  echo "refusing: uncommitted changes under scripts/ops/hosted-install or workers/hosted-backup" >&2
  exit 2
fi
sha=$(git rev-parse --short=12 HEAD)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
# git archive copies committed bytes only, never the working tree.
git archive HEAD workers/hosted-backup/backup.py workers/hosted-backup/verify_capture.py \
  scripts/ops/hosted-install | tar -x -C "$stage"
rm -rf "$stage/scripts/ops/hosted-install/rehearsal"
tag="openplan-hosted-install:$sha"
docker build --quiet -t "$tag" -f "$stage/scripts/ops/hosted-install/image/Dockerfile" "$stage" >/dev/null
docker run --rm --network none "$tag" python3 -c 'import sys, boto3; print(sys.version.split()[0])' >/dev/null
echo "$tag"
