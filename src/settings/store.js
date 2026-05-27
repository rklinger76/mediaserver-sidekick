import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decryptJson, encryptJson } from './crypto.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const settingsPath = path.join(dataDir, 'settings.enc.json');

const emptySettings = {
  plex: { url: '', token: '' },
  emby: { url: '', apiKey: '' },
  jellyfin: { url: '', apiKey: '' },
  export: {
    defaultPath: process.env.DEFAULT_EXPORT_DIR || '/exports',
    assetFolders: true
  },
  backups: []
};

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 6) return 'saved';
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function publicSettings(settings) {
  return {
    plex: { url: settings.plex?.url || '', token: maskSecret(settings.plex?.token) },
    emby: { url: settings.emby?.url || '', apiKey: maskSecret(settings.emby?.apiKey) },
    jellyfin: { url: settings.jellyfin?.url || '', apiKey: maskSecret(settings.jellyfin?.apiKey) },
    export: {
      defaultPath: settings.export?.defaultPath || process.env.DEFAULT_EXPORT_DIR || '/exports',
      assetFolders: settings.export?.assetFolders !== false
    },
    backups: Array.isArray(settings.backups) ? settings.backups : [],
    secretsSaved: {
      plex: Boolean(settings.plex?.token),
      emby: Boolean(settings.emby?.apiKey),
      jellyfin: Boolean(settings.jellyfin?.apiKey)
    }
  };
}

function mergeSettings(existing, incoming) {
  return {
    plex: {
      url: incoming.plex?.url ?? existing.plex.url,
      token: incoming.plex?.token || existing.plex.token
    },
    emby: {
      url: incoming.emby?.url ?? existing.emby.url,
      apiKey: incoming.emby?.apiKey || existing.emby.apiKey
    },
    jellyfin: {
      url: incoming.jellyfin?.url ?? existing.jellyfin.url,
      apiKey: incoming.jellyfin?.apiKey || existing.jellyfin.apiKey
    },
    export: {
      defaultPath: incoming.export?.defaultPath || existing.export.defaultPath,
      assetFolders: incoming.export?.assetFolders !== false
    },
    backups: Array.isArray(incoming.backups)
      ? incoming.backups
      : Array.isArray(existing.backups) ? existing.backups : []
  };
}

async function loadPrivate() {
  try {
    const encrypted = JSON.parse(await readFile(settingsPath, 'utf8'));
    return mergeSettings(emptySettings, decryptJson(encrypted));
  } catch (error) {
    if (error.code === 'ENOENT') return emptySettings;
    throw error;
  }
}

async function save(incoming) {
  const current = await loadPrivate();
  const next = mergeSettings(current, incoming);
  await mkdir(dataDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(encryptJson(next), null, 2));
  return publicSettings(next);
}

async function replaceBackups(backups) {
  const current = await loadPrivate();
  const next = mergeSettings(current, { backups });
  await mkdir(dataDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(encryptJson(next), null, 2));
  return publicSettings(next);
}

export const settingsStore = {
  loadPrivate,
  save,
  replaceBackups,
  async loadPublic() {
    return publicSettings(await loadPrivate());
  }
};
