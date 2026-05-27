# Release notes draft

## Mediaserver Sidekick

### Highlights

- Clarified the Unraid setup documentation for paths, ports, variables, and first-run setup.
- Added and documented the JPG icon URL for Unraid templates because it displays more reliably than SVG.
- Updated the WebUI favicon/apple-touch-icon to use `public/icon.jpg`.

### Unraid template notes

Recommended icon URL:

```text
https://raw.githubusercontent.com/rklinger76/mediaserver-sidekick/main/public/icon.jpg
```

Recommended minimal mappings:

- WebUI port: container `3000`, host e.g. `8088`
- App data path: `/app/data` -> `/mnt/user/appdata/mediaserver-sidekick`
- Export path: `/exports` -> `/mnt/user/media/assets`
- `SIDEKICK_SECRET`: long, stable random secret
- `DEFAULT_EXPORT_DIR`: `/exports`

### Verification

- `npm test`: 13/13 passing
- `node --check`: server, services, sources, settings modules pass syntax checks
