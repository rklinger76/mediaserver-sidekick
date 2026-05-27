import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { settingsStore } from './settings/store.js';
import { createExportPlan, getExportJob, listLibraries, startExportJob } from './services/exporter.js';
import { createRestorePlan, getRestoreJob, startRestoreJob } from './services/restore.js';
import { getBackupJob, normalizeBackupConfig, startBackupJob, startBackupSchedules } from './services/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml']
]);

async function browseDirectory(requestedPath) {
  const directory = path.resolve(requestedPath || process.env.DEFAULT_EXPORT_DIR || '/');
  const details = await stat(directory);
  if (!details.isDirectory()) {
    throw new Error('Pfad ist kein Verzeichnis');
  }

  const entries = await readdir(directory, { withFileTypes: true });
  return {
    path: directory,
    parent: path.dirname(directory),
    entries: entries
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        name: entry.name,
        path: path.join(directory, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    await readFile(filePath);
    res.writeHead(200, {
      'content-type': mimeTypes.get(path.extname(filePath)) || 'application/octet-stream'
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    createReadStream(path.join(publicDir, 'index.html')).pipe(res);
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      defaultExportDir: process.env.DEFAULT_EXPORT_DIR || '/exports'
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    sendJson(res, 200, await settingsStore.loadPublic());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/libraries') {
    const settings = await settingsStore.loadPrivate();
    sendJson(res, 200, await listLibraries(url.searchParams.get('serverType'), settings));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/filesystem/directories') {
    sendJson(res, 200, await browseDirectory(url.searchParams.get('path')));
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings') {
    const body = await readBody(req);
    const saved = await settingsStore.save(body);
    sendJson(res, 200, saved);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/export/preview') {
    const body = await readBody(req);
    const settings = await settingsStore.loadPrivate();
    sendJson(res, 200, await createExportPlan(body, settings));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/export/run') {
    const body = await readBody(req);
    const settings = await settingsStore.loadPrivate();
    sendJson(res, 202, await startExportJob(body, settings));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/export/jobs/')) {
    const job = getExportJob(url.pathname.split('/').pop());
    if (!job) {
      sendJson(res, 404, { error: 'Export job not found' });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/restore/preview') {
    const body = await readBody(req);
    sendJson(res, 200, await createRestorePlan(body));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/restore/run') {
    const body = await readBody(req);
    sendJson(res, 202, await startRestoreJob(body));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/restore/jobs/')) {
    const job = getRestoreJob(url.pathname.split('/').pop());
    if (!job) {
      sendJson(res, 404, { error: 'Restore job not found' });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/backups') {
    const settings = await settingsStore.loadPublic();
    sendJson(res, 200, settings.backups || []);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/backups') {
    const body = await readBody(req);
    const job = await settingsStore.addBackupJob(body);
    sendJson(res, 201, job);
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/backups') {
    const body = await readBody(req);
    const backups = Array.isArray(body.backups) ? body.backups.map(normalizeBackupConfig) : [];
    const saved = await settingsStore.replaceBackups(backups);
    sendJson(res, 200, saved.backups || []);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/backups/') && url.pathname.split('/').length === 4) {
    const id = url.pathname.split('/')[3];
    const job = await settingsStore.getBackupJob(id);
    if (!job) { sendJson(res, 404, { error: 'Backup-Job nicht gefunden' }); return; }
    sendJson(res, 200, job);
    return;
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/backups/') && url.pathname.split('/').length === 4) {
    const id = url.pathname.split('/')[3];
    const body = await readBody(req);
    try {
      const job = await settingsStore.updateBackupJob(id, body);
      sendJson(res, 200, job);
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/backups/') && url.pathname.split('/').length === 4) {
    const id = url.pathname.split('/')[3];
    try {
      await settingsStore.deleteBackupJob(id);
      sendJson(res, 200, { deleted: id });
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/backups\/([^/]+)\/run$/)) {
    const id = url.pathname.match(/^\/api\/backups\/([^/]+)\/run$/)[1];
    const settings = await settingsStore.loadPrivate();
    const jobConfig = await settingsStore.getBackupJob(id);
    if (!jobConfig) { sendJson(res, 404, { error: 'Backup-Job nicht gefunden' }); return; }
    sendJson(res, 202, await startBackupJob(jobConfig, settings));
    return;
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/backups\/([^/]+)\/toggle$/)) {
    const id = url.pathname.match(/^\/api\/backups\/([^/]+)\/toggle$/)[1];
    try {
      const current = await settingsStore.getBackupJob(id);
      if (!current) { sendJson(res, 404, { error: 'Backup-Job nicht gefunden' }); return; }
      const job = await settingsStore.updateBackupJob(id, { enabled: !current.enabled });
      sendJson(res, 200, job);
    } catch (error) {
      sendJson(res, 404, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/backups/jobs/')) {
    const job = getBackupJob(url.pathname.split('/').pop());
    if (!job) {
      sendJson(res, 404, { error: 'Backup job not found' });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Unexpected error' });
  }
});

startBackupSchedules(settingsStore);

server.listen(port, host, () => {
  console.log(`Mediaserver Sidekick is running on http://${host}:${port}`);
});
