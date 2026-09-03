# Changelog

## 0.1.0

- Initial standalone Home Assistant add-on for pinned OpenDesign 0.21.1.
- Add amd64/aarch64 Ingress-only metadata, cold backup, sidebar entry, and watchdog.
- Persist daemon state at `/data/opendesign`; keep provider credentials browser-local.
- Add unprivileged nginx ingress adaptation for static paths, API requests, SSE, WebSocket, history, workers, and dynamic assets.
- Add system Chromium, Playwright 1.55.0, Noto CJK/emoji fonts, and an injected Node headless renderer.
- Support PNG/JPEG, screenshot PDF, screenshot PPTX, ordinary page/deck/slide/stitch/pagination capture; reject editable PPTX explicitly.
- Add watchdog process launcher, static/unit tests, and validation-gated multi-architecture GHCR workflow.
- Harden renderer output confinement against symlinked output/export roots and block model-authored renderer traffic from HA/private/link-local/loopback networks except the exact OpenDesign origin.
- Bridge HA browser PDF and PNG/JPEG actions to the working screenshot binary endpoints; remove the misleading desktop vector-PDF injection.
- Bound launcher shutdown with a five-second TERM grace followed by KILL/reap.
- Gate the publish matrix on a real amd64 container smoke test covering health, restart persistence, UID/paths, local-runtime absence, installed Chromium rendering, and upstream image/PDF/PPTX assembly without BYOK.
