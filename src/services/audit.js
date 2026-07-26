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
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeLooseName(value) {
  return normalizeName(value)
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function addCandidate(candidates, key, item, score) {
  if (!key) return;
  if (!candidates.has(key)) candidates.set(key, []);
  candidates.get(key).push({ item, score });
}

function mediaCandidateKeys(item) {
  return [
    { key: normalizeName(item.sourceFolderName), score: 100 },
    { key: normalizeName(item.assetName), score: 90 },
    { key: normalizeName(item.originalTitle), score: 88 },
    { key: normalizeName(item.sortName), score: 86 },
    { key: normalizeName(item.year && item.originalTitle ? `${item.originalTitle} (${item.year})` : ''), score: 84 },
    { key: normalizeName(item.year ? `${item.title} (${item.year})` : ''), score: 80 },
    { key: normalizeName(item.title), score: 60 },
    { key: normalizeLooseName(item.sourceFolderName), score: 30 },
    { key: normalizeLooseName(item.assetName), score: 25 },
    { key: normalizeLooseName(item.originalTitle), score: 24 },
    { key: normalizeLooseName(item.sortName), score: 22 },
    { key: normalizeLooseName(item.title), score: 20 }
  ];
}

function canonicalMediaKey(item) {
  return [
    normalizeName(item.sourceFolderName),
    normalizeName(item.assetName),
    normalizeName(item.year && item.originalTitle ? `${item.originalTitle} (${item.year})` : ''),
    normalizeName(item.year && item.sortName ? `${item.sortName} (${item.year})` : ''),
    normalizeName(item.year ? `${item.title} (${item.year})` : ''),
    normalizeName(item.originalTitle),
    normalizeName(item.sortName),
    normalizeName(item.title)
  ].find(Boolean) || '';
}

function dedupeMediaItems(mediaItems) {
  const deduped = new Map();

  for (const item of mediaItems) {
    const key = canonicalMediaKey(item);
    if (!key) continue;

    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }

    const existingScore = mediaCandidateKeys(existing)[0]?.key ? 1 : 0;
    const itemScore = mediaCandidateKeys(item)[0]?.key ? 1 : 0;
    if (itemScore > existingScore) deduped.set(key, item);
  }

  return [...deduped.values()];
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
      key: normalizeName(entry.name),
      looseKey: normalizeLooseName(entry.name)
    }))
    .filter(folder => folder.key)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function buildKnownMedia(mediaItems) {
  const known = new Map();
  for (const [index, item] of mediaItems.entries()) {
    item.auditId = `${item.type || 'media'}:${item.title || ''}:${item.year || ''}:${item.sourceFolderName || ''}:${index}`;
    for (const candidate of mediaCandidateKeys(item)) {
      addCandidate(known, candidate.key, item, candidate.score);
    }
  }
  return known;
}

function bestMediaMatch(knownMedia, folder) {
  const strictMatches = knownMedia.get(folder.key) || [];
  if (strictMatches.length) {
    return strictMatches
      .toSorted((a, b) => b.score - a.score)[0].item;
  }

  const looseMatches = knownMedia.get(folder.looseKey) || [];
  const uniqueLooseItems = new Map(looseMatches.map(match => [match.item.auditId, match.item]));
  if (uniqueLooseItems.size === 1) {
    return [...uniqueLooseItems.values()][0];
  }

  return null;
}

export async function createAuditPlan(request, settings) {
  const serverType = request.serverType || 'plex';
  const libraryType = request.libraryType || 'movie';
  if (libraryType !== 'movie') {
    throw new Error('Library Audit unterstützt aktuell Film-Bibliotheken.');
  }

  const adapter = getAdapter(serverType);
  const [rawMediaItems, folders] = await Promise.all([
    adapter.listMedia({
      settings: settings[serverType] || {},
      libraryId: request.libraryId || '',
      libraryType
    }),
    scanMediaFolders(request.sourcePath)
  ]);
  const mediaItems = dedupeMediaItems(rawMediaItems);

  const knownMedia = buildKnownMedia(mediaItems);
  const matched = [];
  const missing = [];
  const matchedMediaIds = new Set();

  for (const folder of folders) {
    const media = bestMediaMatch(knownMedia, folder);
    if (media) {
      matched.push({ ...folder, media });
      matchedMediaIds.add(media.auditId);
    } else {
      missing.push(folder);
    }
  }

  const serverOnly = mediaItems
    .filter(item => !matchedMediaIds.has(item.auditId))
    .map(item => ({
      title: item.title,
      year: item.year || null,
      originalTitle: item.originalTitle || '',
      sortName: item.sortName || '',
      sourceFolderName: item.sourceFolderName || '',
      assetName: item.assetName || ''
    }))
    .sort((a, b) => String(a.title).localeCompare(String(b.title), 'de'));

  return {
    serverType,
    libraryId: request.libraryId || '',
    libraryType,
    sourcePath: path.resolve(String(request.sourcePath || '').trim()),
    count: folders.length,
    serverCount: mediaItems.length,
    rawServerCount: rawMediaItems.length,
    matchedCount: matched.length,
    missingCount: missing.length,
    serverOnlyCount: serverOnly.length,
    folders,
    matched,
    missing,
    serverOnly
  };
}

export const auditInternals = {
  normalizeName,
  normalizeLooseName
};
