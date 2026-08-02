#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
output_directory="$project_root/ops/encrypted-secrets"
output_file="$output_directory/aarre-production-secrets.tar.gz.enc"
checksum_file="$output_file.sha256"
keychain_service="com.aarre.production-secrets"
keychain_account="recovery-passphrase-v1"
recovery_directory="${AARRE_RECOVERY_DIRECTORY:-$HOME/Documents/Aarre-Recovery}"
recovery_file="$recovery_directory/Aarre-production-secrets-recovery-passphrase.txt"
ssh_key="${AARRE_PRODUCTION_SSH_KEY:-$HOME/.ssh/nexvoice-production.pem}"
ssh_host="${AARRE_PRODUCTION_SSH_HOST:-ubuntu@43.161.230.52}"
temporary_directory="$(mktemp -d)"
bundle_root="$temporary_directory/aarre-production-recovery"

cleanup() {
  unset AARRE_RECOVERY_PASSPHRASE recovery_passphrase
  rm -rf "$temporary_directory"
}
trap cleanup EXIT
chmod 0700 "$temporary_directory"

mkdir -p "$output_directory" "$recovery_directory"
chmod 0700 "$recovery_directory"
if ! recovery_passphrase="$(security find-generic-password -s "$keychain_service" -a "$keychain_account" -w 2>/dev/null)"; then
  recovery_passphrase="$(openssl rand -base64 48 | tr -d '\n')"
  security add-generic-password -U -s "$keychain_service" -a "$keychain_account" -w "$recovery_passphrase" >/dev/null
  umask 077
  printf '%s\n' "$recovery_passphrase" > "$recovery_file"
  chmod 0600 "$recovery_file"
fi
if [[ -z "$recovery_passphrase" ]]; then
  echo "Recovery passphrase is empty." >&2
  exit 1
fi
if [[ ! -f "$ssh_key" ]] || [[ "$(stat -f '%Lp' "$ssh_key")" != "600" ]]; then
  echo "Production SSH key is missing or does not have mode 600: $ssh_key" >&2
  exit 1
fi

mkdir -p "$bundle_root/server/etc/aarre" "$bundle_root/ssh"
chmod 0700 "$bundle_root" "$bundle_root/server" "$bundle_root/server/etc" \
  "$bundle_root/server/etc/aarre" "$bundle_root/ssh"
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$ssh_key" "$ssh_host" \
  'sudo tar -C /etc/aarre -czf - aarre.env backup.env api-cam.env tencent-provision-state.json' \
  | tar -xzf - -C "$bundle_root/server/etc/aarre"
install -m 0600 "$ssh_key" "$bundle_root/ssh/nexvoice-production.pem"
printf '%s\n' \
  'format_version=2' \
  "generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "ssh_host=$ssh_host" \
  'public_api=https://sync.nexvoice.cc' \
  'google_project=aarre-production' \
  'primary_cos=aarre-private-1251806841' \
  'backup_cos=aarre-backup-1251806841' \
  > "$bundle_root/metadata.txt"
chmod 0600 "$bundle_root/metadata.txt" "$bundle_root/server/etc/aarre/"*

temporary_output="$output_file.$$.tmp"
export AARRE_RECOVERY_PASSPHRASE="$recovery_passphrase"
COPYFILE_DISABLE=1 tar -C "$temporary_directory" -czf - aarre-production-recovery \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -md sha256 \
      -pass env:AARRE_RECOVERY_PASSPHRASE -out "$temporary_output"
chmod 0600 "$temporary_output"
mv "$temporary_output" "$output_file"

openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 \
  -pass env:AARRE_RECOVERY_PASSPHRASE -in "$output_file" \
  | tar -tzf - | grep -q '^aarre-production-recovery/ssh/nexvoice-production.pem$'
(
  cd "$output_directory"
  shasum -a 256 "$(basename "$output_file")" > "$(basename "$checksum_file")"
)
chmod 0600 "$checksum_file"
echo "Encrypted and verified the Aarre recovery bundle: $output_file"
