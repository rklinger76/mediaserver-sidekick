import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBackup } from '../src/services/backup.js';

test('creates timestamped folder backups without zipping and writes a manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidekick-backup-'));
  const backupPath = path.join(root, 'backups');

  const result = await runBackup({
    name: 'Movies',
    backupPath,
    retention: 3,
    exportRequest: {
      serverType: 'plex',
      libraryId: '1',
      libraryType: 'movie',
      artworkKinds: ['poster'],
      useKometaAssetNames: true
    }
  }, {}, {
    now: new Date('2026-05-27T08:15:00.000Z'),
    exportRunner: async request => {
      await mkdir(path.join(request.exportPath, 'Alien (1979)'), { recursive: true });
      await writeFile(path.join(request.exportPath, 'Alien (1979)', 'poster.jpg'), 'poster');
      return { count: 1, exported: 1, files: [{ target: path.join(request.exportPath, 'Alien (1979)', 'poster.jpg') }] };
    }
  });

  assert.equal(result.exported, 1);
  assert.equal(result.backupDirectory, path.join(backupPath, 'movies-20260527-081500'));
  assert.equal(await readFile(path.join(result.backupDirectory, 'Alien (1979)', 'poster.jpg'), 'utf8'), 'poster');

  const manifest = JSON.parse(await readFile(path.join(result.backupDirectory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Movies');
  assert.equal(manifest.format, 'folder');
  assert.equal(manifest.compressed, false);
  assert.equal(manifest.exported, 1);

  await rm(root, { recursive: true, force: true });
});

test('prunes old backup folders by retention and keeps newest versions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidekick-backup-'));
  const backupPath = path.join(root, 'backups');
  await mkdir(path.join(backupPath, 'movies-20260525-080000'), { recursive: true });
  await mkdir(path.join(backupPath, 'movies-20260526-080000'), { recursive: true });
  await writeFile(path.join(backupPath, 'movies-20260525-080000', 'manifest.json'), '{}');
  await writeFile(path.join(backupPath, 'movies-20260526-080000', 'manifest.json'), '{}');

  await runBackup({
    name: 'Movies',
    backupPath,
    retention: 2,
    exportRequest: { serverType: 'plex', libraryId: '1' }
  }, {}, {
    now: new Date('2026-05-27T08:00:00.000Z'),
    exportRunner: async request => {
      await mkdir(request.exportPath, { recursive: true });
      await writeFile(path.join(request.exportPath, 'poster.jpg'), 'poster');
      return { count: 1, exported: 1, files: [] };
    }
  });

  const entries = (await readdir(backupPath)).sort();
  assert.deepEqual(entries, ['movies-20260526-080000', 'movies-20260527-080000']);

  await rm(root, { recursive: true, force: true });
});
