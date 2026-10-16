#!/usr/bin/env bash
#
# Nightly OpenSign MongoDB backup.
# Runs mongodump inside the running mongo container and streams a gzipped
# archive to the backups dir. Keeps 7 days of backups; older ones are deleted.
#
# On ANY failure it emails helpdesk@westmschools.org so a silently-broken
# backup can't go unnoticed again (it did: Aug-Sep 2026, ~6 weeks, while the
# mongo container was crash-looping and every dump failed with no alert).
#
# Installed in crontab on lx03 (see `crontab -l`).

set -euo pipefail

CONTAINER="mongo-container"
DB="OpenSignDB"
BACKUP_DIR="/NAS/lx03/Apps/OpenSign/Volumes/backups"
LOG="$BACKUP_DIR/backup.log"
RETENTION_DAYS=7
MIN_BYTES=10000   # a valid dump is far larger; guards against empty-file backups

# Failure alerting. SMTP creds are read from .env.prod at runtime (it is
# gitignored) so no secrets live in this script.
ENV_FILE="/NAS/lx03/Apps/OpenSign/.env.prod"
ALERT_TO="helpdesk@westmschools.org"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/opensign-${TS}.archive.gz"

mkdir -p "$BACKUP_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# Pull a single KEY=VALUE out of the env file without executing it.
get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2-; }

ALERTED=0

# send_alert "<reason line>" — emails helpdesk via the Gmail SMTP relay in
# .env.prod using curl. Best-effort: never aborts the script (logs and moves on).
send_alert() {
  local reason="$1"
  ALERTED=1

  local host smtp_host smtp_port smtp_user smtp_pass smtp_from
  host="$(hostname 2>/dev/null || echo unknown-host)"
  smtp_host="$(get_env SMTP_HOST)"
  smtp_port="$(get_env SMTP_PORT)"
  smtp_user="$(get_env SMTP_USERNAME)"
  smtp_pass="$(get_env SMTP_PASS)"
  smtp_from="$(get_env SMTP_USER_EMAIL)"
  [ -n "$smtp_from" ] || smtp_from="$smtp_user"

  if [ -z "$smtp_host" ] || [ -z "$smtp_user" ] || [ -z "$smtp_pass" ]; then
    log "ALERT: could not send email (SMTP config missing in $ENV_FILE): $reason"
    return 0
  fi

  local msg
  msg="$(mktemp)"
  {
    echo "From: OpenSign Backup <${smtp_from}>"
    echo "To: ${ALERT_TO}"
    echo "Subject: [OpenSign] Nightly database backup FAILED on ${host}"
    echo "Date: $(date -R)"
    echo "Content-Type: text/plain; charset=UTF-8"
    echo
    echo "The nightly backup of the OpenSign MongoDB database FAILED."
    echo
    echo "  Reason:    ${reason}"
    echo "  Host:      ${host}"
    echo "  Time:      $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "  Database:  ${DB}"
    echo "  Container: ${CONTAINER}"
    echo "  Target:    ${OUT}"
    echo
    echo "No backup file was written for tonight. Until this is resolved,"
    echo "the OpenSign database is NOT being backed up."
    echo
    echo "What to check:"
    echo "  * Is the '${CONTAINER}' container running and healthy?"
    echo "      docker ps -a --filter name=${CONTAINER}"
    echo "  * Recent backup log entries:"
    echo
    tail -n 15 "$LOG" 2>/dev/null | sed 's/^/      /'
  } > "$msg"

  if curl --silent --show-error --ssl-reqd \
       --url "smtps://${smtp_host}:${smtp_port:-465}" \
       --user "${smtp_user}:${smtp_pass}" \
       --mail-from "${smtp_from}" \
       --mail-rcpt "${ALERT_TO}" \
       --upload-file "$msg" >>"$LOG" 2>&1; then
    log "ALERT: failure email sent to ${ALERT_TO}"
  else
    log "ALERT: FAILED to send failure email to ${ALERT_TO} (see curl output above)"
  fi

  rm -f "$msg"
}

# Catch any unexpected non-zero exit (set -e) that the explicit branches below
# didn't already alert on.
on_exit() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$ALERTED" -eq 0 ]; then
    send_alert "backup script exited unexpectedly (exit code ${code})"
  fi
}
trap on_exit EXIT

log "=== backup start -> $(basename "$OUT") ==="

# Stream a gzipped mongodump archive out of the container to the host.
if ! docker exec "$CONTAINER" mongodump --db "$DB" --archive --gzip > "$OUT" 2>>"$LOG"; then
  log "ERROR: mongodump failed; removing partial file"
  rm -f "$OUT"
  send_alert "mongodump failed (is the ${CONTAINER} container running and healthy?)"
  exit 1
fi

# Guard against silent empty/corrupt backups (the June-2024 134-byte failure mode).
SIZE="$(stat -c %s "$OUT" 2>/dev/null || echo 0)"
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  log "ERROR: backup only ${SIZE} bytes (< ${MIN_BYTES}); removing and failing"
  rm -f "$OUT"
  send_alert "backup file was only ${SIZE} bytes (expected >= ${MIN_BYTES}); dump is empty or truncated"
  exit 1
fi

log "OK: wrote ${SIZE} bytes"

# Retention: delete backups older than RETENTION_DAYS.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'opensign-*.archive.gz' -mtime +"$RETENTION_DAYS" -print -delete | wc -l)"
log "retention: deleted ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
log "=== backup done ==="
