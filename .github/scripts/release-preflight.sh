#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

if [[ "${GITHUB_REF_TYPE:-}" != "tag" ]]; then
  echo "Release preflight may only run for a tag ref" >&2
  exit 1
fi

version=$(awk -F'"' '/^version:/ { print $2 }' config.yaml)
expected="v${version}"
if [[ -z "$version" || "${GITHUB_REF_NAME:-}" != "$expected" ]]; then
  echo "Release tag ${GITHUB_REF_NAME:-<unset>} does not match config.yaml version ${expected}" >&2
  exit 1
fi

registry_api=${GHCR_REGISTRY_API:-https://ghcr.io}
token_api=${GHCR_TOKEN_API:-https://ghcr.io/token}
token_service=${GHCR_TOKEN_SERVICE:-ghcr.io}
if [[ -z "${GHCR_ACTOR:-}" || -z "${GHCR_TOKEN:-}" ]]; then
  echo "GHCR read credentials are required; refusing to publish" >&2
  exit 1
fi
accept='application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json'

for arch in amd64 aarch64; do
  repository="woowtech/woow-ha-opendesign-${arch}"
  if ! token_json=$(curl --fail --silent --show-error --location --get \
    --user "${GHCR_ACTOR}:${GHCR_TOKEN}" \
    --data-urlencode "service=${token_service}" \
    --data-urlencode "scope=repository:${repository}:pull" \
    "$token_api"); then
    echo "Unable to obtain a registry token for ${repository}; refusing to publish" >&2
    exit 1
  fi
  if ! token=$(python3 -c 'import json,sys; body=json.load(sys.stdin); value=body.get("token") or body.get("access_token"); assert value; print(value)' <<<"$token_json"); then
    echo "Registry returned no usable token for ${repository}; refusing to publish" >&2
    exit 1
  fi
  if ! status=$(curl --silent --show-error --location --output /dev/null --write-out '%{http_code}' \
    --request HEAD \
    --header "Authorization: Bearer ${token}" \
    --header "Accept: ${accept}" \
    "${registry_api}/v2/${repository}/manifests/${version}"); then
    echo "Unable to query ${repository}:${version}; refusing to publish" >&2
    exit 1
  fi
  case "$status" in
    404)
      echo "Release target is unused: ghcr.io/${repository}:${version}"
      ;;
    200)
      echo "Release target already exists and is immutable: ghcr.io/${repository}:${version}" >&2
      exit 1
      ;;
    *)
      echo "Registry returned HTTP ${status} for ${repository}:${version}; refusing to publish" >&2
      exit 1
      ;;
  esac
done
