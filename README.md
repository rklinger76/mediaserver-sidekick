# Mediaserver Sidekick

Mediaserver Sidekick exports artwork from Plex, Emby, and Jellyfin into a folder that can be mounted in Docker or Unraid. It helps you create a portable artwork/asset folder for direct use, backups, or Kometa asset management.

The current version contains the web UI, encrypted settings storage, export planning, library selection, artwork type filters, Plex/Emby/Jellyfin adapters, Docker support, and an asset restore workflow.

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

In this example the app is still running on port `3000` inside the container,
but you open it on port `8088` on the host: `http://localhost:8088`.

## Unraid Installation

This section explains what each Unraid template setting is for. The important
idea is:

- **Container paths** are the paths Mediaserver Sidekick sees inside Docker.
- **Host paths** are the real folders on your Unraid server.
- **Ports** decide where the WebUI is reachable in your browser.
- **Variables** configure defaults and encryption.

### 1. Add the container

1. Open the Unraid web UI.
2. Go to **Docker**.
3. Click **Add Container**.
4. Switch to **Advanced View** if you want to set the WebUI URL.

### 2. Basic container settings

| Field | Value | Why |
| --- | --- | --- |
| Name | `Mediaserver-Sidekick` | The name shown in Unraid's Docker tab. |
| Repository | `ghcr.io/rklinger76/mediaserver-sidekick:latest` | The image Unraid should pull. |
| Network Type | `bridge` | Recommended default for this app. |
| WebUI | `http://[IP]:[PORT:3000]` | Lets the Unraid Docker tab open the app. |
| Icon URL | `https://raw.githubusercontent.com/rklinger76/mediaserver-sidekick/main/public/icon.jpg` | Optional icon for the Unraid Docker overview. |

### 3. Unraid icon

If you want the container to show a custom icon in Unraid, use the JPG icon URL:

```text
https://raw.githubusercontent.com/rklinger76/mediaserver-sidekick/main/public/icon.jpg
```

The repository also contains `public/icon.svg`, but the JPG is the recommended
choice for Unraid templates because it is more reliably displayed by Unraid.

### 4. Port mapping

Add a port mapping for the WebUI:

| Setting | Value |
| --- | --- |
| Container Port | `3000` |
| Host Port | Any free port, for example `8088` |
| Connection Type | `TCP` |

The **Container Port** should normally stay `3000`. That is the port used inside
the Docker container.

The **Host Port** is the port you open in your browser. If you set the host port
to `8088`, open:

```text
http://tower:8088
```

or:

```text
http://<your-unraid-ip>:8088
```

Only change the internal `PORT` environment variable if you also know why you
need to change the container port. For a normal Unraid setup, leave the app's
internal port at `3000` and only change the **Host Port**.

### 5. Path mappings

Add these paths in the Unraid template with **Add another Path, Port, Variable,
Label or Device** -> **Path**.

| Container Path | Example Host Path | Purpose |
| --- | --- | --- |
| `/app/data` | `/mnt/user/appdata/mediaserver-sidekick` | Stores encrypted settings, including saved Plex/Emby/Jellyfin credentials. |
| `/exports` | `/mnt/user/media/assets` | Default folder where exported artwork is written and where restore jobs can target files. |

#### `/app/data` settings folder

This path should point to a persistent appdata folder. If you do not map it,
settings may be lost when the container is recreated.

Recommended Unraid host path:

```text
/mnt/user/appdata/mediaserver-sidekick
```

#### `/exports` artwork folder

This path is where Mediaserver Sidekick writes exported artwork by default.
Choose a folder that makes sense for your media setup, for example:

```text
/mnt/user/media/assets
```

Inside the app, this folder appears as:

```text
/exports
```

So if you map `/mnt/user/media/assets` to `/exports`, the app writes to
`/exports`, but the files are actually stored on Unraid in
`/mnt/user/media/assets`.

You can later choose a different export path in the WebUI, but it must be a path
that exists inside the container. In most Unraid setups, using `/exports` is the
simplest option.

### 6. Variables

Add these entries with **Add another Path, Port, Variable, Label or Device** ->
**Variable**.

| Variable | Example | Required | Purpose |
| --- | --- | --- | --- |
| `SIDEKICK_SECRET` | `use-a-long-random-stable-secret` | Yes | Encryption key for saved Plex/Emby/Jellyfin credentials. |
| `DEFAULT_EXPORT_DIR` | `/exports` | No | Default export path shown in the WebUI. |

#### `SIDEKICK_SECRET`

Set this to a long, random value and keep it unchanged after the first start.
Mediaserver Sidekick uses it to encrypt saved Plex tokens and Emby/Jellyfin API
keys.

Example:

```text
SIDEKICK_SECRET=replace-this-with-a-long-random-secret
```

Important: if you change `SIDEKICK_SECRET` later, existing saved credentials in
`/app/data` cannot be decrypted anymore. You would need to enter the credentials
again.

#### `DEFAULT_EXPORT_DIR`

For a normal Unraid setup, set this to:

```text
/exports
```

This is the container path, not the Unraid host path. Do not put
`/mnt/user/media/assets` here unless you also mounted that exact path into the
container.

### 7. Recommended minimal Unraid template

Use this as a checklist:

| Type | Name | Container value | Host/default value |
| --- | --- | --- | --- |
| Port | WebUI | `3000` | `8088` or another free host port |
| Path | App data | `/app/data` | `/mnt/user/appdata/mediaserver-sidekick` |
| Path | Exports | `/exports` | `/mnt/user/media/assets` |
| Variable | `SIDEKICK_SECRET` | - | A long stable random secret |
| Variable | `DEFAULT_EXPORT_DIR` | - | `/exports` |
| Icon URL | Unraid icon | - | `https://raw.githubusercontent.com/rklinger76/mediaserver-sidekick/main/public/icon.jpg` |

After applying the template, open the WebUI from the Docker tab or browse to:

```text
http://tower:8088
```

Adjust the port if you chose a different host port.

### 8. First run checklist

1. Open the WebUI.
2. Go to the settings view.
3. Enter your Plex, Emby, or Jellyfin server URL.
4. Enter the matching token or API key.
5. Save settings.
6. Go back to export.
7. Select a server type and library.
8. Keep the export path as `/exports` unless you mapped another folder.
9. Preview the export plan.
10. Run the export when the plan looks correct.

## Volumes and Environment

`/app/data` stores encrypted settings. `/exports` is the default artwork export
path and can be overridden in the web UI.

Set `SIDEKICK_SECRET` to a stable, long random value. If it changes, previously
saved encrypted settings cannot be decrypted.

Optional environment variables:

- `PORT`: internal app port. Keep this at `3000` unless you also change the container port mapping.
- `DEFAULT_EXPORT_DIR`: default target path shown in the app, defaults to `/exports`.
- `DATA_DIR`: settings directory inside the container, defaults to `/app/data`.
