#!/usr/bin/env bash
#
# Copies every uploaded photo out of the shared photo bucket to this machine.
#
#   ./scripts/backup-photos.sh                 # into tmp/backups/photos/
#   ./scripts/backup-photos.sh --out ~/Backups/photos
#
# Restore with scripts/restore-photos.sh.
#
# The bucket is the only copy. It belongs to classyear-serverless, has no
# versioning and no replication, so a photo deleted or overwritten there —
# which the app does itself on every replace — is gone for good.
#
# Layout of the backup directory:
#
#   objects/photos/...            the photos, at their bucket keys
#   manifests/<UTC stamp>.tsv     key, size, ETag, last-modified, one line per
#                                 object in the bucket at the time of that run
#
# `objects/` is incremental and never deletes: a photo removed from the bucket
# stays here, so a later run never loses what an earlier one saved. The
# manifests are what make that safe to restore from — each records exactly
# which keys existed at one moment, so a restore can target that moment rather
# than "everything ever backed up". Take one alongside each database dump
# (scripts/backup-db.sh): the database holds the keys, and a restore needs the
# two to describe the same moment.
#
# Every file is checked against the manifest by size, and by MD5 against the
# object's ETag (uploads are single-part presigned PUTs, so the ETag is the MD5).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${REGION:-us-east-1}"
BUCKET="${FILE_BUCKET_NAME:-classyear-file-storage-372666940943-dev}"
PREFIX="photos/"
OUT_DIR="$REPO_ROOT/tmp/backups/photos"

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_DIR="${2:?--out needs a directory}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

md5_of() {
  if command -v md5sum >/dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi
}

# Photos are members' personal data: keep the backup readable only by you.
umask 077
mkdir -p "$OUT_DIR/objects" "$OUT_DIR/manifests"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MANIFEST="$OUT_DIR/manifests/$STAMP.tsv"

echo "==> Listing s3://$BUCKET/$PREFIX"
# The CLI pages through list-objects-v2 itself. ETags come quoted; strip them.
aws s3api list-objects-v2 --region "$REGION" --bucket "$BUCKET" --prefix "$PREFIX" \
  --query 'Contents[].[Key,Size,ETag,LastModified]' --output text \
  | sed 's/"//g' | grep -v '^None$' >"$MANIFEST.partial" || true
COUNT="$(wc -l <"$MANIFEST.partial" | tr -d ' ')"
if [ "$COUNT" -eq 0 ]; then
  rm -f "$MANIFEST.partial"
  echo "No objects under s3://$BUCKET/$PREFIX — refusing to write an empty manifest." >&2
  exit 1
fi
BYTES="$(awk -F'\t' '{s+=$2} END {print s}' "$MANIFEST.partial")"
echo "    $COUNT objects, $((BYTES / 1024 / 1024)) MB"

echo "==> Syncing into $OUT_DIR/objects/"
# No --delete, deliberately: see the header.
aws s3 sync --region "$REGION" --only-show-errors \
  "s3://$BUCKET/$PREFIX" "$OUT_DIR/objects/$PREFIX"

echo "==> Verifying against the manifest"
bad=0
while IFS=$'\t' read -r key size etag _; do
  file="$OUT_DIR/objects/$key"
  if [ ! -f "$file" ]; then
    echo "    missing: $key" >&2; bad=$((bad + 1)); continue
  fi
  if [ "$(wc -c <"$file" | tr -d ' ')" != "$size" ]; then
    echo "    wrong size: $key" >&2; bad=$((bad + 1)); continue
  fi
  # A multipart ETag ("<md5>-<parts>") is not the file's MD5; size is all we have.
  if [[ "$etag" != *-* ]] && [ "$(md5_of "$file")" != "$etag" ]; then
    echo "    checksum mismatch: $key" >&2; bad=$((bad + 1))
  fi
done <"$MANIFEST.partial"

if [ "$bad" -ne 0 ]; then
  echo "$bad of $COUNT objects failed verification; manifest left at $MANIFEST.partial." >&2
  echo "Re-run to retry — the sync only fetches what is missing or changed." >&2
  exit 1
fi
# Only a verified manifest gets its final name, so restore never picks a bad one.
mv "$MANIFEST.partial" "$MANIFEST"

KEPT="$(find "$OUT_DIR/objects" -type f | wc -l | tr -d ' ')"
echo
echo "Done: $COUNT objects verified, manifest $MANIFEST"
[ "$KEPT" -gt "$COUNT" ] && echo "  ($((KEPT - COUNT)) more kept from earlier runs that are no longer in the bucket)"
echo "  Restore with: ./scripts/restore-photos.sh --manifest \"$MANIFEST\" --dry-run"
