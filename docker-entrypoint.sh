#!/bin/sh
set -e
# Apply pending migrations as the schema owner, then start the API as the restricted role.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations..."
  ./node_modules/.bin/prisma migrate deploy
fi
exec "$@"
