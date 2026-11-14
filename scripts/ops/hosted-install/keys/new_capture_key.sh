#!/usr/bin/env bash
# Make the offsite capture key pair. Prints only the new fingerprint.
#
#   scripts/ops/hosted-install/keys/new_capture_key.sh "$HOME/.local/state/openplan/offsite-capture-key-YYYYMMDD"
#
# Writes into TARGET (which must not exist): gnupg/ (the keyring), passphrase.txt,
# public.asc, secret.asc (passphrase-protected), revocation.asc and FINGERPRINT.
# The primary key is ed25519 certify-only with a cv25519 encryption subkey, as
# test_backup.py uses. Before printing, it checks that the keyring holds one
# secret key with an encryption subkey and that a file encrypted to public.asc
# in a second, empty keyring decrypts with this one.
#
# On Windows use Git Bash and an MSYS path (/c/Users/...): Git's gpg reads a
# C:/ path as relative, and a keyring path over about 90 characters fails with
# "socket name too long" (review 15, L2 and N3). chmod does nothing on NTFS,
# so the folder's access list is set with icacls when it is available.
set -euo pipefail
target=${1:?usage: new_capture_key.sh TARGET_DIR}
case "$target" in
  /*) ;;
  *) echo "refusing: TARGET_DIR must be an absolute POSIX path such as /c/Users/..." >&2; exit 2 ;;
esac
if [ -e "$target" ]; then echo "refusing: $target already exists" >&2; exit 2; fi
if [ ${#target} -gt 84 ]; then echo "refusing: $target is too long for gpg's agent socket" >&2; exit 2; fi
py=$(command -v python || command -v python3) || { echo "refusing: no python found" >&2; exit 2; }
umask 077
mkdir -p "$target/gnupg" "$target/roundtrip"
export GNUPGHOME="$target/gnupg"
cleanup() {
  gpgconf --homedir "$target/gnupg" --kill gpg-agent >/dev/null 2>&1 || true
  gpgconf --homedir "$target/roundtrip" --kill gpg-agent >/dev/null 2>&1 || true
  rm -rf "$target/roundtrip"
}
trap cleanup EXIT
"$py" -c 'import secrets, sys; sys.stdout.write(secrets.token_urlsafe(32))' > "$target/passphrase.txt"
gpg_=(gpg --batch --no-tty --quiet --pinentry-mode loopback --passphrase-file "$target/passphrase.txt")
uid="OpenPlan offsite capture $(date -u +%Y-%m) <offsite-capture@openplan.invalid>"
"${gpg_[@]}" --quick-generate-key "$uid" ed25519 cert never >/dev/null 2>&1
fpr=$("${gpg_[@]}" --with-colons --list-keys | awk -F: '/^fpr:/ {print $10; exit}')
[ ${#fpr} -eq 40 ] || { echo "refusing: no fingerprint after key generation" >&2; exit 1; }
"${gpg_[@]}" --quick-add-key "$fpr" cv25519 encr never >/dev/null 2>&1
"${gpg_[@]}" --armor --export "$fpr" > "$target/public.asc"
"${gpg_[@]}" --armor --export-secret-keys "$fpr" > "$target/secret.asc"
cp "$GNUPGHOME/openpgp-revocs.d/$fpr.rev" "$target/revocation.asc"
printf '%s\n' "$fpr" > "$target/FINGERPRINT"

# One secret key, and a secret subkey that can encrypt.
secrets_=$("${gpg_[@]}" --with-colons --list-secret-keys)
[ "$(printf '%s\n' "$secrets_" | grep -c '^sec:')" -eq 1 ] || { echo "refusing: expected exactly one secret key" >&2; exit 1; }
printf '%s\n' "$secrets_" | awk -F: '$1 == "ssb" && $12 ~ /e/ {found = 1} END {exit !found}' \
  || { echo "refusing: no encryption subkey" >&2; exit 1; }

# Round trip: encrypt to public.asc from an empty keyring, decrypt with this one.
rt=(gpg --homedir "$target/roundtrip" --batch --no-tty --quiet)
"${rt[@]}" --import "$target/public.asc" >/dev/null 2>&1
printf 'openplan capture key round trip\n' > "$target/roundtrip/plain.txt"
"${rt[@]}" --trust-model always --recipient "$fpr" --output "$target/roundtrip/cipher.gpg" --encrypt "$target/roundtrip/plain.txt"
"${gpg_[@]}" --output "$target/roundtrip/back.txt" --decrypt "$target/roundtrip/cipher.gpg" >/dev/null 2>&1
cmp -s "$target/roundtrip/plain.txt" "$target/roundtrip/back.txt" || { echo "refusing: round trip failed" >&2; exit 1; }

if command -v icacls >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1; then
  MSYS2_ARG_CONV_EXCL='*' icacls "$(cygpath -w "$target")" /inheritance:r /grant:r "${USERNAME}:(OI)(CI)F" >/dev/null
fi
printf '%s\n' "$fpr"
