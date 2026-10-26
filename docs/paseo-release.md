# Paseo 0.2.7 release gate

This branch is based on remote HA main a296fffc (0.2.6). It prepares 0.2.7;
it does not establish a published or live-tested release. Merge publishes this
version through the existing Store workflow, so main integration review and the
actual shared-core immutable digest are prerequisites.

`paseo-runtime/VENDOR.json` records runtime 0.2.1 at commit
`21af10e178c00a4b4f3608f87321f200c410915a`, the same source/package used by the PaaS
wrapper. The checked-in npm archive and separately copied package-lock.json have
SHA-256 checksums. `install.sh` verifies them and runs npm ci with lifecycle
scripts disabled. It then compares the bundled native launcher byte-for-byte
and requires native MCP CAS route artifacts. Nothing is copied into native core
sources. A pre-Paseo core must fail this installation.

To regenerate: check out the reviewed runtime commit, run `npm pack --json`, copy
that archive and its source `package-lock.json`, and update both recorded hashes
and source commit. Run the runtime suite and archive check before accepting a
new pin. Keep PaaS and HA pins synchronized.

After main supplies the genuinely published public core tag and digest, run
`.github/scripts/pin-core.sh TAG sha256:DIGEST`; review CLI version contracts and
remove the pending-core wording in Dockerfile/CHANGELOG. Never replace the pin
with a placeholder or claim an image build from local static checks.

Validation:

- `tests/run.sh`: package integrity, metadata, lifecycle, ingress shim, existing
  renderer/export/MCP checks; with nginx installed it also runs the real local
  nginx-to-Unix bridge fixture (`tests/paseo-ingress-e2e.sh`).
- `tests/container-smoke.sh IMAGE`: existing export, CLI, MCP, persistence smoke
  plus native launcher/CAS and bridge packaging checks. Requires the new core.
- Main/environment owner: normal HA 0.2.6 → 0.2.7 upgrade and fresh install,
  native launcher click/new tab, login/pairing, target-local model conversation,
  manual stop/start, restart/backup persistence, forged-header/origin rejection.

The local nginx fixture substitutes a loopback peer for Supervisor only within
its temporary configuration; the shipped config continues to allow only
172.30.32.2. It does not mutate a real HA host or claim real HA acceptance.

Trust references: [HA Core ingress forwarding](https://github.com/home-assistant/core/blob/dev/homeassistant/components/hassio/ingress.py)
and [Supervisor authenticated user forwarding](https://github.com/home-assistant/supervisor/blob/main/supervisor/api/ingress.py).
Forwarded host/proto are deliberately not accepted as browser-origin authority.
