#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

python3 tests/validate.py

for file in rootfs/opt/ha-opendesign/*.js rootfs/opt/ha-opendesign/*.mjs tests/*.mjs; do
  node --check "$file"
done

bash -n rootfs/usr/local/bin/ha-opendesign tests/run.sh
node --test tests/*.test.mjs

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck rootfs/usr/local/bin/ha-opendesign tests/run.sh
else
  echo "shellcheck: SKIP (not installed)"
fi

if command -v nginx >/dev/null 2>&1; then
  mkdir -p /tmp/ha-opendesign-nginx/{client,proxy,fastcgi,uwsgi,scgi}
  nginx -t -c "$PWD/rootfs/etc/nginx/nginx.conf"
else
  echo "nginx -t: SKIP (not installed)"
fi

echo "all non-container validation passed"
