#!/usr/bin/env bash
set -euo pipefail

health_url="http://127.0.0.1:8788/ready"
if curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null; then
  exit 0
fi

echo "Aarre readiness probe failed; restarting only the isolated Aarre API container." >&2
docker compose restart aarre-api
for _ in {1..10}; do
  if curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null; then
    echo "Aarre API recovered after an isolated restart."
    exit 0
  fi
  sleep 3
done

docker compose logs --tail=100 aarre-api >&2
echo "Aarre API did not recover after restart." >&2
exit 1
