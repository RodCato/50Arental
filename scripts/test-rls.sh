#!/usr/bin/env bash
# Never targets a supplied database: creates and destroys its own isolated cluster.
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
root=$(cd "$(dirname "$0")/.." && pwd)
fixture=$(mktemp -d /tmp/50a-rls.XXXXXX)
cleanup() { pg_ctl -D "$fixture/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$fixture"; }
trap cleanup EXIT
initdb -D "$fixture/data" -A trust -U postgres >/dev/null
pg_ctl -D "$fixture/data" -l "$fixture/postgres.log" -o "-k $fixture -p 55439 -c listen_addresses=''" -w start >/dev/null
export PGHOST="$fixture" PGPORT=55439 PGUSER=postgres PGDATABASE=postgres
psql -X -v ON_ERROR_STOP=1 -f "$root/supabase/tests/mock-platform.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20260922000100_initial_50a_schema.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20260926000100_receipt_tax_bucket.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 -f "$root/supabase/tests/isolation.sql"
