# Woow HA OpenDesign Add-on

OpenDesign **0.21.1**, packaged as a standalone Home Assistant add-on for `amd64` and `aarch64`.

- Home Assistant Ingress/sidebar access only; no LAN port is published.
- OpenDesign binds to `127.0.0.1`; unprivileged nginx fronts it on the Supervisor ingress port.
- Provider keys use OpenDesign's normal browser `localStorage`. They are per browser, are never HA add-on options, are not written to `/data`, and are not included in HA backups.
- OpenDesign state is persisted under `/data/opendesign` and is included in cold backups.
- System Chromium, Playwright and Noto CJK/emoji fonts provide headless HTML rendering.
- Downloads supported by the pinned upstream application: standalone HTML, ZIP, screenshot PDF, PNG/JPEG, and screenshot-based PPTX. **Editable PPTX is unsupported** and returns a clear error.
- The upstream Local CLI settings page remains visible, but this image installs and mounts no local AI runtime. Those runtime choices remain unavailable.

[繁體中文](README_zh-TW.md) · [Add-on documentation](DOCS.md)

## Install

1. In Home Assistant, open **Settings → Add-ons → Add-on Store → Repositories**.
2. Add `https://github.com/WOOWTECH/Woow_ha_opendesign_add_on`.
3. Install **Woow HA OpenDesign**, start it, and open **OpenDesign** from the sidebar.
4. Configure a provider in OpenDesign. The key stays in that browser's local storage.

There are no add-on configuration options and no host directory mappings.

## Architecture

```text
browser → HA authenticated ingress → nginx :8099 → OpenDesign 127.0.0.1:7456
                                                   ↘ /data/opendesign
                                                   ↘ system Chromium renderer
```

nginx validates `X-Ingress-Path`, rewrites initial root-relative URLs, and injects early browser shims covering fetch, XHR, EventSource, WebSocket, history, workers, dynamically inserted asset URLs, and the two web-mode export gaps. In HA Ingress the PDF action is redirected from the desktop-JSON endpoint to the binary screenshot-PDF endpoint, while PNG/JPEG saves call the daemon's headless image endpoint. Buffering and upstream compression are disabled to preserve streams and allow response rewriting.

A PID-1 launcher starts nginx and OpenDesign, forwards termination, and stops the peer if either process exits. Shutdown sends TERM, waits at most five seconds, then sends KILL and reaps. Both services run as upstream `open-design` UID/GID 1001. nginx keeps its PID and temporary files under `/tmp`.

## Development and validation

```sh
./tests/run.sh
```

The local suite requires Node.js and Python 3 with PyYAML, but not Docker. It validates metadata, forbidden host/runtime coupling, JavaScript and shell syntax, renderer/security helpers, export bridges, and ingress rewrite fixtures. CI additionally builds an amd64 image and runs `tests/container-smoke.sh` before the architecture publish matrix: real health polling, restart persistence, UID/path/CLI checks, Chromium PNG/JPEG rendering, editable-PPTX rejection, and upstream HTTP screenshot PDF/PPTX assembly.

## Security notes

Access control is delegated to authenticated HA Ingress. Anyone allowed to open the add-on has OpenDesign access. Provider calls still leave the browser/daemon for the provider selected by the user. Browser-local keys do not follow a user to another browser and do not survive browser-storage clearing.

Renderer HTML is model-generated, so Chromium applies a request policy before every load: it allows `data:`, `blob:`, `about:`, the exact OpenDesign loopback origin used for project assets, and public HTTP(S) addresses only after DNS/IP validation. It blocks Supervisor, metadata/link-local, RFC1918, CGNAT, other loopback ports, and IPv6 private/link-local destinations. System fonts keep CJK/emoji capture independent of remote font CDNs.

## Upstream and license

The runtime derives from `ghcr.io/nexu-io/od:0.21.1`. OpenDesign has its own upstream licensing and notices. The add-on packaging and integration code in this repository is MIT licensed; see [LICENSE](LICENSE).
