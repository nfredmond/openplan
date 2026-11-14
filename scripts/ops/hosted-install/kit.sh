#!/usr/bin/env bash
# Host wrapper for every kit step that needs credentials or a container.
#
#   KIT_IMAGE=openplan-hosted-install:<sha> KIT_ENV_CMD="railway run -s offsite-backup -e production --" \
#     scripts/ops/hosted-install/kit.sh <command> WINDOW_DIR [args...]
#
# Commands:
#   hosted WINDOW_DIR MODE [run_sql.py args]   read, catalog, dryrun, install or probe on hosted.
#                                               WINDOW_DIR is /work in the container; kit files are /kit.
#   verify WINDOW_DIR STAMP KEY_DIR             download, decrypt and check one capture into WINDOW_DIR/decrypted.
#
# Credentials (review 15, N1): KIT_ENV_CMD runs env_to_stdin.py on this host,
# which writes the named variables as one JSON line into the container's stdin.
# stdin_env.py in the container moves them into its own environment. No value
# appears on a command line, in the container record or in this script's
# output. Containers run with --rm and the openplan-hosted-install label, and
# this script fails if any such container is left afterward.
set -euo pipefail
kit_dir=$(cd "$(dirname "$0")" && pwd)
image=${KIT_IMAGE:?set KIT_IMAGE to the tag image/build.sh printed}
env_cmd=${KIT_ENV_CMD:?set KIT_ENV_CMD, for example "railway run -s offsite-backup -e production --"}
label=openplan-hosted-install
command=${1:?usage: kit.sh hosted|verify WINDOW_DIR ...}
window=${2:?usage: kit.sh $command WINDOW_DIR ...}
shift 2
mkdir -p "$window/evidence"
window_abs=$(cd "$window" && pwd -W 2>/dev/null || pwd)
python_=$(command -v python || command -v python3)

leftover_check() {
  local left
  left=$(docker ps -a --filter "label=$label" --format '{{.Names}}')
  if [ -n "$left" ]; then
    echo "kit: containers with label $label remain: $left" >&2
    exit 3
  fi
}
leftover_check

case "$command" in
  hosted)
    mode=${1:?usage: kit.sh hosted WINDOW_DIR MODE [args]}
    shift
    status=0
    # shellcheck disable=SC2086
    $env_cmd "$python_" -I "$kit_dir/env_to_stdin.py" pg \
      | MSYS_NO_PATHCONV=1 docker run -i --rm --label "$label" -v "$window_abs:/work" "$image" \
          python3 /kit/stdin_env.py python3 /kit/run_sql.py "$mode" --target hosted --out /work/evidence "$@" \
      || status=$?
    leftover_check
    exit "$status"
    ;;
  verify)
    stamp=${1:?usage: kit.sh verify WINDOW_DIR STAMP KEY_DIR}
    key_dir=${2:?usage: kit.sh verify WINDOW_DIR STAMP KEY_DIR}
    key_abs=$(cd "$key_dir" && pwd -W 2>/dev/null || pwd)
    mkdir -p "$window/decrypted"
    status=0
    # The private key enters a tmpfs keyring that disappears with the container.
    # shellcheck disable=SC2086
    $env_cmd "$python_" -I "$kit_dir/env_to_stdin.py" bucket \
      | MSYS_NO_PATHCONV=1 docker run -i --rm --label "$label" \
          --tmpfs /gnupg:uid=999,gid=999,mode=0700 \
          -v "$key_abs/secret.asc:/run/key/secret.asc:ro" -v "$key_abs/passphrase.txt:/run/key/passphrase:ro" \
          -v "$window_abs/decrypted:/out" "$image" \
          python3 /kit/stdin_env.py sh -c '
            set -e
            export GNUPGHOME=/gnupg BACKUP_GPG_PASSPHRASE_FILE=/run/key/passphrase BACKUP_CAPTURE="$1"
            gpg --batch --quiet --pinentry-mode loopback --passphrase-file /run/key/passphrase --import /run/key/secret.asc 2>/dev/null
            python3 /app/verify_capture.py "/out/$1"' sh "$stamp" \
      > "$window/evidence/verify-$stamp.json" || status=$?
    cat "$window/evidence/verify-$stamp.json"
    leftover_check
    exit "$status"
    ;;
  *)
    echo "unknown command $command" >&2
    exit 2
    ;;
esac
