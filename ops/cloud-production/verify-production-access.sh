#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_directory/../.." && pwd)"
encrypted_directory="$project_root/ops/encrypted-secrets"
ssh_key="${AARRE_PRODUCTION_SSH_KEY:-$HOME/.ssh/nexvoice-production.pem}"
ssh_host="${AARRE_PRODUCTION_SSH_HOST:-ubuntu@43.161.230.52}"
public_base_url="${AARRE_PUBLIC_BASE_URL:-https://sync.nexvoice.cc}"

(
  cd "$encrypted_directory"
  shasum -a 256 -c aarre-production-secrets.tar.gz.enc.sha256
)

if [[ ! -f "$ssh_key" ]]; then
  echo "Missing production SSH key: $ssh_key" >&2
  echo "Run ops/cloud-production/restore-production-access.sh --install-ssh first." >&2
  exit 1
fi
if [[ "$(stat -f '%Lp' "$ssh_key")" != "600" ]]; then
  echo "Production SSH key must have mode 600: $ssh_key" >&2
  exit 1
fi

ready_body="$(curl --fail --silent --show-error "$public_base_url/ready")"
if [[ "$ready_body" != '{"ok":true}' ]]; then
  echo "Unexpected public readiness response: $ready_body" >&2
  exit 1
fi
curl --fail --silent --show-error --output /dev/null "$public_base_url/"
curl --fail --silent --show-error --output /dev/null "$public_base_url/privacy"
curl --fail --silent --show-error --output /dev/null "$public_base_url/terms"

ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$ssh_key" "$ssh_host" '
  set -euo pipefail
  api_container="aarre-production-aarre-api-1"
  release="$(readlink -f /opt/aarre/current)"
  health="$(sudo docker inspect -f "{{.State.Health.Status}}" "$api_container")"
  version="$(sudo docker exec "$api_container" node -p "require(\"./package.json\").version")"
  counts="$(sudo docker exec "$api_container" node -e '\''const {Client}=require("pg"); const c=new Client({connectionString:process.env.DATABASE_URL}); (async()=>{await c.connect(); const m=await c.query("select count(*)::int n from schema_migrations"); const t=await c.query("select count(*)::int n from information_schema.tables where table_schema=$1", ["public"]); console.log(`${m.rows[0].n}/${t.rows[0].n}`); await c.end()})().catch(error=>{console.error(error.message); process.exit(1)})'\'')"
  test "$health" = "healthy"
  test "$(curl --fail --silent --show-error http://127.0.0.1:8788/ready)" = "{\"ok\":true}"
  test "$(sudo stat -c "%a" /etc/aarre/aarre.env)" = "600"
  test "$(sudo stat -c "%a" /etc/aarre/api-cam.env)" = "600"
  test "$(sudo stat -c "%a" /etc/aarre/backup.env)" = "600"
  systemctl is-active --quiet aarre-health-check.timer
  systemctl is-active --quiet aarre-deletion-worker.timer
  systemctl is-active --quiet aarre-backup.timer
  systemctl is-active --quiet aarre-monthly-backup.timer
  recent_errors="$(sudo docker logs --since 10m "$api_container" 2>&1 | grep -Eic "fatal|uncaught|unhandled" || true)"
  printf "release=%s\nhealth=%s\nversion=%s\nmigrations/tables=%s\nrecent_fatal_errors=%s\n" \
    "$release" "$health" "$version" "$counts" "$recent_errors"
'

certificate_end="$(openssl s_client -connect sync.nexvoice.cc:443 -servername sync.nexvoice.cc </dev/null 2>/dev/null | openssl x509 -noout -enddate)"
printf 'public_ready=%s\ncertificate_%s\n' "$ready_body" "$certificate_end"
