#!/usr/bin/env bash
set -Eeuo pipefail

image=${1:-woow-ha-opendesign:test}
container="woow-od-smoke-${RANDOM}"
volume="woow-od-data-${RANDOM}"
port=${SMOKE_PORT:-18099}
tmp=$(mktemp -d)

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

docker volume create "$volume" >/dev/null

start_container() {
  docker run -d --platform linux/amd64 --name "$container" \
    -p "127.0.0.1:${port}:8099" \
    -v "$volume:/data" \
    "$image" >/dev/null
}

wait_for_health() {
  local attempt
  for ((attempt = 1; attempt <= 90; attempt += 1)); do
    if curl -fsS "http://127.0.0.1:${port}/api/health" >"$tmp/health.json"; then
      return 0
    fi
    if ! docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -qx true; then
      docker logs "$container" >&2 || true
      return 1
    fi
    sleep 1
  done
  docker logs "$container" >&2 || true
  echo 'health endpoint did not become ready' >&2
  return 1
}

start_container
wait_for_health
python3 - "$tmp/health.json" <<'PY'
import json
import sys
assert json.load(open(sys.argv[1], encoding='utf-8')).get('ok') is True
PY

docker exec "$container" sh -ceu '
  test "$(id -u)" = 1001
  test "$(id -g)" = 1001
  test -d /data/opendesign
  test -w /data/opendesign
  test -r /app/apps/daemon/dist/cli.js
  test -d /app/apps/web/out
  test -x /usr/bin/chromium-browser
  test -r /opt/ha-opendesign/headless-entry.mjs
  test -r /opt/ha-opendesign/headless-renderer.mjs
  test -r /opt/ha-opendesign/ha-export-bridge.js
  for executable in claude codex opencode aider gemini cursor-agent qwen copilot amp; do
    if command -v "$executable" >/dev/null 2>&1 \
      || test -e "/app/node_modules/.bin/$executable" \
      || test -e "/usr/local/lib/node_modules/.bin/$executable"; then
      echo "forbidden local AI CLI present: $executable" >&2
      exit 1
    fi
  done
  printf persisted > /data/opendesign/container-smoke-sentinel
'

# Stop/recreate the container while retaining only its named /data volume.
docker stop -t 10 "$container" >/dev/null
docker rm "$container" >/dev/null
start_container
wait_for_health
python3 - "$tmp/health.json" <<'PY'
import json
import sys
assert json.load(open(sys.argv[1], encoding='utf-8')).get('ok') is True
PY
docker exec "$container" grep -qx persisted /data/opendesign/container-smoke-sentinel

# Direct renderer acceptance uses the Chromium and playwright-core installed in
# the image. It requires no provider key or generation call.
docker cp tests/container-renderer-e2e.mjs "$container:/tmp/container-renderer-e2e.mjs"
docker exec "$container" node /tmp/container-renderer-e2e.mjs

# Create only daemon metadata over HTTP, then seed deterministic fixture HTML in
# that project's persistent directory. No BYOK call is involved.
curl --fail-with-body -sS -o "$tmp/project.json" \
  -H 'content-type: application/json' \
  --data '{"id":"ha-smoke","name":"HA smoke","skipDiscoveryBrief":true}' \
  "http://127.0.0.1:${port}/api/projects"
docker exec -i "$container" sh -c 'cat > /data/opendesign/projects/ha-smoke/deck.html' <<'HTML'
<!doctype html><html><head><style>
html,body{margin:0;background:#fff}.slide{width:640px;height:360px;display:block;color:#fff;font:32px sans-serif}
.slide:first-of-type{background:#165dba}.slide:last-of-type{background:#a33}
</style></head><body><section class="slide">Slide one</section><section class="slide">Slide two</section></body></html>
HTML

post_export() {
  local endpoint=$1 body=$2 output=$3
  curl --fail-with-body -sS -o "$output" \
    -H 'content-type: application/json' --data "$body" \
    "http://127.0.0.1:${port}/api/projects/ha-smoke/export/${endpoint}"
  test -s "$output"
}

post_export image '{"fileName":"deck.html","deck":true,"imageFormat":"png"}' "$tmp/deck.png"
post_export image '{"fileName":"deck.html","deck":true,"imageFormat":"jpeg"}' "$tmp/deck.jpg"
post_export pdf-image '{"fileName":"deck.html","deck":true,"title":"Smoke"}' "$tmp/deck.pdf"
post_export pptx '{"fileName":"deck.html","deck":true,"title":"Smoke"}' "$tmp/deck.pptx"

python3 - "$tmp/deck.png" "$tmp/deck.jpg" "$tmp/deck.pdf" "$tmp/deck.pptx" <<'PY'
from pathlib import Path
import sys
png, jpg, pdf, pptx = map(Path, sys.argv[1:])
assert png.stat().st_size > 100 and png.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
assert jpg.stat().st_size > 100 and jpg.read_bytes().startswith(b'\xff\xd8\xff')
assert pdf.stat().st_size > 100 and pdf.read_bytes().startswith(b'%PDF-')
assert pptx.stat().st_size > 100 and pptx.read_bytes().startswith(b'PK')
print('HTTP exports: non-empty PNG, JPEG, screenshot PDF, screenshot PPTX')
PY

editable_status=$(curl -sS -o "$tmp/editable.json" -w '%{http_code}' \
  -H 'content-type: application/json' \
  --data '{"fileName":"deck.html","deck":true,"editable":true}' \
  "http://127.0.0.1:${port}/api/projects/ha-smoke/export/pptx")
test "$editable_status" = 502
grep -qi 'Editable PPTX is unsupported' "$tmp/editable.json"

# The seeded project and DB record remain after the earlier restart; this export
# set proves renderer/assembly operation without needing an AI provider key.
echo 'container smoke: health, UID/paths, CLI absence, persistence, renderer, and HTTP assembly passed'
