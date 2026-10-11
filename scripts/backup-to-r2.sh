#!/usr/bin/env bash
#
# Off-site backup for the Emeradar production deployment.
#
# Runs on the VPS (from cron). Each run produces one encrypted archive and
# uploads it to Cloudflare R2:
#
#   db.dump       pg_dump -Fc of the `emeradar` database (pg_restore format)
#   app.env       the deployment .env — without it the dump alone cannot be
#                 brought back up (DB/JWT/API credentials all live there)
#   MANIFEST.txt  timestamp, git SHA, versions, sizes and checksums
#
# The tar is zstd-compressed and then encrypted with a symmetric passphrase,
# so the object stored in R2 is opaque without the passphrase. R2 therefore
# never holds anything that can be read on its own.
#
# Configuration lives in a root-only env file (default /opt/emeradar/.backup.env);
# see .backup.env.example. If that file does not exist the script logs one line
# and exits 0, so it is harmless to install the cron entry before the bucket
# exists.
#
# Usage:
#   scripts/backup-to-r2.sh            # normal run
#   scripts/backup-to-r2.sh --force    # upload even if today's object exists
#                                      # (a new object, never an overwrite — R2
#                                      #  bucket locks forbid overwrites)
set -Eeuo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/emeradar}"
ENV_FILE="${BACKUP_ENV_FILE:-$DEPLOY_DIR/.backup.env}"
LOCAL_DIR="${LOCAL_BACKUP_DIR:-/opt/emeradar-backups}"
LOCAL_KEEP_DAYS="${LOCAL_KEEP_DAYS:-7}"
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1.75.2}"
COMPOSE="docker compose -f $DEPLOY_DIR/docker-compose.prod.yml"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

log() { printf '%s [backup] %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Best effort: a broken alert must never be the reason a backup "fails".
# Reads only variables from .backup.env — never sources the app .env, whose
# quoting is not guaranteed to be shell-safe.
notify() {
  [ -n "${BACKUP_ALERT_TO:-}" ] || return 0
  [ -n "${RESEND_API_KEY:-}" ] || return 0
  [ -n "${ALERT_FROM_EMAIL:-}" ] || return 0
  local status="$1" text subject body
  text="${2:-}"
  subject="[emeradar] backup $status on $(hostname)"
  body=$(printf '%s' "$text" | tr -d '"\\' | tr '\n' ' ' | cut -c1-1500)
  curl -sS -m 20 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    -H 'Content-Type: application/json' \
    --data-binary "$(printf '{"from":"%s","to":["%s"],"subject":"%s","text":"%s"}' \
      "$ALERT_FROM_EMAIL" "$BACKUP_ALERT_TO" "$subject" "$body")" \
    >/dev/null 2>&1 || true
}

fail() { log "ERROR: $*"; notify FAILED "$*"; exit 1; }

[ -r "$ENV_FILE" ] || { log "not configured ($ENV_FILE absent) — skipping"; exit 0; }

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

missing=()
for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET BACKUP_GPG_PASSPHRASE; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
[ ${#missing[@]} -eq 0 ] || fail "incomplete config in $ENV_FILE — missing: ${missing[*]}"

export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

command -v docker >/dev/null || fail "docker not found"
command -v gpg >/dev/null || fail "gpg not found"

STAMP_DAY=$(date -u +%F)
STAMP_FULL=$(date -u +%FT%H%M%SZ)
NAME="emeradar-$STAMP_DAY.tar.zst.gpg"
KEY="${R2_KEY_PREFIX:-daily/}$NAME"
[ "$FORCE" = 1 ] && { NAME="emeradar-$STAMP_FULL.tar.zst.gpg"; KEY="${R2_KEY_PREFIX:-daily/}$NAME"; }

WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# Credentials are passed as environment, never argv — argv is world-readable
# via /proc while the container runs.
rclone() {
  docker run --rm \
    -e RCLONE_CONFIG_R2_TYPE=s3 \
    -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    -e RCLONE_CONFIG_R2_ACL=private \
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID \
    -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY \
    -e RCLONE_CONFIG_R2_ENDPOINT \
    -v "$WORK:/staging:ro" \
    "$RCLONE_IMAGE" "$@"
}

# Idempotent: cron retries, manual reruns and a container restart mid-run all
# land here rather than on top of an existing object.
#
# The retry flags matter: rclone's defaults back off for minutes on a DNS or
# connect failure, which would turn a broken network into a hung cron job
# instead of a fast error. One attempt, short timeouts, then move on.
FAST=(--retries 1 --low-level-retries 1 --contimeout 10s --timeout 30s)
probe=$(rclone lsjson "r2:$R2_BUCKET/$KEY" --no-mimetype --no-modtime "${FAST[@]}" 2>/dev/null || true)
case "$probe" in
  *'"Size"'*)
    if [ "$FORCE" = 0 ]; then
      log "already uploaded today: r2:$R2_BUCKET/$KEY — nothing to do"
      exit 0
    fi
    ;;
esac

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"

log "dumping database"
$COMPOSE exec -T postgres pg_dump -U postgres -d emeradar -Fc > "$WORK/db.dump" \
  || fail "pg_dump failed"
[ -s "$WORK/db.dump" ] || fail "pg_dump produced an empty file"

install -m 600 "$DEPLOY_DIR/.env" "$WORK/app.env" || fail "cannot read $DEPLOY_DIR/.env"

pg_version=$($COMPOSE exec -T postgres postgres --version 2>/dev/null | tr -d '\r' || true)
table_count=$($COMPOSE exec -T postgres psql -U postgres -d emeradar -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d '\r' || true)
git_sha=$(git -C "$DEPLOY_DIR" rev-parse HEAD 2>/dev/null || echo unknown)

{
  echo "backup_name: $NAME"
  echo "created_at:  $STAMP_FULL"
  echo "host:        $(hostname)"
  echo "git_sha:     $git_sha"
  echo "postgres:    ${pg_version:-unknown}"
  echo "tables:      ${table_count:-unknown}"
  echo "db.dump_bytes:  $(stat -c%s "$WORK/db.dump")"
  echo "db.dump_sha256: $(sha256sum "$WORK/db.dump" | cut -d' ' -f1)"
  echo "app.env_sha256: $(sha256sum "$WORK/app.env" | cut -d' ' -f1)"
} > "$WORK/MANIFEST.txt"

dump_sha=$(sha256sum "$WORK/db.dump" | cut -d' ' -f1)

log "compressing and encrypting"
tar --zstd -cf "$WORK/archive.tar.zst" -C "$WORK" db.dump app.env MANIFEST.txt \
  || fail "tar failed"

# --passphrase-fd keeps the passphrase off the command line and out of the
# process table.
printf '%s' "$BACKUP_GPG_PASSPHRASE" | gpg --batch --yes --quiet \
  --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 \
  --output "$WORK/$NAME" "$WORK/archive.tar.zst" \
  || fail "gpg encryption failed"
rm -f "$WORK/archive.tar.zst"

local_bytes=$(stat -c%s "$WORK/$NAME")
install -m 600 "$WORK/$NAME" "$LOCAL_DIR/$NAME"

log "uploading $NAME ($(( local_bytes / 1024 )) KiB)"
rclone copyto "/staging/$NAME" "r2:$R2_BUCKET/$KEY" \
  --s3-no-check-bucket --retries 3 --low-level-retries 3 \
  --contimeout 15s --timeout 300s --stats-one-line \
  || fail "upload to r2:$R2_BUCKET failed"

# Read the object back and confirm the byte count. A truncated upload that
# still returns success is the one failure a backup cannot tolerate silently.
remote_bytes=$(rclone lsjson "r2:$R2_BUCKET/$KEY" --no-mimetype --no-modtime "${FAST[@]}" 2>/dev/null \
  | tr -d ' \n' | grep -o '"Size":[0-9]*' | head -1 | cut -d: -f2 || true)
[ "$remote_bytes" = "$local_bytes" ] \
  || fail "size mismatch after upload: local=$local_bytes remote=${remote_bytes:-none}"

# Drop local copies past the retention window. The bundle holds the app .env,
# so it is encrypted at rest with the same passphrase as the R2 objects.
find "$LOCAL_DIR" -maxdepth 1 -type f -name 'emeradar-*.tar.zst.gpg' \
  -mtime "+$LOCAL_KEEP_DAYS" -print -delete 2>/dev/null | while read -r f; do
    log "pruned local copy $(basename "$f")"
  done

log "OK $NAME $(( local_bytes / 1024 )) KiB, db.dump sha256=$dump_sha, $table_count tables, git ${git_sha:0:8}"

# Failures always alert once alerting is configured; success is opt-in, because
# a daily "all good" mail trains you to ignore the one that matters. Written as
# an `if` rather than `[ ... ] && notify`: as the last statement of the script
# the latter would make a quiet run exit non-zero.
if [ "${BACKUP_ALERT_ON_SUCCESS:-0}" = "1" ]; then
  notify OK "Uploaded $NAME ($(( local_bytes / 1024 )) KiB) to r2:$R2_BUCKET/$KEY.
tables=$table_count db.dump_sha256=$dump_sha git=${git_sha:0:8}"
fi
