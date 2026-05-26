import path from 'node:path';

function plexArtworkUrl(settings, artPath) {
  const baseUrl = String(settings.url || '').replace(/\/+$/, '');
  const token = settings.token ? `?X-Plex-Token=${encodeURIComponent(settings.token)}` : '';
  if (!baseUrl || !artPath) return '';
  return `${baseUrl}${artPath.startsWith('/') ? artPath : `/${artPath}`}${token}`;
}

async function plexJson(settings, endpoint) {
  const baseUrl = String(settings.url || '').replace(/\/+$/, '');
  const joiner = endpoint.includes('?') ? '&' : '?';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(`${baseUrl}${endpoint}${joiner}X-Plex-Token=${encodeURIComponent(settings.token)}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'Zeitüberschreitung' : 'Verbindung fehlgeschlagen';
    throw new Error(`Plex-Server nicht erreichbar: ${reason}. Bitte URL, Port und Token prüfen.`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`Plex request failed: ${response.status}`);
  return response.json();
}

function firstPartPath(item) {
  return item.Media?.[0]?.Part?.[0]?.file || item.Location?.[0]?.path || '';
}

function assetNameFor(item) {
  const sourcePath = firstPartPath(item);
  if (sourcePath) {
    if (item.type === 'movie') return path.basename(path.dirname(sourcePath));
    return path.basename(sourcePath);
  }
  return item.year ? `${item.title} (${item.year})` : item.title;
}

function extensionFromUrl(url) {
  const match = String(url || '').match(/\.(jpe?g|png|webp)(?:\?|$)/i);
  return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

function plexSourceFileName(artPath, kind, seasonNumber) {
  const extension = extensionFromUrl(artPath);
  const cleanPath = String(artPath || '').split('?')[0];
  const baseName = path.basename(cleanPath);

  if (/\.(jpe?g|png|webp)$/i.test(baseName)) {
    return baseName;
  }

  if (kind === 'seasonPoster') {
    return `season-${String(seasonNumber).padStart(2, '0')}-${baseName || 'poster'}${extension}`;
  }

  return `${kind}-${baseName || 'artwork'}${extension}`;
}

function artworkFromItem(settings, item) {
  const artwork = [];
  if (item.thumb) {
    artwork.push({
      kind: 'poster',
      url: plexArtworkUrl(settings, item.thumb),
      fileName: plexSourceFileName(item.thumb, 'poster'),
      extension: extensionFromUrl(item.thumb)
    });
  }
  if (item.art) {
    artwork.push({
      kind: 'background',
      url: plexArtworkUrl(settings, item.art),
      fileName: plexSourceFileName(item.art, 'background'),
      extension: extensionFromUrl(item.art)
    });
  }
  return artwork;
}

export const plexAdapter = {
  async listLibraries(settings) {
    if (!settings?.url || !settings?.token) {
      return [
        { id: 'demo-movies', name: 'Demo Filme', type: 'movie' },
        { id: 'demo-shows', name: 'Demo Serien', type: 'show' }
      ];
    }

    const sections = await plexJson(settings, '/library/sections');
    return (sections.MediaContainer?.Directory || [])
      .filter(section => ['movie', 'show'].includes(section.type))
      .map(section => ({
        id: String(section.key),
        name: section.title,
        type: section.type
      }));
  },

  async listArtwork({ settings, libraryId, libraryType }) {
    if (!settings?.url || !settings?.token) {
      const demoItems = [
        {
          type: 'movie',
          title: 'Example Movie (2024)',
          assetName: 'Example Movie (2024)',
          sourceFolderName: 'Example Movie (2024)',
          artwork: [
            { kind: 'poster', url: 'plex://example/movie/poster', originalName: 'poster.jpg', extension: '.jpg' },
            { kind: 'background', url: 'plex://example/movie/background', originalName: 'fanart.jpg', extension: '.jpg' }
          ]
        },
        {
          type: 'show',
          title: 'Example Show (2022)',
          assetName: 'Example Show (2022)',
          sourceFolderName: 'Example Show (2022)',
          artwork: [
            { kind: 'poster', url: 'plex://example/show/poster', originalName: 'poster.jpg', extension: '.jpg' },
            { kind: 'background', url: 'plex://example/show/background', originalName: 'fanart.jpg', extension: '.jpg' },
            { kind: 'seasonPoster', seasonNumber: 1, url: 'plex://example/show/season01', originalName: 'Season 01.jpg', extension: '.jpg' }
          ]
        }
      ];

      if (libraryId === 'demo-movies' || libraryType === 'movie') {
        return demoItems.filter(item => item.type === 'movie');
      }
      if (libraryId === 'demo-shows' || libraryType === 'show') {
        return demoItems.filter(item => item.type === 'show');
      }
      return [
        ...demoItems
      ];
    }

    const sections = await plexJson(settings, '/library/sections');
    const directories = (sections.MediaContainer?.Directory || [])
      .filter(section => ['movie', 'show'].includes(section.type))
      .filter(section => !libraryId || String(section.key) === String(libraryId));
    const items = [];

    for (const section of directories) {
      if (!['movie', 'show'].includes(section.type)) continue;
      const metadata = await plexJson(settings, `/library/sections/${section.key}/all`);
      const entries = metadata.MediaContainer?.Metadata || [];

      for (const entry of entries) {
        const item = {
          type: entry.type === 'show' ? 'show' : 'movie',
          title: entry.title,
          assetName: assetNameFor(entry),
          sourceFolderName: assetNameFor(entry),
          artwork: artworkFromItem(settings, entry)
        };

        if (entry.type === 'show') {
          const children = await plexJson(settings, `/library/metadata/${entry.ratingKey}/children`);
          const seasons = children.MediaContainer?.Metadata || [];
          for (const season of seasons) {
            if (season.thumb && Number.isFinite(Number(season.index))) {
              item.artwork.push({
                kind: 'seasonPoster',
                seasonNumber: Number(season.index),
                url: plexArtworkUrl(settings, season.thumb),
                fileName: plexSourceFileName(season.thumb, 'seasonPoster', Number(season.index)),
                extension: extensionFromUrl(season.thumb)
              });
            }
          }
        }

        items.push(item);
      }
    }

    return items;
  },
  plexArtworkUrl
};
