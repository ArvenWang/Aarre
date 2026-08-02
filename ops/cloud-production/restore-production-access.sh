#!/usr/bin/env bash
set -euo pipefail

mode="${1:---verify-only}"
case "$mode" in
  --verify-only|--install-ssh|--extract) ;;
  *)
    echo "Usage: $0 [--verify-only|--install-ssh|--extract]" >&2
    exit 2
    ;;
esac

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_directory/../.." && pwd)"
encrypted_directory="$project_root/ops/encrypted-secrets"
encrypted_file="$encrypted_directory/aarre-production-secrets.tar.gz.enc"
checksum_file="$encrypted_file.sha256"
keychain_service="com.aarre.production-secrets"
keychain_account="recovery-passphrase-v1"
ssh_target="${AARRE_PRODUCTION_SSH_KEY:-$HOME/.ssh/nexvoice-production.pem}"
temporary_directory="$(mktemp -d)"
listing_file="$temporary_directory/listing.txt"

cleanup() {
  unset AARRE_RECOVERY_PASSPHRASE recovery_passphrase
  rm -rf "$temporary_directory"
}
trap cleanup EXIT
chmod 0700 "$temporary_directory"

(
  cd "$encrypted_directory"
  shasum -a 256 -c "$(basename "$checksum_file")"
)

if [[ -n "${AARRE_RECOVERY_PASSPHRASE:-}" ]]; then
  recovery_passphrase="$AARRE_RECOVERY_PASSPHRASE"
elif recovery_passphrase="$(security find-generic-password -s "$keychain_service" -a "$keychain_account" -w 2>/dev/null)"; then
  :
else
  read -r -s -p "Aarre recovery passphrase: " recovery_passphrase
  printf '\n'
fi
if [[ -z "$recovery_passphrase" ]]; then
  echo "Recovery passphrase is empty." >&2
  exit 1
fi
export AARRE_RECOVERY_PASSPHRASE="$recovery_passphrase"

openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 \
  -pass env:AARRE_RECOVERY_PASSPHRASE -in "$encrypted_file" \
  | tar -tzf - > "$listing_file"

while IFS= read -r entry; do
  case "$entry" in
    aarre-production-recovery/|\
    aarre-production-recovery/metadata.txt|\
    aarre-production-recovery/server/|\
    aarre-production-recovery/server/etc/|\
    aarre-production-recovery/server/etc/aarre/|\
    aarre-production-recovery/server/etc/aarre/aarre.env|\
    aarre-production-recovery/server/etc/aarre/backup.env|\
    aarre-production-recovery/server/etc/aarre/api-cam.env|\
    aarre-production-recovery/server/etc/aarre/tencent-provision-state.json|\
    aarre-production-recovery/ssh/|\
    aarre-production-recovery/ssh/nexvoice-production.pem) ;;
    *)
      echo "Recovery archive contains an unexpected path: $entry" >&2
      exit 1
      ;;
  esac
done < "$listing_file"

openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 \
  -pass env:AARRE_RECOVERY_PASSPHRASE -in "$encrypted_file" \
  | tar -xzf - -C "$temporary_directory"
recovery_root="$temporary_directory/aarre-production-recovery"
test -s "$recovery_root/ssh/nexvoice-production.pem"
test -s "$recovery_root/server/etc/aarre/aarre.env"
test -s "$recovery_root/server/etc/aarre/backup.env"
test -s "$recovery_root/server/etc/aarre/api-cam.env"
test -s "$recovery_root/server/etc/aarre/tencent-provision-state.json"

if [[ "$mode" == "--install-ssh" ]]; then
  mkdir -p "$(dirname "$ssh_target")"
  chmod 0700 "$(dirname "$ssh_target")"
  if [[ -e "$ssh_target" ]] && ! cmp -s "$recovery_root/ssh/nexvoice-production.pem" "$ssh_target"; then
    echo "Refusing to overwrite a different SSH key: $ssh_target" >&2
    exit 1
  fi
  install -m 0600 "$recovery_root/ssh/nexvoice-production.pem" "$ssh_target"
  echo "Installed production SSH key: $ssh_target"
elif [[ "$mode" == "--extract" ]]; then
  recovery_target="${AARRE_RECOVERY_TARGET:-}"
  if [[ -z "$recovery_target" ]]; then
    echo "Set AARRE_RECOVERY_TARGET to a new secure directory for --extract." >&2
    exit 1
  fi
  if [[ -e "$recovery_target" ]]; then
    echo "Refusing to overwrite an existing recovery target: $recovery_target" >&2
    exit 1
  fi
  mkdir -p "$recovery_target"
  chmod 0700 "$recovery_target"
  cp -R "$recovery_root/." "$recovery_target/"
  find "$recovery_target" -type d -exec chmod 0700 {} +
  find "$recovery_target" -type f -exec chmod 0600 {} +
  echo "Extracted plaintext recovery material to: $recovery_target"
  echo "Keep it offline and delete it securely after the recovery window."
else
  echo "Encrypted recovery bundle decrypted and validated without retaining plaintext files."
fi
