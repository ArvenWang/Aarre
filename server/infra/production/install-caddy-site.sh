#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_file="$script_directory/Caddyfile"
target_file="/etc/caddy/Caddyfile"

if sudo grep -q '^sync\.nexvoice\.cc {' "$target_file"; then
  echo "sync.nexvoice.cc is already present in Caddyfile."
  exit 0
fi

temporary_file="$(mktemp)"
trap 'rm -f "$temporary_file"' EXIT
sudo cp "$target_file" "$temporary_file"
printf '\n' >> "$temporary_file"
cat "$source_file" >> "$temporary_file"
sudo caddy validate --adapter caddyfile --config "$temporary_file"
backup_file="${target_file}.bak-aarre-$(date -u +%Y%m%dT%H%M%SZ)"
sudo cp "$target_file" "$backup_file"
sudo install -m 644 "$temporary_file" "$target_file"
sudo systemctl reload caddy
echo "Caddy site installed; backup: $backup_file"
