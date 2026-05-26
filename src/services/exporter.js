import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { targetRelativePath } from './naming.js';
import { plexAdapter } from '../sources/plex.js';
import { embyAdapter } from '../sources/emby.js';
import { jellyfinAdapter } from '../sources/jellyfin.js';

const adapters = {
  plex: plexAdapter,
  emby: embyAdapter,
  jellyfin: jellyfinAdapter
};

const jobs = new Map();

function getAdapter(serverType) {
  const adapter = adapters[serverType];
  if (!adapter) throw new Error(`Unsupported media server: ${serverType}`);
  return adapter;
}

function resolveExportPath(request, settings) {
  return request.exportPath || settings.export?.defaultPath || process.env.DEFAULT_EXPORT_DIR || '/exports';
}

function safeTargetPath(exportPath, relativePath) {
  const root = path.resolve(exportPath);
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
    throw new Error(`Unsafe export target: ${relativePath}`);
  }
  return target;
}

function selectedArtworkKinds(request) {
  const requestedKinds = Array.isArray(request.artworkKinds) ? request.artworkKinds : [];
  const allowed = new Set(['poster', 'background', 'seasonPoster']);
  const selected = requestedKinds.filter(kind => allowed.has(kind));
  return new Set(selected.length ? selected : ['poster', 'background', 'seasonPoster']);
}

async function collectItems(request, settings) {
  const adapter = getAdapter(request.serverType);
  return adapter.listArtwork({
    settings: settings[request.serverType] || {},
    libraryId: request.libraryId || '',
    libraryType: request.libraryType || 'all'
  });
}

export async function listLibraries(serverType, settings) {
  const adapter = getAdapter(serverType || 'plex');
  if (!adapter.listLibraries) return [];
  return adapter.listLibraries(settings[serverType] || {});
}

export async function createExportPlan(request, settings) {
  const items = await collectItems(request, settings);
  const exportPath = resolveExportPath(request, settings);
  const kinds = selectedArtworkKinds(request);
  const useKometaAssetNames = request.useKometaAssetNames === true;

  const files = items.flatMap(item =>
    item.artwork.filter(artwork => kinds.has(artwork.kind)).map(artwork => {
      const relativePath = targetRelativePath(item, artwork, { useKometaAssetNames });
      return {
        title: item.title,
        type: item.type,
        artwork: artwork.kind,
        source: artwork.url,
        target: safeTargetPath(exportPath, relativePath)
      };
    })
  );

  return {
    serverType: request.serverType,
    libraryId: request.libraryId || '',
    libraryType: request.libraryType || 'all',
    artworkKinds: [...kinds],
    useKometaAssetNames,
    exportPath,
    count: files.length,
    files
  };
}

async function exportFile(file) {
    await mkdir(path.dirname(file.target), { recursive: true });
    if (file.source.startsWith('http://') || file.source.startsWith('https://')) {
      const response = await fetch(file.source);
      if (!response.ok) throw new Error(`Download failed: ${response.status} ${file.source}`);
      await writeFile(file.target, Buffer.from(await response.arrayBuffer()));
    } else {
      await writeFile(
        file.target,
        `Preview placeholder for ${file.artwork} from ${file.source}\nConfigure a real server to download artwork.\n`
      );
    }
}

export async function runExport(request, settings, onProgress) {
  const plan = await createExportPlan(request, settings);
  let exported = 0;

  for (const file of plan.files) {
    await exportFile(file);
    exported += 1;
    onProgress?.({ exported, total: plan.files.length, current: file });
  }

  return {
    ...plan,
    exported
  };
}

export async function startExportJob(request, settings) {
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    status: 'queued',
    exported: 0,
    total: 0,
    current: null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  jobs.set(jobId, job);

  queueMicrotask(async () => {
    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      const result = await runExport(request, settings, progress => {
        job.exported = progress.exported;
        job.total = progress.total;
        job.current = progress.current;
        job.updatedAt = new Date().toISOString();
      });
      job.status = 'completed';
      job.exported = result.exported;
      job.total = result.count;
      job.result = result;
      job.updatedAt = new Date().toISOString();
    } catch (error) {
      job.status = 'failed';
      job.error = error.message || 'Export failed';
      job.updatedAt = new Date().toISOString();
    }
  });

  return job;
}

export function getExportJob(jobId) {
  return jobs.get(jobId) || null;
}
