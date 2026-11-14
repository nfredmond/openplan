#!/usr/bin/env bash
# Host wrapper for every kit step that needs credentials or a container.
#
#   KIT_IMAGE=openplan-hosted-install:<sha> KIT_ENV_CMD="railway run -s offsite-backup -e production --" \
#     scripts/ops/hosted-install/kit.sh <command> WINDOW_DIR [args...]
#
# Commands:
#   hosted WINDOW_DIR MODE [run_sql.py args]   rtt, read, catalog, dryrun, install or probe on hosted.
#                                               WINDOW_DIR is /work in the container; kit files are /kit.
#   verify WINDOW_DIR STAMP KEY_DIR             download, decrypt and check one capture into WINDOW_DIR/decrypted.
#   keycheck KEY_DIR                            encrypt to the key's public half and decrypt with its secret half
#                                               in the image; no network, no credentials (KIT_ENV_CMD unused).
#
# Credentials (review 15, N1): KIT_ENV_CMD runs env_to_stdin.py on this host,
# which writes the named variables as one JSON line into the container's stdin.
# stdin_env.py in the container moves them into its own environment. No value
# appears on a command line, in the container record or in this script's
# output. Containers run with --rm and the openplan-hosted-install label, and
# this script fails if any such container is left afterward.
#
# KIT_DOCKER_NETWORK (Phase A rehearsal only; unset on window day) runs the
# hosted container on that Docker network, so the stand-in stack's database is
# reached on its own port 5432, the only port HostedTarget accepts (review 31, N5).
set -euo pipefail
kit_dir=$(cd "$(dirname "$0")" && pwd)
image=${KIT_IMAGE:?set KIT_IMAGE to the tag image/build.sh printed}
label=openplan-hosted-install
command=${1:?usage: kit.sh hosted|verify|keycheck DIR ...}
window=${2:?usage: kit.sh $command DIR ...}
shift 2
if [ "$command" = hosted ] || [ "$command" = verify ]; then
  env_cmd=${KIT_ENV_CMD:?set KIT_ENV_CMD, for example "railway run -s offsite-backup -e production --"}
  mkdir -p "$window/evidence"
fi
window_abs=$(cd "$window" && pwd -W 2>/dev/null || pwd)
python_=$(command -v python || command -v python3)
network_args=()
if [ -n "${KIT_DOCKER_NETWORK:-}" ]; then
  network_args=(--network "$KIT_DOCKER_NETWORK")
fi

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
      | MSYS_NO_PATHCONV=1 docker run -i --rm --label "$label" "${network_args[@]}" -v "$window_abs:/work" "$image" \
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
  keycheck)
    # Step 6: prove a key folder (for example the D: copy) decrypts in the
    # image that step 11 uses. No network and no credentials.
    key_abs=$(cd "$window" && pwd -W 2>/dev/null || pwd)
    status=0
    MSYS_NO_PATHCONV=1 docker run --rm --network none --label "$label" \
      --tmpfs /gnupg:uid=999,gid=999,mode=0700 \
      -v "$key_abs/secret.asc:/run/key/secret.asc:ro" -v "$key_abs/passphrase.txt:/run/key/passphrase:ro" \
      -v "$key_abs/public.asc:/run/key/public.asc:ro" -v "$key_abs/FINGERPRINT:/run/key/FINGERPRINT:ro" \
      "$image" sh -c '
        set -e
        export GNUPGHOME=/gnupg
        fpr=$(cat /run/key/FINGERPRINT)
        mkdir -m 700 /tmp/pub
        printf "openplan key check\n" > /tmp/plain
        gpg --homedir /tmp/pub --batch --quiet --import /run/key/public.asc 2>/dev/null
        gpg --homedir /tmp/pub --batch --quiet --trust-model always --recipient "$fpr" --output /tmp/cipher --encrypt /tmp/plain
        gpg --batch --quiet --pinentry-mode loopback --passphrase-file /run/key/passphrase --import /run/key/secret.asc 2>/dev/null
        gpg --batch --quiet --pinentry-mode loopback --passphrase-file /run/key/passphrase --output /tmp/back --decrypt /tmp/cipher 2>/dev/null
        cmp -s /tmp/plain /tmp/back && echo "key check passed in the kit image for $fpr"' || status=$?
    leftover_check
    exit "$status"
    ;;
  *)
    echo "unknown command $command" >&2
    exit 2
    ;;
esac
