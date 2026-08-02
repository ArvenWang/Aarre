#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_secret_file="/etc/aarre/backup.env"
if [[ ! -f "$backup_secret_file" || "$(stat -c '%a' "$backup_secret_file")" != "600" ]]; then
  echo "$backup_secret_file must exist with mode 600 before maintenance timers are enabled." >&2
  exit 1
fi
for unit in \
  aarre-backup.service \
  aarre-backup.timer \
  aarre-monthly-backup.service \
  aarre-monthly-backup.timer \
  aarre-deletion-worker.service \
  aarre-deletion-worker.timer \
  aarre-health-check.service \
  aarre-health-check.timer
do
  sudo install -m 644 "$script_directory/$unit" "/etc/systemd/system/$unit"
done
sudo systemctl daemon-reload
sudo systemctl enable --now \
  aarre-backup.timer \
  aarre-monthly-backup.timer \
  aarre-deletion-worker.timer \
  aarre-health-check.timer
sudo systemctl list-timers --all 'aarre-*'
