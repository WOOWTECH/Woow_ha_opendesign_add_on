# Agent Connect runtime 0.3.0 in HA add-on 0.2.16

The runtime input is the public [v0.3.0 release](https://github.com/WOOWTECH/opendesign-paseo-plugin/releases/tag/v0.3.0), from merged commit `fa9e28bc785f11f24563b2740c3ae65f42d65210` (PR #12; its tree is identical to the reviewed head `1dfdb62d70fe00f7e978c027c1dc42593ce184f9`). The `package.tgz` SHA-256 is `eba98a0115e704fa71e8d550a73e621e5cbf86e2734dabea847c051c9b728eff`; the separately retained `package-lock.json` is `9d541fd0ef7c33431c3e32950a538f610e4481e822bb074f3ca3a4ff1eebc2e2`. Both are listed in the release's `SHA256SUMS` and checked against `paseo-runtime/checksums.sha256` before anything is extracted.

This update moves the managed Paseo daemon from 0.11.2 to the official 0.17.5 and renames the plugin card, setup page and guide to Agent Connect (plugin id, path and provider homes unchanged). The runtime is built into the image: `scripts/prepare-managed-runtime.mjs` installs the locked packages, rebuilds `node-pty` for musl and requires a real PTY spawn before it writes the ready receipt. `install.sh` makes that root-owned runtime readable and executable for UID 1001 without making it writable, and installs the release's native launcher card files next to the native plugin so the byte-for-byte launcher check passes.

Release gates before merging:

1. Run `./tests/run.sh` and pass the required PR checks, including the container and browser smoke, the offline managed-runtime smoke, and `Upgrade comparison / compare` with its upgrade test against the latest Stable Release (0.2.15).
2. Build an immutable candidate from this branch with the existing `build.yml` candidate workflow and the w2.11 core digest. Confirm its source, runtime, image digest and container smoke receipt.
3. On the dedicated HAOS test instance, update the installed 0.2.15 to this candidate with the canonical add-on repository entry. Verify the plugin card (title Agent Connect, version 0.3.0) and the setup page, the daemon running with runtime 0.17.5, the model lists of the three engines, stop/start, that a stopped service stays stopped after the add-on restarts, and the pairing links of the three client targets.
4. Merge only after the candidate and HAOS evidence are reviewed; the version bump publishes through the repository's normal Store workflow. Verify the published image digest, Release and Store catalog afterwards.

Rolling back to 0.2.15 after using the Devices page of Paseo 0.17.5 (extra listeners) needs the manual steps in the plugin's Agent Connect guide (`docs/agent-connect.md`, section 升級與回復).

Earlier gates: [0.2.3 runtime in 0.2.11](paseo-runtime-0.2.3.md), [0.2.2 runtime in 0.2.9](paseo-runtime-0.2.2.md), [0.2.7](paseo-release.md).
