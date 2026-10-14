#!/usr/bin/env bash
# Copy one approved open-design-core image from WoowTech JCR to the public GHCR package,
# byte for byte (same manifest digest), under immutable tags.
#
# The core is built and approved once in woow-paas/paas-odoo-ci
# (build-open-design-image.yml: /approve promotes woow-paas-docker-local/open-design-core:<tag>).
# HA Supervisor local builds cannot pull by digest, so the add-on needs a fixed tag; this
# script publishes that tag only when it points at exactly the approved digest.
#
# Inputs (environment):
#   CORE_TAG        approved JCR tag, YYYYMMDD.HHMM; also the GHCR tag
#   CORE_DIGEST     sha256:<64 hex> of that tag in JCR
#   CORE_ALIAS_TAG  optional second immutable GHCR tag, e.g. 0.24.1-w3
#   REGISTRY_AUTH_FILE  skopeo auth file already logged in to both registries
#   SRC_IMAGE       default jcr-prod.woowtech.io/woow-paas-docker-local/open-design-core
#   DEST_IMAGE      default ghcr.io/woowtech/open-design-core
#   SKOPEO / CURL   commands (tests replace them)
#   GHCR_TOKEN_API / GHCR_REGISTRY_API  anonymous pull check endpoints
set -Eeuo pipefail

SRC_IMAGE=${SRC_IMAGE:-jcr-prod.woowtech.io/woow-paas-docker-local/open-design-core}
DEST_IMAGE=${DEST_IMAGE:-ghcr.io/woowtech/open-design-core}
SKOPEO=${SKOPEO:-skopeo}
CURL=${CURL:-curl}
GHCR_TOKEN_API=${GHCR_TOKEN_API:-https://ghcr.io/token}
GHCR_REGISTRY_API=${GHCR_REGISTRY_API:-https://ghcr.io}
WORK=${IMPORT_WORK_DIR:-$(mktemp -d)}
SUMMARY=${GITHUB_STEP_SUMMARY:-/dev/null}

fail() { echo "::error::$*" >&2; exit 1; }
sha_of() { echo "sha256:$(sha256sum "$1" | cut -d' ' -f1)"; }

CORE_TAG=${CORE_TAG:-}
CORE_DIGEST=${CORE_DIGEST:-}
CORE_ALIAS_TAG=${CORE_ALIAS_TAG:-}
[[ "$CORE_TAG" =~ ^[0-9]{8}\.[0-9]{4}$ ]] \
  || fail "tag must be an approved JCR tag YYYYMMDD.HHMM (candidate *-pending-approval tags are refused), got '${CORE_TAG}'"
[[ "$CORE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "digest must be sha256:<64 hex>, got '${CORE_DIGEST}'"
if [[ -n "$CORE_ALIAS_TAG" && ! "$CORE_ALIAS_TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+-w[0-9]+$ ]]; then
  fail "alias tag must look like 0.24.1-w3, got '${CORE_ALIAS_TAG}'"
fi
[[ "${DEST_IMAGE}" == ghcr.io/* ]] || fail "destination must be on ghcr.io"
DEST_REPO=${DEST_IMAGE#ghcr.io/}

echo "::group::Source: ${SRC_IMAGE}:${CORE_TAG} @ ${CORE_DIGEST}"
# By digest: the registry must return exactly the bytes that hash to the input.
"$SKOPEO" inspect --raw "docker://${SRC_IMAGE}@${CORE_DIGEST}" > "$WORK/src.json" \
  || fail "cannot read ${SRC_IMAGE}@${CORE_DIGEST} (credentials, network or unknown digest)"
[ "$(sha_of "$WORK/src.json")" = "$CORE_DIGEST" ] || fail "JCR returned a manifest that does not hash to ${CORE_DIGEST}"
media=$(jq -r '.mediaType // empty' "$WORK/src.json")
case "$media" in
  application/vnd.oci.image.manifest.v1+json | application/vnd.docker.distribution.manifest.v2+json) ;;
  *) fail "expected a single-platform image manifest (core is amd64 only), got mediaType '${media:-none}'" ;;
esac
# The approved tag must still point at that digest (approval promotes tag and digest together).
"$SKOPEO" inspect --raw "docker://${SRC_IMAGE}:${CORE_TAG}" > "$WORK/src-tag.json" \
  || fail "cannot read ${SRC_IMAGE}:${CORE_TAG}; only approved (promoted) tags can be imported"
[ "$(sha_of "$WORK/src-tag.json")" = "$CORE_DIGEST" ] \
  || fail "${SRC_IMAGE}:${CORE_TAG} is $(sha_of "$WORK/src-tag.json"), not ${CORE_DIGEST}"
"$SKOPEO" inspect --config "docker://${SRC_IMAGE}@${CORE_DIGEST}" > "$WORK/config.json" \
  || fail "cannot read the image config"
platform=$(jq -r '"\(.architecture)/\(.os)"' "$WORK/config.json")
[ "$platform" = "amd64/linux" ] || fail "core must be amd64/linux, got ${platform}"
src_rev=$(jq -r '.config.Labels["io.woow.opendesign.source-revision"] // empty' "$WORK/config.json")
up_rev=$(jq -r '.config.Labels["io.woow.opendesign.upstream-revision"] // empty' "$WORK/config.json")
[[ "$src_rev" =~ ^[0-9a-f]{40}$ && "$up_rev" =~ ^[0-9a-f]{40}$ ]] \
  || fail "image lacks the io.woow.opendesign.source-revision / upstream-revision labels; not an open-design-core build"
echo "platform=${platform} fork=${src_rev} upstream=${up_rev}"
echo "::endgroup::"

tags=("$CORE_TAG")
[ -n "$CORE_ALIAS_TAG" ] && tags+=("$CORE_ALIAS_TAG")

# Destination tags are immutable: absent -> copy; present with the same digest -> nothing
# to do (a re-run after making the package public only verifies); any other digest -> stop.
to_copy=()
for t in "${tags[@]}"; do
  if "$SKOPEO" inspect --raw "docker://${DEST_IMAGE}:${t}" > "$WORK/dest.json" 2> "$WORK/dest.err"; then
    have=$(sha_of "$WORK/dest.json")
    [ "$have" = "$CORE_DIGEST" ] || fail "${DEST_IMAGE}:${t} already exists as ${have}; tags are immutable, use a new tag"
    echo "${DEST_IMAGE}:${t} already is ${CORE_DIGEST} (idempotent re-run)"
  elif grep -qiE 'manifest unknown|name unknown|not found|denied|unauthorized' "$WORK/dest.err"; then
    # GHCR answers "denied" for a package that does not exist yet; a token that may write
    # the package can always read it, so this cannot hide an existing tag we may overwrite.
    to_copy+=("$t")
  else
    cat "$WORK/dest.err" >&2
    fail "cannot query ${DEST_IMAGE}:${t}; refusing to publish"
  fi
done

for t in "${to_copy[@]}"; do
  echo "::group::Copy ${SRC_IMAGE}@${CORE_DIGEST} -> ${DEST_IMAGE}:${t}"
  "$SKOPEO" copy --preserve-digests --retry-times 5 \
    "docker://${SRC_IMAGE}@${CORE_DIGEST}" "docker://${DEST_IMAGE}:${t}" \
    || fail "copy to ${DEST_IMAGE}:${t} failed"
  echo "::endgroup::"
done

# Same digest through the authenticated path, for every tag and for the digest itself.
for ref in "${tags[@]/#/:}" "@${CORE_DIGEST}"; do
  "$SKOPEO" inspect --raw "docker://${DEST_IMAGE}${ref}" > "$WORK/check.json" || fail "cannot read back ${DEST_IMAGE}${ref}"
  [ "$(sha_of "$WORK/check.json")" = "$CORE_DIGEST" ] || fail "${DEST_IMAGE}${ref} is $(sha_of "$WORK/check.json"), expected ${CORE_DIGEST}"
done
echo "GHCR (authenticated): ${tags[*]} -> ${CORE_DIGEST}"

# Home Assistant pulls anonymously: the package must be public.
anonymous_ok=1
if token_json=$("$CURL" --fail --silent --show-error --get \
    --data-urlencode "service=ghcr.io" --data-urlencode "scope=repository:${DEST_REPO}:pull" \
    "$GHCR_TOKEN_API" 2> "$WORK/anon.err"); then
  token=$(jq -r '.token // .access_token // empty' <<<"$token_json")
else
  token=""
fi
accept='application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'
for t in "${tags[@]}"; do
  status=000
  if [ -n "$token" ]; then
    status=$("$CURL" --silent --show-error --output "$WORK/anon.json" --write-out '%{http_code}' --request GET \
      --header "Authorization: Bearer ${token}" --header "Accept: ${accept}" \
      "${GHCR_REGISTRY_API}/v2/${DEST_REPO}/manifests/${t}") || status=000
  fi
  if [ "$status" = 200 ] && [ "$(sha_of "$WORK/anon.json")" = "$CORE_DIGEST" ]; then
    echo "GHCR (anonymous): ${DEST_IMAGE}:${t} -> ${CORE_DIGEST}"
  else
    anonymous_ok=0
    echo "::error::anonymous pull of ${DEST_IMAGE}:${t} failed (HTTP ${status}). The image is published but not public yet: an organization owner must set the package visibility to Public (https://github.com/orgs/WOOWTECH/packages/container/package/${DEST_REPO#*/}), then re-run this workflow with the same inputs to verify."
  fi
done

{
  echo "### open-design-core imported"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| Source | \`${SRC_IMAGE}:${CORE_TAG}\` |"
  echo "| Digest | \`${CORE_DIGEST}\` |"
  echo "| Fork / upstream | \`${src_rev}\` / \`${up_rev}\` |"
  for t in "${tags[@]}"; do echo "| GHCR | \`${DEST_IMAGE}:${t}\` |"; done
  echo "| Anonymous pull | $([ "$anonymous_ok" = 1 ] && echo OK || echo 'FAILED: set the package to Public, then re-run') |"
  echo
  echo "Add-on Dockerfile: \`BUILD_FROM=${DEST_IMAGE}:${CORE_TAG}@${CORE_DIGEST}\`; build.yaml: \`${DEST_IMAGE}:${CORE_TAG}\`."
} >> "$SUMMARY"

[ "$anonymous_ok" = 1 ] || exit 1
echo "done: ${DEST_IMAGE}:${CORE_TAG} = ${CORE_DIGEST}"
