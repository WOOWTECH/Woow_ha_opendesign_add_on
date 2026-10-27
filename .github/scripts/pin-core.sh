#!/usr/bin/env bash
# Re-pin the WoowTech OpenDesign core image everywhere the add-on names it.
#
#   .github/scripts/pin-core.sh <tag YYYYMMDD.HHMM> <sha256:digest>
#
# A review branch may stage a verified approved digest before the public copy
# exists. Before merging a version bump, the public GHCR tag must resolve to
# that exact digest and the image/HAOS acceptance gates must pass. This script
# rewrites the current pin (read from the Dockerfile) in:
# Dockerfile (BUILD_FROM), build.yaml (tag only: Supervisor's local builder rejects digests),
# .github/workflows/build.yml (CORE_IMAGE), tests/validate.py and tests/core-base.test.mjs, then
# checks that no file still names the old pin. Review the core contract ARGs in the Dockerfile
# (CLI versions) separately, then run tests/run.sh and the container smoke.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

tag=${1:-}
digest=${2:-}
[[ "$tag" =~ ^[0-9]{8}\.[0-9]{4}$ ]] || { echo "tag must be YYYYMMDD.HHMM, got '$tag'" >&2; exit 64; }
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "digest must be sha256:<64 hex>, got '$digest'" >&2; exit 64; }

repo=ghcr.io/woowtech/open-design-core
current=$(sed -n "s#^ARG BUILD_FROM=${repo}:\([0-9.]*\)@\(sha256:[0-9a-f]*\)\$#\1 \2#p" Dockerfile)
read -r old_tag old_digest <<<"$current"
[[ -n "${old_tag:-}" && -n "${old_digest:-}" ]] || { echo "no current core pin in Dockerfile" >&2; exit 65; }

files=(Dockerfile build.yaml .github/workflows/build.yml tests/validate.py tests/core-base.test.mjs)
for file in "${files[@]}"; do
  grep -qF "${repo}:${old_tag}" "$file" || { echo "$file does not name the current pin" >&2; exit 65; }
done
for file in "${files[@]}"; do
  sed -i -e "s#${repo}:${old_tag}@${old_digest}#${repo}:${tag}@${digest}#g" \
    -e "s#${repo}:${old_tag}\\b#${repo}:${tag}#g" "$file"
done
stale=()
[[ "$old_digest" == "$digest" ]] || stale+=(-e "$old_digest")
[[ "$old_tag" == "$tag" ]] || stale+=(-e "${repo}:${old_tag}")
if (( ${#stale[@]} )) && grep -nF "${stale[@]}" "${files[@]}"; then
  echo "old pin still present" >&2
  exit 1
fi
for file in "${files[@]}"; do
  grep -qF "${repo}:${tag}" "$file" || { echo "$file does not name the new pin" >&2; exit 1; }
done
echo "core pinned to ${repo}:${tag}@${digest} (was ${old_tag})"
