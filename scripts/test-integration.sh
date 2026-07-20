#!/usr/bin/env bash
set -euo pipefail

container="injpass-integration-${$}"
database="injpass_integration_test"
password="integration-only"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --detach --rm \
  --name "$container" \
  --env POSTGRES_PASSWORD="$password" \
  --env POSTGRES_DB="$database" \
  --publish 127.0.0.1::5432 \
  postgres:16-alpine >/dev/null

port="$(docker port "$container" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
export DATABASE_URL="postgresql://postgres:${password}@127.0.0.1:${port}/${database}?schema=public"
export DIRECT_URL="$DATABASE_URL"
export JWT_SECRET="integration-test-only-secret"
export CRON_SECRET="integration-test-only-cron-secret"
export ENABLE_GAME_RESET=true
export RUN_DATABASE_TESTS=1

case "$DATABASE_URL" in
  postgresql://*@127.0.0.1:*/*integration*test*) ;;
  *)
    echo "Refusing to run integration tests against a non-local or non-test database." >&2
    exit 1
    ;;
esac

until docker exec "$container" pg_isready --username postgres --dbname "$database" >/dev/null 2>&1; do
  sleep 1
done

pnpm prisma migrate deploy
pnpm prisma db seed
pnpm prisma db seed
pnpm vitest run --config vitest.integration.config.ts
