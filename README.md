# Mediaserver Sidekick

Mediaserver Sidekick exports artwork from Plex, Emby, and Jellyfin into a folder that can be mounted in Docker or Unraid. The first version contains the web UI, encrypted settings storage, export planning, library selection, artwork type filters, and a Plex API adapter foundation.

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

## Docker

```bash
docker build -t mediaserver-sidekick .
docker run --rm -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/exports:/exports" \
  -e SIDEKICK_SECRET="change-this-long-random-secret" \
  mediaserver-sidekick
```

The app listens on port `3000` inside the container by default. To use another
port on the host, change the left side of the mapping:

```bash
docker run --rm -p 8088:3000 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/exports:/exports" \
  -e SIDEKICK_SECRET="change-this-long-random-secret" \
  mediaserver-sidekick
```

For Unraid, keep the container port at `3000` and set the host port to the port
you want to open in your browser.

## Unraid Installation

1. Open the Unraid web UI.
2. Go to **Docker** and select **Add Container**.
3. Switch to **Advanced View** if you want to set the WebUI URL.
4. Fill in the container settings:

| Field | Value |
| --- | --- |
| Name | `Mediaserver-Sidekick` |
| Repository | `ghcr.io/rklinger76/mediaserver-sidekick:latest` |
| WebUI | `http://[IP]:[PORT:3000]` |
| Network Type | `bridge` |
| Container Port | `3000` |
| Host Port | any free port, for example `8088` |

5. Add these paths:

| Container Path | Host Path | Purpose |
| --- | --- | --- |
| `/app/data` | `/mnt/user/appdata/mediaserver-sidekick` | Persistent encrypted settings |
| `/exports` | `/mnt/user/media/assets` | Default artwork export/restore target |

6. Add these variables:

| Variable | Example | Required |
| --- | --- | --- |
| `SIDEKICK_SECRET` | `use-a-long-random-stable-secret` | Yes |
| `DEFAULT_EXPORT_DIR` | `/exports` | No |

7. Apply the container.
8. Open the WebUI, for example `http://tower:8088`.

Keep `SIDEKICK_SECRET` unchanged after the first start. It is used to encrypt
saved Plex, Emby, and Jellyfin credentials. If it changes, existing saved
credentials cannot be decrypted.

The port you usually change in Unraid is the **Host Port**. Leave the container
port at `3000` unless you also set the internal `PORT` environment variable.

## Volumes and Environment

`/app/data` stores encrypted settings. `/exports` is the default artwork export path and can be overridden in the web UI.

Set `SIDEKICK_SECRET` to a stable, long random value. If it changes, previously saved encrypted settings cannot be decrypted.

Optional environment variables:

- `PORT`: internal app port. Keep this at `3000` unless you also change the container port mapping.
- `DEFAULT_EXPORT_DIR`: default target path shown in the app, defaults to `/exports`.
- `DATA_DIR`: settings directory inside the container, defaults to `/app/data`.
