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

## Volumes and Environment

`/app/data` stores encrypted settings. `/exports` is the default artwork export path and can be overridden in the web UI.

Set `SIDEKICK_SECRET` to a stable, long random value. If it changes, previously saved encrypted settings cannot be decrypted.
