import crypto from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runExport } from './exporter.js';

const backupJobs = new Map();
const scheduleTimers = new Map();
const defaultBackupPath = process.env.DEFAULT_BACKUP_DIR || '/backups';

function slugify(value) {
  return String(value || 'backup')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'backup';
}

function timestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function cleanDirectory(value, fallback = defaultBackupPath) {
  const directory = String(value || fallback).trim();
  if (!directory) throw new Error('Backup-Verzeichnis muss gesetzt sein.');
  return path.resolve(directory);
}

function cleanRetention(value) {
  const retention = Number(value || 5);
  if (!Number.isFinite(retention) || retention < 1) return 1;
  return Math.floor(retention);
}

function backupPrefix(request) {
  return slugify(request.prefix || request.name || request.exportRequest?.libraryId || 'backup');
}

export function normalizeBackupConfig(request = {}) {
  const exportRequest = request.exportRequest || {};
  return {
    id: request.id || crypto.randomUUID(),
    enabled: request.enabled === true,
    name: String(request.name || 'Artwork Backup').trim() || 'Artwork Backup',
    schedule: request.schedule || 'manual',
    time: request.time || '03:00',
    weekday: Number.isFinite(Number(request.weekday)) ? Number(request.weekday) : 0,
    intervalHours: Number.isFinite(Number(request.intervalHours)) ? Number(request.intervalHours) : 24,
    backupPath: cleanDirectory(request.backupPath),
    retention: cleanRetention(request.retention),
    prefix: backupPrefix(request),
    exportRequest: {
      serverType: exportRequest.serverType || request.serverType || 'plex',
      libraryId: exportRequest.libraryId || request.libraryId || '',
      libraryType: exportRequest.libraryType || request.libraryType || 'all',
      artworkKinds: Array.isArray(exportRequest.artworkKinds) ? exportRequest.artworkKinds : ['poster', 'background', 'seasonPoster'],
      useKometaAssetNames: exportRequest.useKometaAssetNames === true
    },
    lastRunAt: request.lastRunAt || null,
    nextRunAt: request.nextRunAt || null
  };
}

function shouldPrune(entryName, prefix) {
  return entryName.startsWith(`${prefix}-`);
}

async function pruneBackups(backupPath, prefix, retention) {
  const entries = await readdir(backupPath, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const versions = entries
    .filter(entry => entry.isDirectory() && shouldPrune(entry.name, prefix))
    .map(entry => entry.name)
    .sort();
  const remove = versions.slice(0, Math.max(0, versions.length - retention));
  for (const entry of remove) {
    await rm(path.join(backupPath, entry), { recursive: true, force: true });
  }
  return remove;
}

export async function runBackup(request, settings, options = {}) {
  const config = normalizeBackupConfig(request);
  const now = options.now || new Date();
  const backupPath = config.backupPath;
  const backupDirectory = path.join(backupPath, `${config.prefix}-${timestamp(now)}`);
  const exportRunner = options.exportRunner || runExport;

  await mkdir(backupDirectory, { recursive: true });
  const exportRequest = {
    ...config.exportRequest,
    exportPath: backupDirectory
  };
  const result = await exportRunner(exportRequest, settings);
  const manifest = {
    name: config.name,
    createdAt: now.toISOString(),
    format: 'folder',
    compressed: false,
    backupDirectory,
    backupPath,
    retention: config.retention,
    exportRequest: config.exportRequest,
    count: result.count || 0,
    exported: result.exported || 0,
    files: result.files || []
  };
  await writeFile(path.join(backupDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const pruned = await pruneBackups(backupPath, config.prefix, config.retention);
  return {
    ...manifest,
    pruned
  };
}

export async function startBackupJob(request, settings) {
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
  backupJobs.set(jobId, job);

  queueMicrotask(async () => {
    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      const result = await runBackup(request, settings, {
        exportRunner: async (exportRequest, privateSettings) => runExport(exportRequest, privateSettings, progress => {
          job.exported = progress.exported;
          job.total = progress.total;
          job.current = progress.current;
          job.updatedAt = new Date().toISOString();
        })
      });
      job.status = 'completed';
      job.exported = result.exported;
      job.total = result.count;
      job.result = result;
      job.updatedAt = new Date().toISOString();
    } catch (error) {
      job.status = 'failed';
      job.error = error.message || 'Backup failed';
      job.updatedAt = new Date().toISOString();
    }
  });

  return job;
}

export function getBackupJob(jobId) {
  return backupJobs.get(jobId) || null;
}

function parseTime(value) {
  const match = String(value || '03:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour: 3, minute: 0 };
  return { hour: Math.min(23, Number(match[1])), minute: Math.min(59, Number(match[2])) };
}

export function isBackupDue(config, now = new Date()) {
  const item = normalizeBackupConfig(config);
  if (!item.enabled || item.schedule === 'manual') return false;
  const lastRun = item.lastRunAt ? new Date(item.lastRunAt) : null;
  if (item.schedule === 'hourly') {
    if (!lastRun) return true;
    return now.getTime() - lastRun.getTime() >= Math.max(1, item.intervalHours) * 60 * 60 * 1000;
  }

  const { hour, minute } = parseTime(item.time);
  if (now.getHours() !== hour || now.getMinutes() !== minute) return false;
  if (item.schedule === 'weekly' && now.getDay() !== item.weekday) return false;
  if (!lastRun) return true;
  return lastRun.toDateString() !== now.toDateString();
}

export function stopBackupSchedules() {
  for (const timer of scheduleTimers.values()) clearInterval(timer);
  scheduleTimers.clear();
}

export function startBackupSchedules(settingsStore, { intervalMs = 60_000 } = {}) {
  stopBackupSchedules();
  const timer = setInterval(async () => {
    const settings = await settingsStore.loadPrivate();
    const backups = Array.isArray(settings.backups) ? settings.backups : [];
    for (const backup of backups) {
      if (!isBackupDue(backup)) continue;
      const job = await startBackupJob(backup, settings);
      backup.lastRunAt = job.createdAt;
    }
    if (backups.length) await settingsStore.replaceBackups(backups);
  }, intervalMs);
  scheduleTimers.set('default', timer);
  return timer;
}
