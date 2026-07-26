import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { plexAdapter } from '../sources/plex.js';
import { embyAdapter } from '../sources/emby.js';
import { jellyfinAdapter } from '../sources/jellyfin.js';

const adapters = {
  plex: plexAdapter,
  emby: embyAdapter,
  jellyfin: jellyfinAdapter
};

function getAdapter(serverType) {
  const adapter = adapters[serverType];
  if (!adapter?.listMedia) throw new Error(`Unsupported media server: ${serverType}`);
  return adapter;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(the|der|die|das|ein|eine)\b/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function mediaKeys(item) {
  const values = [
    item.title,
    item.year ? `${item.title} (${item.year})` : '',
    item.sourceFolderName,
    item.assetName
  ];
  return new Set(values.map(normalizeName).filter(Boolean));
}

async function scanMediaFolders(sourcePath) {
  const root = path.resolve(String(sourcePath || '').trim());
  if (!sourcePath) throw new Error('Medienordner muss gesetzt sein.');

  const details = await stat(root);
  if (!details.isDirectory()) {
    throw new Error('Medienordner ist kein Verzeichnis.');
  }

  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .filter(entry => !entry.name.startsWith('.'))
    .map(entry => ({
      name: entry.name,
      path: path.join(root, entry.name),
      key: normalizeName(entry.name)
    }))
    .filter(folder => folder.key)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function buildKnownMedia(mediaItems) {
  const known = new Map();
  for (const item of mediaItems) {
    for (const key of mediaKeys(item)) {
      if (!known.has(key)) known.set(key, []);
      known.get(key).push(item);
    }
  }
  return known;
}

export async function createAuditPlan(request, settings) {
  const serverType = request.serverType || 'plex';
  const libraryType = request.libraryType || 'movie';
  if (libraryType !== 'movie') {
    throw new Error('Library Audit unterstützt aktuell Film-Bibliotheken.');
  }

  const adapter = getAdapter(serverType);
  const [mediaItems, folders] = await Promise.all([
    adapter.listMedia({
      settings: settings[serverType] || {},
      libraryId: request.libraryId || '',
      libraryType
    }),
    scanMediaFolders(request.sourcePath)
  ]);

  const knownMedia = buildKnownMedia(mediaItems);
  const matched = [];
  const missing = [];

  for (const folder of folders) {
    const media = knownMedia.get(folder.key) || [];
    if (media.length) {
      matched.push({ ...folder, media: media[0] });
    } else {
      missing.push(folder);
    }
  }

  return {
    serverType,
    libraryId: request.libraryId || '',
    libraryType,
    sourcePath: path.resolve(String(request.sourcePath || '').trim()),
    count: folders.length,
    serverCount: mediaItems.length,
    matchedCount: matched.length,
    missingCount: missing.length,
    folders,
    matched,
    missing
  };
}

export const auditInternals = {
  normalizeName
};
