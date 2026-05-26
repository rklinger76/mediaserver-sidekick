import crypto from 'node:crypto';
import { access, copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const restoreJobs = new Map();
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function cleanDirectory(value, fallback = '') {
  const directory = String(value || fallback).trim();
  if (!directory) throw new Error('Source und Target müssen gesetzt sein.');
  return path.resolve(directory);
}

function safePath(root, relativePath) {
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
    throw new Error(`Unsafe restore path: ${relativePath}`);
  }
  return target;
}

function isImage(filePath) {
  return imageExtensions.has(path.extname(filePath).toLowerCase());
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function scanImages(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await scanImages(root, filePath));
      continue;
    }
    if (!entry.isFile() || !isImage(filePath)) continue;

    const details = await stat(filePath);
    const relativePath = path.relative(root, filePath);
    files.push({
      source: filePath,
      relativePath,
      size: details.size,
      modifiedAt: details.mtime.toISOString()
    });
  }

  return files;
}

function inferArtwork(relativePath) {
  const name = path.basename(relativePath, path.extname(relativePath)).toLowerCase();
  if (['background', 'fanart', 'backdrop', 'art'].includes(name)) return 'background';
  if (/^(season|staffel|s)\s*0?\d+/.test(name)) return 'seasonPoster';
  if (name.includes('season') || name.includes('staffel')) return 'seasonPoster';
  return 'poster';
}

function buildRestoreSummary(files) {
  return files.reduce((summary, file) => {
    summary[file.action] = (summary[file.action] || 0) + 1;
    summary.total += 1;
    return summary;
  }, { total: 0, restore: 0, overwrite: 0, skip: 0 });
}

export async function createRestorePlan(request) {
  const sourcePath = cleanDirectory(request.sourcePath);
  const targetPath = cleanDirectory(request.targetPath);
  const overwriteExisting = request.overwriteExisting === true;
  const sourceFiles = await scanImages(sourcePath);

  const files = await Promise.all(sourceFiles.map(async file => {
    const target = safePath(targetPath, file.relativePath);
    const targetExists = await exists(target);
    const action = targetExists
      ? overwriteExisting ? 'overwrite' : 'skip'
      : 'restore';

    return {
      ...file,
      target,
      artwork: inferArtwork(file.relativePath),
      exists: targetExists,
      action
    };
  }));

  return {
    sourcePath,
    targetPath,
    overwriteExisting,
    count: files.length,
    summary: buildRestoreSummary(files),
    files
  };
}

async function restoreFile(file) {
  if (file.action === 'skip') return;
  await mkdir(path.dirname(file.target), { recursive: true });
  await copyFile(file.source, file.target);
}

export async function runRestore(request, onProgress) {
  const plan = await createRestorePlan(request);
  let restored = 0;

  for (const file of plan.files) {
    await restoreFile(file);
    if (file.action !== 'skip') restored += 1;
    onProgress?.({ restored, total: plan.files.length, current: file });
  }

  return {
    ...plan,
    restored
  };
}

export async function startRestoreJob(request) {
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    status: 'queued',
    restored: 0,
    total: 0,
    current: null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  restoreJobs.set(jobId, job);

  queueMicrotask(async () => {
    try {
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      const result = await runRestore(request, progress => {
        job.restored = progress.restored;
        job.total = progress.total;
        job.current = progress.current;
        job.updatedAt = new Date().toISOString();
      });
      job.status = 'completed';
      job.restored = result.restored;
      job.total = result.count;
      job.result = result;
      job.updatedAt = new Date().toISOString();
    } catch (error) {
      job.status = 'failed';
      job.error = error.message || 'Restore failed';
      job.updatedAt = new Date().toISOString();
    }
  });

  return job;
}

export function getRestoreJob(jobId) {
  return restoreJobs.get(jobId) || null;
}
