# Release notes draft

## Mediaserver Sidekick

### Highlights

- Added automated artwork backups directly in Mediaserver Sidekick.
- New left-menu **Backup** view for configuring:
  - media server and library
  - poster/fanart/season-poster selection
  - Kometa asset naming
  - manual, hourly, daily, or weekly schedule
  - backup target folder
  - retention / number of versions to keep
- Backups are written as normal timestamped folders with `manifest.json` — **no ZIP archives**.
- Clarified the Unraid setup documentation for paths, ports, variables, and first-run setup.
- Added and documented the JPG icon URL for Unraid templates because it displays more reliably than SVG.
- Updated the WebUI favicon/apple-touch-icon to use `public/icon.jpg`.

### Backup notes

Recommended backup mapping:

```text
/backups -> /mnt/user/backups/mediaserver-sidekick
```

Example backup output:

```text
/backups/movies-20260527-081500/
  manifest.json
  Alien (1979)/
    poster.jpg
```

### Unraid template notes

Recommended icon URL:

```text
https://raw.githubusercontent.com/rklinger76/mediaserver-sidekick/main/public/icon.jpg
```

Recommended minimal mappings:

- WebUI port: container `3000`, host e.g. `8088`
- App data path: `/app/data` -> `/mnt/user/appdata/mediaserver-sidekick`
- Export path: `/exports` -> `/mnt/user/media/assets`
- Backup path: `/backups` -> `/mnt/user/backups/mediaserver-sidekick`
- `SIDEKICK_SECRET`: long, stable random secret
- `DEFAULT_EXPORT_DIR`: `/exports`

### Verification

- `npm test`: 15/15 passing
- `node --check`: server, backup service, public app pass syntax checks
