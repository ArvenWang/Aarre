#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="$script_directory/compose.yml"
secret_file="/etc/aarre/aarre.env"

if [[ ! -f "$secret_file" ]]; then
  echo "Missing root-managed secret file: $secret_file" >&2
  exit 1
fi
if [[ "$(stat -c '%a' "$secret_file")" != "600" ]]; then
  echo "$secret_file must have mode 600." >&2
  exit 1
fi
if (( $(df --output=avail -k / | tail -n 1) < 5242880 )); then
  echo "Deployment requires at least 5 GiB free system disk." >&2
  exit 1
fi
if (( $(awk '/MemAvailable/ {print $2}' /proc/meminfo) < 1048576 )); then
  echo "Deployment requires at least 1 GiB currently available memory." >&2
  exit 1
fi

if [[ -z "${AARRE_DB_PASSWORD:-}" ]]; then
  database_url=""
  while IFS= read -r line; do
    case "$line" in
      DATABASE_URL=*) database_url="${line#DATABASE_URL=}" ;;
    esac
  done < "$secret_file"
  if [[ -z "$database_url" ]]; then
    echo "DATABASE_URL is missing from $secret_file." >&2
    exit 1
  fi
  AARRE_DB_PASSWORD="$(AARRE_DATABASE_URL="$database_url" python3 -c 'import os, urllib.parse; print(urllib.parse.unquote(urllib.parse.urlsplit(os.environ["AARRE_DATABASE_URL"]).password or ""), end="")')"
  export AARRE_DB_PASSWORD
fi
"$script_directory/provision-database.sh"

sudo docker compose -f "$compose_file" config --quiet
sudo docker compose -f "$compose_file" build --pull aarre-api
sudo docker compose -f "$compose_file" up -d aarre-api

for _ in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:8788/ready >/dev/null; then
    echo "Aarre API is ready on 127.0.0.1:8788."
    exit 0
  fi
  sleep 2
done

sudo docker compose -f "$compose_file" logs --tail=100 aarre-api >&2
echo "Aarre API did not become ready." >&2
exit 1
