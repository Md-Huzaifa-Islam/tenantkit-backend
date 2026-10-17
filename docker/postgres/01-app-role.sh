#!/bin/sh
# Runs once on a fresh Postgres volume. Creates the restricted login role the API uses.
# It is NOT a superuser, does NOT have BYPASSRLS and does NOT own any tables,
# so every query it runs is subject to row-level security.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE tenantkit_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tenantkit_app')
\gexec
SQL
