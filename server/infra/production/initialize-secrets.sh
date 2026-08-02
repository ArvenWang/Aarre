#!/usr/bin/env bash
set -euo pipefail

secret_directory="${AARRE_SECRET_DIRECTORY:-/etc/aarre}"
api_cam_file="$secret_directory/api-cam.env"
target_file="$secret_directory/aarre.env"

if [[ "$(id -u)" != "0" ]]; then
  echo "initialize-secrets.sh must run as root." >&2
  exit 1
fi
if [[ ! -f "$api_cam_file" ]]; then
  echo "Missing provisioned CAM credential file: $api_cam_file" >&2
  exit 1
fi
if [[ -e "$target_file" ]]; then
  echo "Refusing to overwrite existing production secrets: $target_file" >&2
  exit 1
fi
for required_name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  if [[ -z "${!required_name:-}" ]]; then
    echo "$required_name is required." >&2
    exit 1
  fi
done

while IFS= read -r line; do
  case "$line" in
    TENCENT_CLOUD_SECRET_ID=*|TENCENT_CLOUD_SECRET_KEY=*|TENCENT_CLOUD_REGION=*|COS_BUCKET=*|COS_REGION=*|COS_BACKUP_BUCKET=*|COS_BACKUP_REGION=*)
      export "$line"
      ;;
  esac
done < "$api_cam_file"

db_password="${AARRE_DB_PASSWORD:-$(openssl rand -base64 36 | tr -d '\n' | tr '/+' '_-')}"
token_pepper="$(openssl rand -hex 32)"
kek_base64="$(openssl rand -base64 32 | tr -d '\n')"
kek_keyring="{\"currentVersion\":\"v1\",\"keys\":{\"v1\":\"$kek_base64\"}}"
temporary_file="$target_file.$$.tmp"
umask 077

{
  printf 'NODE_ENV=production\n'
  printf 'HOST=0.0.0.0\n'
  printf 'PORT=8788\n'
  printf 'DATABASE_URL=postgres://aarre:%s@control-db:5432/aarre_sync\n' "$db_password"
  printf 'PUBLIC_BASE_URL=https://sync.nexvoice.cc\n'
  printf 'ALLOWED_EXTENSION_IDS=%s\n' "${AARRE_EXTENSION_IDS:-ohhmoipbedndbffmbpdkaoplojdefcak}"
  printf 'TOKEN_PEPPER=%s\n' "$token_pepper"
  printf 'GOOGLE_CLIENT_ID=%s\n' "$GOOGLE_CLIENT_ID"
  printf 'GOOGLE_CLIENT_SECRET=%s\n' "$GOOGLE_CLIENT_SECRET"
  printf 'GOOGLE_REDIRECT_URI=https://sync.nexvoice.cc/v1/auth/google/callback\n'
  printf 'SENTRY_DSN=%s\n' "${SENTRY_DSN:-}"
  printf 'SENTRY_ENVIRONMENT=production\n'
  printf 'SENTRY_RELEASE=%s\n' "${SENTRY_RELEASE:-aarre-sync-api@0.1.7}"
  printf 'TENCENT_CLOUD_SECRET_ID=%s\n' "$TENCENT_CLOUD_SECRET_ID"
  printf 'TENCENT_CLOUD_SECRET_KEY=%s\n' "$TENCENT_CLOUD_SECRET_KEY"
  printf 'TENCENT_CLOUD_REGION=%s\n' "$TENCENT_CLOUD_REGION"
  printf 'COS_BUCKET=%s\n' "$COS_BUCKET"
  printf 'COS_REGION=%s\n' "$COS_REGION"
  printf 'COS_BACKUP_BUCKET=%s\n' "$COS_BACKUP_BUCKET"
  printf 'COS_BACKUP_REGION=%s\n' "$COS_BACKUP_REGION"
  printf 'ASSET_URL_TTL_SECONDS=300\n'
  printf 'DEFAULT_QUOTA_BYTES=262144000\n'
  printf 'AARRE_KEK_KEYRING_JSON=%s\n' "$kek_keyring"
} > "$temporary_file"

chown root:root "$temporary_file"
chmod 0600 "$temporary_file"
mv "$temporary_file" "$target_file"
unset db_password token_pepper kek_base64 kek_keyring
echo "Initialized root-managed Aarre production secrets at $target_file."
