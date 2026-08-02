#!/usr/bin/env bash
set -euo pipefail

: "${AARRE_DB_PASSWORD:?AARRE_DB_PASSWORD is required}"

database_container="${AARRE_POSTGRES_CONTAINER:-production-control-db-1}"
if ! sudo docker inspect "$database_container" >/dev/null 2>&1; then
  echo "PostgreSQL container is unavailable: $database_container" >&2
  exit 1
fi

sudo docker exec -i "$database_container" psql -v ON_ERROR_STOP=1 \
  -U nexvoice -d postgres \
  -v role_name=aarre \
  -v database_name=aarre_sync \
  -v role_password="$AARRE_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role_name', :'role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name') \gexec

SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'role_name', :'role_password') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'database_name', :'role_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'database_name') \gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', :'database_name', :'role_name') \gexec
SQL

echo "Aarre PostgreSQL role/database are ready."
