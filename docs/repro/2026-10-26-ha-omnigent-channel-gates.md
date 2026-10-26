# Omnigent release-channel validation (2026-10-26)

This records the additional source checks after the packaging patch. It is not image or production acceptance.

- `tests/run.sh`: 71 Node cases, 27 existing MCP unit cases, 5 provider-fixture cases and 26 import-core checks passed; pin-core passed.
- Pinned shellcheck 0.11.0 was run separately against every script in `tests/run.sh`; passed after fixing an unused smoke-loop variable.
- Actual nginx `-t` passed with a read-only nginx rootfs and an isolated generated configuration. This checks syntax, not Supervisor routing.
- Native host shutdown budget: launcher 35 seconds, outer Supervisor/Docker deadline 45 seconds. The core must implement the corresponding bounded daemon cleanup.
- Authenticated smoke now requires private local provider files in addition to Omnigent credentials; legacy Omnigent state and symlinks are rejected before container creation. No live credentials were committed.

## Merged source validation

The feature branch now incorporates released HA 0.2.7 (`557f144e9e6b221687ff09833d57593a43c8b7ea`) and reserves candidate version 0.2.8. The merged suite passed 83 Node tests and the existing MCP/import checks. Real nginx ingress/startup checks passed with the pinned nginx executable. The subsequent OpenCode restore extension passed nine credential-permission cases; its cross-UID container proof remains part of image smoke.

## Remaining release gates

The approved w2.7 core is pinned as `20261026.1751` (`sha256:14601a0b…`) and is publicly readable. Its native build passed the mandatory installed-SDK suite. The branch-only HA candidate workflow must publish an exact-source image and pass container smoke. Then verify actual HA upgrade, fresh GUI login, four-engine replies/stops, disable/re-enable, restart and cold restore. Provider credential transfer requires explicit authorization for the target test environment. Before the stable PR merges, check its own container and Ingress tests. Finally verify Store/Local Download notifications and matching source/image/catalog receipts. Source checks alone do not satisfy these gates.
