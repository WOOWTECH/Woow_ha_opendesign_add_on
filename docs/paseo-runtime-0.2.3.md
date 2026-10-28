# Paseo runtime 0.2.3 in HA add-on 0.2.10

The runtime input is the public [v0.2.3 release](https://github.com/WOOWTECH/opendesign-paseo-plugin/releases/tag/v0.2.3), from merged commit `56fcee82d610b56d5263e88cff04f9ece602a9ef`. The `package.tgz` SHA-256 is `d251711d19215e03a13334319207f602c5d23c27f74dffa5a8d0003351ad4ab3`; the separately retained `package-lock.json` SHA-256 is `e38a02053d4237e2af12c0dafd60627d0a748fead4d03c5d14a7ea6578868a39`. All 75 archive members were compared byte-for-byte with the merged source, and the release assets were downloaded anonymously and checked after publication. `paseo-runtime/install.sh` verifies the two input hashes before installation.

This update creates the provider home directories when the runtime context is built (fresh PaaS volumes had no `.codex`, so the Codex login failed and its model list answered 503; this add-on's start script already creates them) and refreshes a provider model catalog once when it was cached empty or failed (Pi after its login, a provider that could not start). The HA wrapper, core digest, architecture, network ports, backup rules and `/data` layout stay the same. Upgrading from 0.2.9 or an earlier 0.2.10 candidate needs no migration. A new or expired provider login still requires the user to complete the provider's official authorization flow.

Release gates before merging, in addition to the 0.2.10 gates in `CHANGELOG.md`:

1. Run `./tests/run.sh` and pass the required PR checks, including image and browser smoke.
2. Build an immutable candidate from this branch with the existing `build.yml` candidate workflow and the w2.10 core digest. Confirm its source, runtime, image digest and container smoke receipt.
3. On the dedicated HAOS test instance, update the previous 0.2.10 candidate to this one with the canonical add-on repository entry. Verify the plugin card and setup page, Paseo running with runtime 0.11.2, the model lists of the three engines, stop/start, and that provider logins persist across the update.
4. Merge only after the candidate and HAOS evidence are reviewed; the version bump publishes through the repository's normal Store workflow.

Earlier gates: [0.2.2 runtime in 0.2.9](paseo-runtime-0.2.2.md), [0.2.7](paseo-release.md).
