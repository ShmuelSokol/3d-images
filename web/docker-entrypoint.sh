#!/bin/sh
set -e

# Railway mounts the persistent volume at /app/.cache owned by root, which
# replaces the directory (and its build-time ownership) from the image. The app
# runs as `nextjs`, so without this the model download fails with EACCES and
# every job errors. Fix ownership as root, then drop privileges to run the app.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/.cache /tmp/3d-jobs
  chown -R nextjs:nodejs /app/.cache /tmp/3d-jobs 2>/dev/null || true
  exec gosu nextjs "$@"
fi

exec "$@"
