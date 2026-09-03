# Woow HA OpenDesign

## Configuration

This add-on intentionally has no options. Configure providers in the OpenDesign UI, not in Home Assistant.

Provider keys remain in the current browser's `localStorage`. They are not stored in `/data/opendesign`, are not part of a Home Assistant backup, and must be entered again in each browser. Clearing site data removes them.

## Access and persistence

Use **Open Web UI** or the **OpenDesign** sidebar item. The service is ingress-only and has no published LAN port.

Projects, the OpenDesign database, application configuration, connector data, and generated state are stored beneath `/data/opendesign`. The add-on requests cold backup so this directory is captured while the service is stopped.

## Exports

| Format | Support |
|---|---|
| Standalone HTML | Supported by OpenDesign |
| Project ZIP | Supported by OpenDesign |
| PNG / JPEG | Supported by the headless Chromium renderer |
| Screenshot PDF | Supported; one image per deck slide or viewport page |
| Screenshot PPTX | Supported; one full-slide image per PowerPoint slide |
| Editable PPTX | **Unsupported**; select screenshot mode instead |

Rendering is bounded by time, dimensions, pixel count, and output-path confinement. CJK and color emoji fonts are installed in the image. Very tall pages can fail with a bounded-size error instead of exhausting add-on memory.

## Local runtimes

The upstream Local CLI page is intentionally unchanged. This add-on does not install, discover, or mount any host AI command-line runtime, so every local runtime remains unavailable. Use OpenDesign's API/BYOK provider mode.

## Troubleshooting

- **Blank page or missing assets:** restart the add-on, then reload the HA page without cache. Report the missing root-relative URL and add-on logs; ingress adaptation is coupled to the pinned OpenDesign version.
- **Generation cannot authenticate:** re-enter/test the provider key in this browser. There is no corresponding HA option.
- **Key disappeared:** browser storage was cleared or a different browser/profile is in use. HA restore cannot restore browser-local keys.
- **Editable PPTX fails:** expected. Choose the screenshot/image PPTX mode.
- **Image/PDF export says renderer failed:** check logs for Chromium errors and reduce page dimensions/length.
- **Watchdog restart:** if nginx or OpenDesign exits, the launcher deliberately stops its peer and exits so Supervisor can restart the complete pair.
