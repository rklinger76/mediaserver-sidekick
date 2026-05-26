import path from 'node:path';

function embyBaseUrl(settings) {
  return String(settings.url || '').replace(/\/+$/, '');
}

function embyUrl(settings, endpoint, params = {}) {
  const url = new URL(`${embyBaseUrl(settings)}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`);
  url.searchParams.set('api_key', settings.apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function embyJson(settings, endpoint, params = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(embyUrl(settings, endpoint, params), {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'Zeitüberschreitung' : 'Verbindung fehlgeschlagen';
    throw new Error(`Emby-Server nicht erreichbar: ${reason}. Bitte URL, Port und API-Key prüfen.`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`Emby request failed: ${response.status}`);
  return response.json();
}

function mapLibraryType(collectionType) {
  if (collectionType === 'movies') return 'movie';
  if (collectionType === 'tvshows') return 'show';
  return '';
}

function sourceFolderName(item) {
  if (!item.Path) return item.ProductionYear ? `${item.Name} (${item.ProductionYear})` : item.Name;
  if (item.Type === 'Movie') return path.basename(path.dirname(item.Path));
  return path.basename(item.Path);
}

function assetName(item) {
  return sourceFolderName(item) || (item.ProductionYear ? `${item.Name} (${item.ProductionYear})` : item.Name);
}

function imageUrl(settings, itemId, imageType, tag, index) {
  if (!tag && imageType !== 'Backdrop') return '';
  const suffix = imageType === 'Backdrop' ? `/Images/Backdrop/${index || 0}` : `/Images/${imageType}`;
  return embyUrl(settings, `/Items/${itemId}${suffix}`, tag ? { tag } : {});
}

function artworkFromItem(settings, item) {
  const artwork = [];
  if (item.ImageTags?.Primary) {
    artwork.push({
      kind: 'poster',
      url: imageUrl(settings, item.Id, 'Primary', item.ImageTags.Primary),
      originalName: 'Primary.jpg',
      extension: '.jpg'
    });
  }
  if (item.BackdropImageTags?.length) {
    artwork.push({
      kind: 'background',
      url: imageUrl(settings, item.Id, 'Backdrop', item.BackdropImageTags[0], 0),
      originalName: 'Backdrop.jpg',
      extension: '.jpg'
    });
  }
  return artwork;
}

async function seasonsForShow(settings, showId) {
  const payload = await embyJson(settings, `/Shows/${showId}/Seasons`, {
    Fields: 'ImageTags,IndexNumber'
  });
  return payload.Items || [];
}

export const embyAdapter = {
  async listLibraries(settings) {
    if (!settings?.url || !settings?.apiKey) {
      return [
        { id: 'demo-movies', name: 'Demo Filme', type: 'movie' },
        { id: 'demo-shows', name: 'Demo Serien', type: 'show' }
      ];
    }

    const payload = await embyJson(settings, '/Library/VirtualFolders');
    return (Array.isArray(payload) ? payload : [])
      .map(folder => ({
        id: String(folder.ItemId || folder.Id || folder.Name),
        name: folder.Name,
        type: mapLibraryType(folder.CollectionType)
      }))
      .filter(folder => folder.id && folder.name && folder.type);
  },

  async listArtwork({ settings, libraryId, libraryType }) {
    if (!settings?.url || !settings?.apiKey) {
      const demoItems = [
        {
          type: 'movie',
          title: 'Emby Example Movie (2024)',
          assetName: 'Emby Example Movie (2024)',
          sourceFolderName: 'Emby Example Movie (2024)',
          artwork: [
            { kind: 'poster', url: 'emby://example/movie/primary', originalName: 'Primary.jpg', extension: '.jpg' },
            { kind: 'background', url: 'emby://example/movie/backdrop', originalName: 'Backdrop.jpg', extension: '.jpg' }
          ]
        }
      ];
      if (libraryId === 'demo-shows' || libraryType === 'show') return [];
      return demoItems;
    }

    const includeItemTypes = libraryType === 'show' ? 'Series' : 'Movie';
    const payload = await embyJson(settings, '/Items', {
      ParentId: libraryId,
      Recursive: true,
      IncludeItemTypes: includeItemTypes,
      Fields: 'Path,ImageTags,BackdropImageTags,ProductionYear,ProviderIds,IndexNumber',
      SortBy: 'SortName',
      SortOrder: 'Ascending'
    });

    const items = [];
    for (const entry of payload.Items || []) {
      const item = {
        type: entry.Type === 'Series' ? 'show' : 'movie',
        title: entry.Name,
        assetName: assetName(entry),
        sourceFolderName: sourceFolderName(entry),
        artwork: artworkFromItem(settings, entry)
      };

      if (entry.Type === 'Series') {
        for (const season of await seasonsForShow(settings, entry.Id)) {
          if (season.ImageTags?.Primary && Number.isFinite(Number(season.IndexNumber))) {
            item.artwork.push({
              kind: 'seasonPoster',
              seasonNumber: Number(season.IndexNumber),
              url: imageUrl(settings, season.Id, 'Primary', season.ImageTags.Primary),
              originalName: `Season ${String(season.IndexNumber).padStart(2, '0')}.jpg`,
              extension: '.jpg'
            });
          }
        }
      }

      items.push(item);
    }

    return items;
  }
};
