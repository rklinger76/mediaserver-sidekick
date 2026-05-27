#!/bin/sh
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${DATA_DIR:-/app/data}"
DEFAULT_EXPORT_DIR="${DEFAULT_EXPORT_DIR:-/exports}"
DEFAULT_BACKUP_DIR="${DEFAULT_BACKUP_DIR:-/backups}"

ensure_dir() {
  dir="$1"
  [ -n "$dir" ] || return 0
  mkdir -p "$dir"

  # If the container starts as root (normal Docker/Unraid mode), make bind mounts writable
  # for the runtime user. This is what avoids manual chown commands on first install.
  if [ "$(id -u)" = "0" ]; then
    chown -R "$PUID:$PGID" "$dir" 2>/dev/null || {
      echo "Warning: Could not chown $dir to $PUID:$PGID. The app may not be able to write there." >&2
    }
  fi
}

ensure_dir "$DATA_DIR"
ensure_dir "$DEFAULT_EXPORT_DIR"
ensure_dir "$DEFAULT_BACKUP_DIR"

if [ "$(id -u)" = "0" ]; then
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
