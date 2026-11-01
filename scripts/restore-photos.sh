#!/usr/bin/env bash
#
# Puts photos from a scripts/backup-photos.sh backup back into the photo bucket.
#
#   ./scripts/restore-photos.sh --dry-run                   # what it would upload
#   ./scripts/restore-photos.sh                             # upload what is missing
#   ./scripts/restore-photos.sh --manifest <file.tsv>       # only that run's keys
#   ./scripts/restore-photos.sh --overwrite                 # replace differing ones too
#
# By default it restores only keys that are **missing** from the bucket, and
# never touches an object that is there. That is the safe direction: a photo
# in the bucket is either the same one, or a newer upload the database now
# points at, and overwriting it would put the old picture back under the new
# key. --overwrite replaces objects whose size or checksum differ from the
# backup; use it only after a restore of the database to the same moment.
#
# Without --manifest it uses the newest manifest in the backup, so it restores
# the bucket as that run last saw it — not every photo ever backed up, which
# would resurrect ones deliberately deleted since. It never deletes anything.
#
# Objects are written as the app writes them: Content-Type image/jpeg,
# SSE-S3 encryption, no other metadata.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="${REGION:-us-east-1}"
BUCKET="${FILE_BUCKET_NAME:-classyear-file-storage-372666940943-dev}"
FROM="$REPO_ROOT/tmp/backups/photos"
MANIFEST=""
DRY_RUN=false
OVERWRITE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:?--from needs the backup directory}"; shift 2 ;;
    --manifest) MANIFEST="${2:?--manifest needs a .tsv file}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --overwrite) OVERWRITE=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$MANIFEST" ]; then
  MANIFEST="$(ls "$FROM"/manifests/*.tsv 2>/dev/null | sort | tail -1 || true)"
  [ -n "$MANIFEST" ] || { echo "No manifests in $FROM/manifests — has backup-photos.sh run?" >&2; exit 1; }
fi
[ -f "$MANIFEST" ] || { echo "No such manifest: $MANIFEST" >&2; exit 1; }

echo "==> Restoring to s3://$BUCKET from $(basename "$MANIFEST")"

# One listing of the bucket up front, rather than a HEAD per key.
CURRENT="$(mktemp -t restore-photos)"
trap 'rm -f "$CURRENT"' EXIT
aws s3api list-objects-v2 --region "$REGION" --bucket "$BUCKET" --prefix photos/ \
  --query 'Contents[].[Key,Size,ETag]' --output text | sed 's/"//g' | grep -v '^None$' >"$CURRENT" || true

missing=0 differ=0 same=0 uploaded=0 absent=0
# fd 3, so nothing inside the loop can read the manifest out from under it.
while IFS=$'\t' read -r key size etag _ <&3; do
  file="$FROM/objects/$key"
  if [ ! -f "$file" ]; then
    echo "    not in the backup, skipped: $key" >&2; absent=$((absent + 1)); continue
  fi
  live="$(awk -F'\t' -v k="$key" '$1 == k {print $2 "\t" $3; exit}' "$CURRENT")"
  if [ -z "$live" ]; then
    action=missing; missing=$((missing + 1))
  elif [ "$live" = "$size"$'\t'"$etag" ]; then
    same=$((same + 1)); continue
  else
    differ=$((differ + 1))
    $OVERWRITE || continue
    action=differs
  fi

  if $DRY_RUN; then
    echo "    would upload ($action): $key"
  else
    aws s3 cp --region "$REGION" --only-show-errors \
      --content-type image/jpeg --sse AES256 \
      "$file" "s3://$BUCKET/$key" </dev/null
    echo "    uploaded ($action): $key"
    uploaded=$((uploaded + 1))
  fi
done 3<"$MANIFEST"

echo
echo "In the bucket already and identical: $same"
echo "Missing from the bucket:             $missing"
if $OVERWRITE; then
  echo "Differing from the backup:           $differ"
else
  echo "Differing from the backup:           $differ (left alone; --overwrite to replace)"
fi
[ "$absent" -gt 0 ] && echo "In the manifest but not the backup:  $absent (see above)"
if $DRY_RUN; then
  echo "Dry run: nothing was uploaded."
else
  echo "Uploaded:                            $uploaded"
fi
