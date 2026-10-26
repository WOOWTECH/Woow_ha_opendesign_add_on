# Omnigent release-channel validation (2026-10-26)

This records the additional source checks after the packaging patch. It is not image or production acceptance.

- `tests/run.sh`: 71 Node cases, 27 existing MCP unit cases, 5 provider-fixture cases and 26 import-core checks passed; pin-core passed.
- Pinned shellcheck 0.11.0 was run separately against every script in `tests/run.sh`; passed after fixing an unused smoke-loop variable.
- Actual nginx `-t` passed with a read-only nginx rootfs and an isolated generated configuration. This checks syntax, not Supervisor routing.
- Native host shutdown budget: launcher 35 seconds, outer Supervisor/Docker deadline 45 seconds. The core must implement the corresponding bounded daemon cleanup.
- Authenticated smoke now requires private local provider files in addition to Omnigent credentials; legacy Omnigent state and symlinks are rejected before container creation. No live credentials were committed.

## Remaining release gates

The core pin and version remain at the released 0.2.6 baseline until the final Omnigent core is built and approved. Reconcile the independent Paseo 0.2.7 release before choosing the next stable version. Run a real candidate build, fresh login, four-engine replies/stops, disable/re-enable, restart, cold restore and actual HA Supervisor/Ingress acceptance. Only then publish and verify Store/Local Download notifications and identical source/image digests.
